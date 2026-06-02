import type { D1Database } from '@cloudflare/workers-types';
import { queryOne, queryAll, run } from '../db/queries';
export { getLevelFromXp, getProgressToNextLevel } from './xpMath';
import { getLevelFromXp } from './xpMath';

// =====================================================
// XP & Level System
// =====================================================

export const XP_RULES = {
    NEW_WORD: 5,
    CORRECT_ANSWER: 2,
    DAILY_CHALLENGE: 50,
    CHALLENGE_WIN: 100,
    DAILY_QUEST: 100,
} as const;

export async function addXp(
    db: D1Database,
    userId: number,
    amount: number,
    reason: string
): Promise<number> {
    await run(
        db,
        'INSERT INTO xp_log (user_id, amount, reason) VALUES (?, ?, ?)',
        [userId, amount, reason]
    );
    const total = await getTotalXp(db, userId);
    return total;
}

export async function getTotalXp(db: D1Database, userId: number): Promise<number> {
    const result = await queryOne<{ total: number }>(
        db,
        'SELECT COALESCE(SUM(amount), 0) as total FROM xp_log WHERE user_id = ?',
        [userId]
    );
    return result?.total ?? 0;
}

export async function getLeaderboard(
    db: D1Database
): Promise<Array<{ user_id: number; name: string; telegram_username: string | null; total_xp: number; level: number }>> {
    const rows = await queryAll<{ user_id: number; name: string; telegram_username: string | null; total_xp: number }>(
        db,
        `SELECT u.user_id, u.name, u.telegram_username, COALESCE(SUM(x.amount), 0) as total_xp
         FROM users u
         LEFT JOIN xp_log x ON u.user_id = x.user_id
         GROUP BY u.user_id
         ORDER BY total_xp DESC`
    );
    return rows.map(r => ({
        ...r,
        level: getLevelFromXp(r.total_xp).level,
    }));
}
