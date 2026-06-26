import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import Database from 'better-sqlite3';
import {
    createImageAsset,
    createShareImageSnapshotsForWords,
    excludeWordFromImageMode,
    getCollectionImageReadiness,
    resolveEffectiveWordImage,
    selectWordImage,
} from '../dist/repositories/wordImageRepository.js';
import { copyWordToUser, createWordAndAssignToUser } from '../dist/repositories/wordRepository.js';
import { copyWordsToUser } from '../dist/repositories/wordSharingRepository.js';
import { buildWordImageFingerprint } from '../dist/services/wordImageFingerprint.js';

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
                        const prepared = sqlite.prepare(sql);
                        if (prepared.reader) {
                            const rows = prepared.all(...params);
                            return Promise.resolve({ success: true, results: rows, meta: { changes: rows.length, last_row_id: rows[0]?.word_id ?? 0 } });
                        }
                        const info = prepared.run(...params);
                        return Promise.resolve({ success: true, meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) } });
                    },
                };
            },
        };
    }
    batch(statements) {
        return Promise.all(statements.map(statement => statement.run()));
    }
}

function createDb() {
    const sqlite = new Database(':memory:');
    sqlite.exec(`
        CREATE TABLE users (user_id INTEGER PRIMARY KEY, telegram_id INTEGER, name TEXT, display_name TEXT, is_banned INTEGER DEFAULT 0, is_deleted INTEGER DEFAULT 0);
        CREATE TABLE settings (user_id INTEGER PRIMARY KEY, german_level TEXT);
        CREATE TABLE words (
            word_id INTEGER PRIMARY KEY AUTOINCREMENT,
            german TEXT NOT NULL,
            arabic TEXT NOT NULL,
            example TEXT,
            example_ar TEXT,
            pronunciation_ar TEXT,
            pronunciation_latin TEXT,
            level TEXT,
            added_by INTEGER NOT NULL,
            german_search TEXT,
            arabic_search TEXT,
            example_search TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT
        );
        CREATE TABLE user_words (user_id INTEGER, word_id INTEGER, status TEXT, next_review TEXT);
        CREATE TABLE word_pictograms (word_id INTEGER, provider TEXT, pictogram_id TEXT, image_url TEXT, thumbnail_url TEXT, title TEXT, license TEXT, attribution TEXT, source_url TEXT);
        CREATE TABLE word_collections (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_user_id INTEGER, title TEXT, description TEXT, visibility TEXT DEFAULT 'public', is_deleted INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE word_collection_items (id INTEGER PRIMARY KEY AUTOINCREMENT, collection_id INTEGER, word_id INTEGER, owner_user_id INTEGER, position INTEGER DEFAULT 1);
        INSERT INTO users (user_id, telegram_id, name, display_name) VALUES (1, 1001, 'Admin', 'Admin'), (2, 1002, 'Mira', 'Mira');
        INSERT INTO words (word_id, german, arabic, example, added_by) VALUES
            (101, 'der Tiger', 'النمر', NULL, 1),
            (102, 'die Ente', 'البطة', NULL, 1);
        INSERT INTO user_words VALUES (1, 101, 'new', datetime('now')), (1, 102, 'new', datetime('now'));
        INSERT INTO word_collections (id, owner_user_id, title, visibility, is_deleted) VALUES (10, 1, 'Animals', 'public', 0);
        INSERT INTO word_collection_items (collection_id, word_id, owner_user_id, position) VALUES (10, 101, 1, 1), (10, 102, 1, 2);
    `);
    sqlite.exec(fs.readFileSync(new URL('../src/db/migrations/0046_word_images_adventure.sql', import.meta.url), 'utf8'));
    sqlite.exec(fs.readFileSync(new URL('../src/db/migrations/0048_image_inheritance_and_sharing.sql', import.meta.url), 'utf8'));
    return new MockD1(sqlite);
}

test('word image fingerprint matches definite article and Arabic article variants but not ambiguous meanings', () => {
    assert.equal(
        buildWordImageFingerprint({ german: 'das Auto', arabic: 'سيارة' }),
        buildWordImageFingerprint({ german: 'Auto', arabic: 'السيارة' })
    );
    assert.notEqual(
        buildWordImageFingerprint({ german: 'Bank', arabic: 'مصرف' }),
        buildWordImageFingerprint({ german: 'Bank', arabic: 'مقعد' })
    );
});

