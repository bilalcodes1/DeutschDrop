import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import Database from 'better-sqlite3';
import {
    claimAdventureRewardOnce,
    getAdventureAdminStats,
    getAdventureProgress,
    upsertAdventureProgress,
} from '../dist/services/adventureProgress.js';

class MockD1 {
    constructor(sqlite) {
        this.sqlite = sqlite;
    }
    prepare(sql) {
        const sqlite = this.sqlite;
        return {
            bind(...params) {
                return {
                    first() {
                        return Promise.resolve(sqlite.prepare(sql).get(...params) ?? null);
                    },
                    all() {
                        return Promise.resolve({ results: sqlite.prepare(sql).all(...params) });
                    },
                    run() {
                        const info = sqlite.prepare(sql).run(...params);
                        return Promise.resolve({ success: true, meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) } });
                    },
                };
            },
        };
    }
}

function db() {
    const sqlite = new Database(':memory:');
    sqlite.exec(`
        CREATE TABLE users (user_id INTEGER PRIMARY KEY);
        INSERT INTO users (user_id) VALUES (1), (2);
        CREATE TABLE adventure_progress (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            world TEXT NOT NULL,
            stage INTEGER NOT NULL,
            stars INTEGER NOT NULL DEFAULT 0,
            best_score INTEGER NOT NULL DEFAULT 0,
            boss_defeated INTEGER NOT NULL DEFAULT 0,
            reward_key TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, world, stage)
        );
        CREATE TABLE adventure_rewards (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            reward_key TEXT NOT NULL,
            source_type TEXT NOT NULL,
            source_id TEXT,
            xp_awarded INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, reward_key)
        );
    `);
    return new MockD1(sqlite);
}

test('adventure progress inserts first stage row', async () => {
    const d1 = db();
    await upsertAdventureProgress(d1, 1, '1', 1, 2, 500);
    const rows = await getAdventureProgress(d1, 1);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].stars, 2);
    assert.equal(rows[0].best_score, 500);
});

test('adventure progress preserves higher stars and best score', async () => {
    const d1 = db();
    await upsertAdventureProgress(d1, 1, '1', 1, 3, 900);
    await upsertAdventureProgress(d1, 1, '1', 1, 1, 400);
    const [row] = await getAdventureProgress(d1, 1);
    assert.equal(row.stars, 3);
    assert.equal(row.best_score, 900);
});

test('adventure progress can upgrade best score without lowering stars', async () => {
    const d1 = db();
    await upsertAdventureProgress(d1, 1, '1', 1, 1, 300);
    await upsertAdventureProgress(d1, 1, '1', 1, 1, 800);
    const [row] = await getAdventureProgress(d1, 1);
    assert.equal(row.stars, 1);
    assert.equal(row.best_score, 800);
});

test('boss defeated flag is sticky', async () => {
    const d1 = db();
    await upsertAdventureProgress(d1, 1, '1', 5, 3, 1200, true);
    await upsertAdventureProgress(d1, 1, '1', 5, 0, 100, false);
    const [row] = await getAdventureProgress(d1, 1);
    assert.equal(row.boss_defeated, 1);
});

test('progress is isolated by user', async () => {
    const d1 = db();
    await upsertAdventureProgress(d1, 1, '1', 1, 2, 500);
    await upsertAdventureProgress(d1, 2, '1', 1, 3, 700);
    assert.equal((await getAdventureProgress(d1, 1))[0].stars, 2);
    assert.equal((await getAdventureProgress(d1, 2))[0].stars, 3);
});

test('claim adventure reward succeeds first time', async () => {
    const d1 = db();
    assert.equal(await claimAdventureRewardOnce(d1, 1, 'reward-a', 'boss', '1', 20), true);
});

test('claim adventure reward is idempotent per user and reward key', async () => {
    const d1 = db();
    assert.equal(await claimAdventureRewardOnce(d1, 1, 'reward-a', 'boss', '1', 20), true);
    assert.equal(await claimAdventureRewardOnce(d1, 1, 'reward-a', 'boss', '1', 20), false);
});

test('same reward key can be claimed by another user independently', async () => {
    const d1 = db();
    assert.equal(await claimAdventureRewardOnce(d1, 1, 'reward-a', 'boss', '1', 20), true);
    assert.equal(await claimAdventureRewardOnce(d1, 2, 'reward-a', 'boss', '1', 20), true);
});

test('admin stats counts progress rows rewards and defeated bosses', async () => {
    const d1 = db();
    await upsertAdventureProgress(d1, 1, '1', 1, 2, 500);
    await upsertAdventureProgress(d1, 1, '1', 2, 3, 800, true);
    await claimAdventureRewardOnce(d1, 1, 'reward-a', 'boss', '2', 20);
    const stats = await getAdventureAdminStats(d1);
    assert.deepEqual(stats, { progressRows: 2, rewardsRows: 1, defeatedBosses: 1 });
});

test('migration includes adventure progress and reward tables', () => {
    const source = fs.readFileSync(new URL('../src/db/migrations/0046_word_images_adventure.sql', import.meta.url), 'utf8');
    assert.match(source, /CREATE TABLE IF NOT EXISTS adventure_progress/);
    assert.match(source, /CREATE TABLE IF NOT EXISTS adventure_rewards/);
    assert.match(source, /UNIQUE\(user_id, reward_key\)/);
});
