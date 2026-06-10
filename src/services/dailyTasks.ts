import type { BotContext } from '../bot/context';
import { queryAll, queryOne, run } from '../db/queries';
import { IMPORTANT_TEMP_FALLBACK_TTL_SECONDS, recordTemporaryMessage } from '../repositories/temporaryMessageRepository';
import { addXp } from './xpLevels';

const DAILY_TASK_XP = 50;

export type DailyTaskType = 'learn_words' | 'review_words' | 'complete_training';

const TASK_TARGETS: Record<DailyTaskType, number> = {
    learn_words: 5,
    review_words: 10,
    complete_training: 1,
};

const TASK_LABELS: Record<DailyTaskType, string> = {
    learn_words: 'تعلم 5 كلمات',
    review_words: 'راجع 10 كلمات',
    complete_training: 'أكمل تدريب واحد',
};

export async function ensureDailyTasks(ctx: BotContext, userId: number): Promise<void> {
    for (const taskType of Object.keys(TASK_TARGETS) as DailyTaskType[]) {
        await run(
            ctx.db,
            `INSERT OR IGNORE INTO daily_tasks (user_id, task_date, task_type, target)
             VALUES (?, date('now'), ?, ?)`,
            [userId, taskType, TASK_TARGETS[taskType]]
        );
    }
}

export async function incrementDailyTask(ctx: BotContext, userId: number, taskType: DailyTaskType, amount: number = 1): Promise<void> {
    await ensureDailyTasks(ctx, userId);
    const before = await getTask(ctx, userId, taskType);
    await run(
        ctx.db,
        `UPDATE daily_tasks
         SET progress = MIN(target, progress + ?),
             completed = CASE WHEN progress + ? >= target THEN 1 ELSE completed END
         WHERE user_id = ? AND task_date = date('now') AND task_type = ?`,
        [amount, amount, userId, taskType]
    );

    const after = await getTask(ctx, userId, taskType);
    if (before && after && before.completed === 0 && after.completed === 1 && after.xp_awarded === 0) {
        await addXp(ctx.db, userId, DAILY_TASK_XP, {
            reason: `daily_task_${taskType}`,
            sourceType: 'daily_task',
            sourceId: taskType,
        });
        await run(
            ctx.db,
            `UPDATE daily_tasks SET xp_awarded = 1
             WHERE user_id = ? AND task_date = date('now') AND task_type = ?`,
            [userId, taskType]
        );
        const text = `🎯 اكتملت مهمة اليوم! +${DAILY_TASK_XP} XP\n${TASK_LABELS[taskType]}`;
        const message = await ctx.reply(text);
        await recordTemporaryMessage(ctx.db, {
            userId,
            chatId: message.chat.id,
            messageId: message.message_id,
            kind: 'daily_task_completed',
            text,
            deletePolicy: 'after_next_interaction',
            ttlSeconds: IMPORTANT_TEMP_FALLBACK_TTL_SECONDS,
        }).catch(() => {});
    }
}

export async function getTodayTasks(ctx: BotContext, userId: number): Promise<Array<{ task_type: DailyTaskType; target: number; progress: number; completed: number }>> {
    await ensureDailyTasks(ctx, userId);
    return queryAll(
        ctx.db,
        `SELECT task_type, target, progress, completed
         FROM daily_tasks
         WHERE user_id = ? AND task_date = date('now')
         ORDER BY task_type`,
        [userId]
    );
}

export function formatDailyTasks(tasks: Array<{ task_type: DailyTaskType; target: number; progress: number; completed: number }>): string {
    return tasks
        .map(task => `${task.completed ? '✅' : '▫️'} ${TASK_LABELS[task.task_type]} (${task.progress}/${task.target})`)
        .join('\n');
}

async function getTask(ctx: BotContext, userId: number, taskType: DailyTaskType): Promise<{ completed: number; xp_awarded: number } | null> {
    return queryOne(
        ctx.db,
        `SELECT completed, xp_awarded FROM daily_tasks
         WHERE user_id = ? AND task_date = date('now') AND task_type = ?`,
        [userId, taskType]
    );
}
