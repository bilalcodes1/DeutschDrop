import type { D1Database } from '@cloudflare/workers-types';
import { queryAll, queryOne, run } from '../db/queries';

export interface AdventureProgressRow {
    id: number;
    user_id: number;
    world: string;
    stage: number;
    stars: number;
    best_score: number;
    boss_defeated: number;
    reward_key: string | null;
    created_at: string;
    updated_at: string;
}

export async function upsertAdventureProgress(
    db: D1Database,
    userId: number,
    world: string,
    stage: number,
    stars: number,
    score: number,
    bossDefeated = false
): Promise<void> {
    await run(
        db,
        `INSERT INTO adventure_progress (user_id, world, stage, stars, best_score, boss_defeated, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(user_id, world, stage) DO UPDATE SET
            stars = MAX(adventure_progress.stars, excluded.stars),
            best_score = MAX(adventure_progress.best_score, excluded.best_score),
            boss_defeated = CASE WHEN excluded.boss_defeated = 1 THEN 1 ELSE adventure_progress.boss_defeated END,
            updated_at = datetime('now')`,
        [userId, world.slice(0, 40), Math.max(1, Math.trunc(stage)), Math.max(0, Math.min(3, Math.trunc(stars))), Math.max(0, Math.trunc(score)), bossDefeated ? 1 : 0]
    );
}

export async function claimAdventureRewardOnce(
    db: D1Database,
    userId: number,
    rewardKey: string,
    sourceType: string,
    sourceId: string | null,
    xpAwarded: number
): Promise<boolean> {
    const result = await run(
        db,
        `INSERT OR IGNORE INTO adventure_rewards (user_id, reward_key, source_type, source_id, xp_awarded)
         VALUES (?, ?, ?, ?, ?)`,
        [userId, rewardKey.slice(0, 100), sourceType.slice(0, 40), sourceId, Math.max(0, Math.trunc(xpAwarded))]
    );
    return ((result.meta as { changes?: number } | undefined)?.changes ?? 0) > 0;
}

export async function getAdventureProgress(db: D1Database, userId: number): Promise<AdventureProgressRow[]> {
    return queryAll<AdventureProgressRow>(
        db,
        `SELECT * FROM adventure_progress WHERE user_id = ? ORDER BY world ASC, stage ASC`,
        [userId]
    );
}

export async function getAdventureAdminStats(db: D1Database): Promise<{
    progressRows: number;
    rewardsRows: number;
    defeatedBosses: number;
}> {
    const row = await queryOne<{ progress_rows: number; rewards_rows: number; defeated_bosses: number }>(
        db,
        `SELECT
            (SELECT COUNT(*) FROM adventure_progress) AS progress_rows,
            (SELECT COUNT(*) FROM adventure_rewards) AS rewards_rows,
            (SELECT COUNT(*) FROM adventure_progress WHERE boss_defeated = 1) AS defeated_bosses`
    );
    return {
        progressRows: row?.progress_rows ?? 0,
        rewardsRows: row?.rewards_rows ?? 0,
        defeatedBosses: row?.defeated_bosses ?? 0,
    };
}
