import type { D1Database } from '@cloudflare/workers-types';
import { queryOne, run } from '../db/queries';
import type { DailyReviewPlan } from '../models';

export async function createDailyReviewPlan(
    db: D1Database,
    userId: number,
    planType: 'all_words_day' | 'all_words_week',
    totalWords: number,
    batchSize: number = 10
): Promise<number> {
    await cancelActiveReviewPlan(db, userId);
    const days = planType === 'all_words_day' ? 1 : 7;
    const result = await run(
        db,
        `INSERT INTO daily_review_plans (user_id, plan_type, total_words, reviewed_words, batch_size, ends_at, is_active)
         VALUES (?, ?, ?, 0, ?, datetime('now', ?), 1)`,
        [userId, planType, totalWords, batchSize, `+${days} days`]
    );
    return (result.meta as { last_row_id?: number })?.last_row_id ?? 0;
}

export async function getActiveReviewPlan(db: D1Database, userId: number): Promise<DailyReviewPlan | null> {
    return queryOne<DailyReviewPlan>(
        db,
        `SELECT * FROM daily_review_plans
         WHERE user_id = ? AND is_active = 1 AND ends_at > datetime('now')
         ORDER BY started_at DESC
         LIMIT 1`,
        [userId]
    );
}

export async function incrementReviewPlanProgress(db: D1Database, planId: number, amount: number): Promise<void> {
    await run(
        db,
        `UPDATE daily_review_plans
         SET reviewed_words = MIN(total_words, reviewed_words + ?),
             is_active = CASE WHEN reviewed_words + ? >= total_words THEN 0 ELSE is_active END
         WHERE id = ?`,
        [amount, amount, planId]
    );
}

export async function cancelActiveReviewPlan(db: D1Database, userId: number): Promise<void> {
    await run(db, 'UPDATE daily_review_plans SET is_active = 0 WHERE user_id = ? AND is_active = 1', [userId]);
}

