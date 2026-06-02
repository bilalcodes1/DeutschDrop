import type { D1Database } from '@cloudflare/workers-types';
import { queryOne, queryAll, run } from '../db/queries';
import { getTotalXp } from './xpLevels';

// =====================================================
// Daily Streak & Summary Service
// =====================================================

/**
 * Update user streaks. Call this once per day (after midnight).
 */
export async function updateAllStreaks(db: D1Database): Promise<void> {
    const users = await queryAll<{ user_id: number; last_active_date: string | null }>(
        db,
        'SELECT user_id, last_active_date FROM daily_streaks'
    );

    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    for (const user of users) {
        if (user.last_active_date === yesterdayStr) {
            // Continue streak
            await run(
                db,
                'UPDATE daily_streaks SET current_streak = current_streak + 1, last_active_date = ? WHERE user_id = ?',
                [today, user.user_id]
            );
        } else if (user.last_active_date !== today) {
            // Streak broken
            await run(
                db,
                'UPDATE daily_streaks SET current_streak = 0, last_active_date = ? WHERE user_id = ?',
                [today, user.user_id]
            );
        }
    }
}

/**
 * Mark a user as active today (update streak and last_active_date).
 */
export async function markUserActive(db: D1Database, userId: number): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    const existing = await queryOne<{ last_active_date: string | null }>(
        db,
        'SELECT last_active_date FROM daily_streaks WHERE user_id = ?',
        [userId]
    );

    if (!existing) {
        await run(
            db,
            'INSERT INTO daily_streaks (user_id, current_streak, last_active_date) VALUES (?, 1, ?)',
            [userId, today]
        );
        return;
    }

    if (existing.last_active_date !== today) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];

        if (existing.last_active_date === yesterdayStr) {
            await run(
                db,
                'UPDATE daily_streaks SET current_streak = current_streak + 1, last_active_date = ? WHERE user_id = ?',
                [today, userId]
            );
        } else {
            await run(
                db,
                'UPDATE daily_streaks SET current_streak = 1, last_active_date = ? WHERE user_id = ?',
                [today, userId]
            );
        }
    }
}

/**
 * Get user streak info.
 */
export async function getUserStreak(
    db: D1Database,
    userId: number
): Promise<{ current_streak: number; last_active_date: string | null } | null> {
    return queryOne(db, 'SELECT current_streak, last_active_date FROM daily_streaks WHERE user_id = ?', [userId]);
}

/**
 * Generate daily summary for a user.
 */
export async function generateDailySummary(
    db: D1Database,
    userId: number
): Promise<{ words_learned: number; xp_earned: number; train_questions: number }> {
    const today = new Date().toISOString().split('T')[0];

    // Words learned today (reviews where status changed from new)
    const wordsResult = await queryOne<{ count: number }>(
        db,
        `SELECT COUNT(*) as count FROM reviews
         WHERE user_id = ? AND date(reviewed_at) = date('now')`,
        [userId]
    );

    // XP earned today
    const xpResult = await queryOne<{ total: number }>(
        db,
        `SELECT COALESCE(SUM(amount), 0) as total FROM xp_log
         WHERE user_id = ? AND date(created_at) = date('now')`,
        [userId]
    );

    // Training questions answered today
    const trainResult = await queryOne<{ count: number }>(
        db,
        `SELECT COUNT(*) as count FROM reviews
         WHERE user_id = ? AND date(reviewed_at) = date('now')`,
        [userId]
    );

    const summary = {
        words_learned: wordsResult?.count ?? 0,
        xp_earned: xpResult?.total ?? 0,
        train_questions: trainResult?.count ?? 0,
    };

    // Save summary
    await run(
        db,
        `INSERT INTO daily_summaries (user_id, summary_date, words_learned, xp_earned, train_questions, sent_at)
         VALUES (?, date('now'), ?, ?, ?, datetime('now'))
         ON CONFLICT(user_id, summary_date) DO UPDATE SET
         words_learned = excluded.words_learned,
         xp_earned = excluded.xp_earned,
         train_questions = excluded.train_questions,
         sent_at = datetime('now')`,
        [userId, summary.words_learned, summary.xp_earned, summary.train_questions]
    );

    return summary;
}

/**
 * Get all users who should receive daily summaries.
 */
export async function getUsersForSummary(db: D1Database): Promise<Array<{ user_id: number; telegram_id: number }>> {
    return queryAll(
        db,
        `SELECT u.user_id, u.telegram_id FROM users u
         INNER JOIN settings s ON u.user_id = s.user_id`
    );
}
