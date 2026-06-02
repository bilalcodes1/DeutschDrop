/// <reference types="@cloudflare/workers-types" />

import { handleWebhook } from './routes/webhook';
import type { Env } from './models';
import { deleteExpiredBotSessions } from './repositories/sessionRepository';

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url);

        // Route: Telegram webhook
        if (url.pathname === '/webhook' && request.method === 'POST') {
            return handleWebhook(request, env);
        }

        // Route: Health check
        if (url.pathname === '/health') {
            return new Response(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }), {
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Default: 404
        return new Response('Not Found', { status: 404 });
    },

    async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
        const jobName = getJobNameFromCron(event.cron);
        console.log(`Running scheduled job: ${jobName}`);

        try {
            await deleteExpiredBotSessions(env.DB);

            switch (jobName) {
                case 'check_due_reviews': {
                    await runCheckDueReviews(env);
                    break;
                }
                case 'generate_daily_summary': {
                    await runDailySummary(env);
                    break;
                }
                case 'update_streaks': {
                    await runUpdateStreaks(env);
                    break;
                }
                default:
                    console.log(`Unknown cron job: ${jobName}`);
            }

            // Record job run
            await env.DB.prepare(
                'INSERT INTO job_runs (job_name, last_run, status) VALUES (?, datetime("now"), "success") ON CONFLICT(job_name) DO UPDATE SET last_run = excluded.last_run, status = excluded.status'
            ).bind(jobName).run();
        } catch (error) {
            console.error(`Cron job ${jobName} failed:`, error);
            await env.DB.prepare(
                'INSERT INTO job_runs (job_name, last_run, status) VALUES (?, datetime("now"), "failed") ON CONFLICT(job_name) DO UPDATE SET last_run = excluded.last_run, status = excluded.status'
            ).bind(jobName).run();
        }
    },
};

function getJobNameFromCron(cron: string): string {
    if (cron === '0 * * * *') return 'check_due_reviews';
    if (cron === '0 20 * * *') return 'generate_daily_summary';
    if (cron === '0 0 * * *') return 'update_streaks';
    return 'unknown';
}

// =====================================================
// Cron Job Implementations
// =====================================================

async function runCheckDueReviews(env: Env): Promise<void> {
    // Get all users with due words
    const users = await env.DB.prepare(
        `SELECT DISTINCT u.user_id, u.telegram_id
         FROM users u
         INNER JOIN user_words uw ON u.user_id = uw.user_id
         WHERE (uw.status = 'new' OR uw.next_review <= datetime('now'))`
    ).all<{ user_id: number; telegram_id: number }>();

    const token = env.TELEGRAM_BOT_TOKEN;
    for (const user of users.results ?? []) {
        // Count due words
        const count = await env.DB.prepare(
            'SELECT COUNT(*) as cnt FROM user_words WHERE user_id = ? AND (status = "new" OR next_review <= datetime("now"))'
        ).bind(user.user_id).first<{ cnt: number }>();

        const dueCount = count?.cnt ?? 0;
        if (dueCount > 0) {
            await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: user.telegram_id,
                    text: `📚 لديك ${dueCount} كلمة مستحقة للمراجعة!\nاستخدم /learn للبدء.`,
                }),
            });
        }
    }
}

async function runDailySummary(env: Env): Promise<void> {
    const users = await env.DB.prepare(
        'SELECT user_id, telegram_id FROM users'
    ).all<{ user_id: number; telegram_id: number }>();

    const token = env.TELEGRAM_BOT_TOKEN;
    for (const user of users.results ?? []) {
        // Get today's activity
        const wordsResult = await env.DB.prepare(
            'SELECT COUNT(*) as cnt FROM reviews WHERE user_id = ? AND date(reviewed_at) = date("now")'
        ).bind(user.user_id).first<{ cnt: number }>();

        const xpResult = await env.DB.prepare(
            'SELECT COALESCE(SUM(amount), 0) as total FROM xp_log WHERE user_id = ? AND date(created_at) = date("now")'
        ).bind(user.user_id).first<{ total: number }>();

        const streakResult = await env.DB.prepare(
            'SELECT current_streak FROM daily_streaks WHERE user_id = ?'
        ).bind(user.user_id).first<{ current_streak: number }>();

        const words = wordsResult?.cnt ?? 0;
        const xp = xpResult?.total ?? 0;
        const streak = streakResult?.current_streak ?? 0;

        let text = '📊 *ملخص يومك*\n\n';
        if (words === 0 && xp === 0) {
            text += 'لم تقم بأي نشاط اليوم. لا بأس، غداً يوم جديد! 💪';
        } else {
            text += `📚 كلمات مراجعة: ${words}\n⭐ XP: +${xp}\n🔥 سلسلة أيام: ${streak}`;
        }

        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: user.telegram_id,
                text,
                parse_mode: 'Markdown',
            }),
        });
    }
}

async function runUpdateStreaks(env: Env): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    const streaks = await env.DB.prepare(
        'SELECT user_id, last_active_date, current_streak FROM daily_streaks'
    ).all<{ user_id: number; last_active_date: string | null; current_streak: number }>();

    for (const s of streaks.results ?? []) {
        if (s.last_active_date === yesterdayStr) {
            // Streak continues, update last_active to today
            await env.DB.prepare(
                'UPDATE daily_streaks SET last_active_date = ? WHERE user_id = ?'
            ).bind(today, s.user_id).run();
        } else if (s.last_active_date !== today) {
            // Streak broken
            await env.DB.prepare(
                'UPDATE daily_streaks SET current_streak = 0, last_active_date = ? WHERE user_id = ?'
            ).bind(today, s.user_id).run();
        }
    }
}
