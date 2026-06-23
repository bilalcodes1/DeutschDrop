import type { D1Database } from '@cloudflare/workers-types';
import type { AiTaskType } from './aiTypes';

export const AI_DAILY_LIMITS: Record<AiTaskType, number> = {
    generate_example_and_pronunciation: 20,
    generate_pronunciation: 30,
    explain_answer: 30,
    classify_level: 30,
    grade_training_answer: 50,
    generate_life_sentence: 20,
    validate_life_sentence: 20,
};

export interface AiUsageRow {
    task_type: AiTaskType;
    count: number;
    limit: number;
}

export async function canUseAiTask(db: D1Database, userId: number, taskType: AiTaskType): Promise<boolean> {
    const used = await getUsageCount(db, userId, taskType);
    return used < AI_DAILY_LIMITS[taskType];
}

export async function incrementAiUsage(db: D1Database, userId: number, taskType: AiTaskType): Promise<void> {
    await db.prepare(
        `INSERT INTO ai_usage (user_id, usage_date, task_type, count, updated_at)
         VALUES (?, date('now'), ?, 1, datetime('now'))
         ON CONFLICT(user_id, usage_date, task_type)
         DO UPDATE SET count = count + 1, updated_at = datetime('now')`
    ).bind(userId, taskType).run();
}

export async function getAiUsageSummary(db: D1Database, userId: number): Promise<AiUsageRow[]> {
    const rows = await db.prepare(
        `SELECT task_type, count
         FROM ai_usage
         WHERE user_id = ? AND usage_date = date('now')`
    ).bind(userId).all<{ task_type: AiTaskType; count: number }>();
    const counts = new Map((rows.results ?? []).map(row => [row.task_type, row.count]));
    return (Object.keys(AI_DAILY_LIMITS) as AiTaskType[]).map(taskType => ({
        task_type: taskType,
        count: counts.get(taskType) ?? 0,
        limit: AI_DAILY_LIMITS[taskType],
    }));
}

async function getUsageCount(db: D1Database, userId: number, taskType: AiTaskType): Promise<number> {
    const row = await db.prepare(
        `SELECT count FROM ai_usage
         WHERE user_id = ? AND usage_date = date('now') AND task_type = ?`
    ).bind(userId, taskType).first<{ count: number }>();
    return row?.count ?? 0;
}