test('admin selected image becomes global catalog and new matching words inherit it', async () => {
    const db = createDb();
    const assetId = await createImageAsset(db, { ownerUserId: 1, provider: 'legacy', storageType: 'legacy', hotlinkUrl: 'legacy:tiger' });
    await selectWordImage(db, 1, 10, 101, assetId, { isAdminDefault: true });

    const wordId = await createWordAndAssignToUser(db, 'Tiger', 'النمر', null, 2);
    const inherited = await resolveEffectiveWordImage(db, 2, wordId);

    assert.equal(inherited?.asset_id, assetId);
    assert.equal(inherited?.origin_type, 'admin_default');
    assert.equal(inherited?.is_user_override, 0);
});

test('community shared snapshot publishes only the selected shared image to the pool', async () => {
    const db = createDb();
    const assetId = await createImageAsset(db, { ownerUserId: 1, provider: 'manual_upload', storageType: 'r2', r2Key: 'word-images/1/tiger.jpg' });
    await selectWordImage(db, 1, 10, 101, assetId);
    await createShareImageSnapshotsForWords(db, 'collection', 10, 1, [101], 10);

    const wordId = await createWordAndAssignToUser(db, 'der Tiger', 'النمر', null, 2);
    const inherited = await resolveEffectiveWordImage(db, 2, wordId);

    assert.equal(inherited?.asset_id, assetId);
    assert.equal(inherited?.origin_type, 'community_shared');
    assert.equal(db.sqlite.prepare('SELECT visibility FROM image_assets WHERE id = ?').get(assetId).visibility, 'shared');
});

test('copying a collection references source images without copying R2 binary and readiness is immediate', async () => {
    const db = createDb();
    const assetId = await createImageAsset(db, { ownerUserId: 1, provider: 'manual_upload', storageType: 'r2', r2Key: 'word-images/1/10/101/tiger.jpg' });
    await selectWordImage(db, 1, 10, 101, assetId);

    const result = await copyWordsToUser(db, [101], 2, { sourceCollectionId: 10, originType: 'copied_collection', shareType: 'collection', shareId: 10 });
    const copyCollectionId = db.sqlite.prepare("INSERT INTO word_collections (owner_user_id, title, visibility) VALUES (2, 'Copied', 'public')").run().lastInsertRowid;
    db.sqlite.prepare('INSERT INTO word_collection_items (collection_id, word_id, owner_user_id, position) VALUES (?, ?, 2, 1)').run(copyCollectionId, result.copiedWordIds[0]);

    const copied = await resolveEffectiveWordImage(db, 2, result.copiedWordIds[0], Number(copyCollectionId));
    const readiness = await getCollectionImageReadiness(db, 2, Number(copyCollectionId));

    assert.equal(copied?.asset_id, assetId);
    assert.equal(copied?.origin_type, 'copied_collection');
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM image_assets WHERE r2_key = ?').get('word-images/1/10/101/tiger.jpg').count, 1);
    assert.equal(readiness.isReady, true);
});

test('copying an existing word fills only missing image and never overwrites user override', async () => {
    const db = createDb();
    const sourceAsset = await createImageAsset(db, { ownerUserId: 1, provider: 'legacy', storageType: 'legacy', hotlinkUrl: 'legacy:tiger' });
    const targetAsset = await createImageAsset(db, { ownerUserId: 2, provider: 'legacy', storageType: 'legacy', hotlinkUrl: 'legacy:custom-tiger' });
    await selectWordImage(db, 1, 10, 101, sourceAsset);

    const targetWordId = await createWordAndAssignToUser(db, 'der Tiger', 'النمر', null, 2);
    const collectionId = db.sqlite.prepare("INSERT INTO word_collections (owner_user_id, title, visibility) VALUES (2, 'Mine', 'public')").run().lastInsertRowid;
    db.sqlite.prepare('INSERT INTO word_collection_items (collection_id, word_id, owner_user_id, position) VALUES (?, ?, 2, 1)').run(collectionId, targetWordId);
    await selectWordImage(db, 2, Number(collectionId), targetWordId, targetAsset);

    const duplicate = await copyWordToUser(db, 101, 2, { sourceCollectionId: 10 });
    const current = await resolveEffectiveWordImage(db, 2, duplicate.wordId, Number(collectionId));

    assert.equal(duplicate.status, 'duplicate');
    assert.equal(current?.asset_id, targetAsset);
});

test('excluded source word does not copy exclusion or selected image to receiver', async () => {
    const db = createDb();
    const assetId = await createImageAsset(db, { ownerUserId: 1, provider: 'legacy', storageType: 'legacy', hotlinkUrl: 'legacy:duck' });
    await selectWordImage(db, 1, 10, 102, assetId);
    await excludeWordFromImageMode(db, 1, 10, 102, 'manual');

    const result = await copyWordToUser(db, 102, 2, { sourceCollectionId: 10, originType: 'copied_collection' });
    const copied = await resolveEffectiveWordImage(db, 2, result.wordId);

    assert.equal(result.status, 'copied');
    assert.equal(copied, null);
});
