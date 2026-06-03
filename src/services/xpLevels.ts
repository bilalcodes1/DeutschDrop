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
    const level = getLevelFromXp(total).level;
    await run(
        db,
        'UPDATE users SET xp = ?, level = ?, updated_at = datetime("now") WHERE user_id = ?',
        [total, level, userId]
    );
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
): Promise<Array<{ user_id: number; display_name: string; telegram_username: string | null; total_xp: number; weekly_xp: number; level: number; achievements_count: number }>> {
    const rows = await queryAll<{ user_id: number; display_name: string; telegram_username: string | null; total_xp: number; weekly_xp: number; achievements_count: number }>(
        db,
        `SELECT u.user_id,
                COALESCE(u.display_name, u.name) AS display_name,
                COALESCE(u.username, u.telegram_username) AS telegram_username,
                COALESCE(SUM(x.amount), 0) AS total_xp,
                COALESCE(SUM(CASE WHEN x.created_at >= datetime('now', '-7 days') THEN x.amount ELSE 0 END), 0) AS weekly_xp,
                COUNT(DISTINCT ua.achievement_id) AS achievements_count
         FROM users u
         LEFT JOIN xp_log x ON u.user_id = x.user_id
         LEFT JOIN user_achievements ua ON ua.user_id = u.user_id
         WHERE u.display_name IS NOT NULL
         GROUP BY u.user_id
         ORDER BY total_xp DESC`
    );
    return rows.map(r => ({
        ...r,
        level: getLevelFromXp(r.total_xp).level,
    }));
}
