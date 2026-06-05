/// <reference types="@cloudflare/workers-types" />

import { handleWebhook } from './routes/webhook';
import { handleYouglishPage } from './routes/youglish';
import type { Env } from './models';
import { deleteExpiredBotSessions } from './repositories/sessionRepository';
import { ZAINCASH_QR_BASE64 } from './assets_zaincash_qr';
import { sendSmartNotification } from './services/smartNotificationService';
import { getLeaderboardByPeriod, type LeaderboardPeriod } from './services/xpLevels';

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

        if (url.pathname === '/youglish' && request.method === 'GET') {
            return handleYouglishPage(request);
        }

        if (url.pathname === '/support/zaincash-qr') {
            return new Response(base64ToBytes(ZAINCASH_QR_BASE64), {
                headers: {
                    'Content-Type': 'image/jpeg',
                    'Cache-Control': 'public, max-age=31536000, immutable',
                },
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
                    await runLeaderboardChampionNotifications(env);
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

function base64ToBytes(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

async function runLeaderboardChampionNotifications(env: Env): Promise<void> {
    await sendChampionForPeriod(env, 'daily');
    const now = new Date();
    if (now.getUTCDay() === 0) await sendChampionForPeriod(env, 'weekly');
    if (now.getUTCDate() === 1) await sendChampionForPeriod(env, 'monthly');
}

async function sendChampionForPeriod(env: Env, period: Exclude<LeaderboardPeriod, 'all_time'>): Promise<void> {
    const bounds = leaderboardPeriodBounds(period);
    const existing = await env.DB.prepare(
        'SELECT 1 FROM leaderboard_snapshots WHERE period_type = ? AND period_start = ? AND period_end = ?'
    ).bind(period, bounds.start, bounds.end).first();
    if (existing) return;

    const rows = await getLeaderboardByPeriod(env.DB, period);
    const winner = rows.find(row => row.period_xp > 0);
    await env.DB.prepare(
        `INSERT OR IGNORE INTO leaderboard_snapshots (period_type, period_start, period_end, winner_user_id, winner_xp)
         VALUES (?, ?, ?, ?, ?)`
    ).bind(period, bounds.start, bounds.end, winner?.user_id ?? null, winner?.period_xp ?? 0).run();
    if (!winner) return;

    const users = await env.DB.prepare(
        `SELECT u.telegram_id
         FROM users u
         INNER JOIN settings s ON s.user_id = u.user_id
         WHERE u.is_banned = 0
           AND u.display_name IS NOT NULL
           AND s.reminders_enabled = 1
           AND COALESCE(s.leaderboard_notifications_enabled, 1) = 1`
    ).all<{ telegram_id: number }>();

    const title = period === 'daily' ? '👑 بطل اليوم' : period === 'weekly' ? '🔥 بطل الأسبوع' : '👑 بطل الشهر';
    const tail = period === 'daily' ? 'باچر منافسة جديدة 🔥' : 'استمروا، المنافسة بعدها مفتوحة 🔥';
    const text = `${title}\n\n${winner.display_name} تصدر ${period === 'daily' ? 'اليوم' : period === 'weekly' ? 'هذا الأسبوع' : 'هذا الشهر'} بـ ${winner.period_xp} XP.\n${tail}`;
    for (const user of users.results ?? []) {
        await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: user.telegram_id, text }),
        }).catch(() => undefined);
    }
}

function leaderboardPeriodBounds(period: Exclude<LeaderboardPeriod, 'all_time'>): { start: string; end: string } {
    const now = new Date();
    const end = now.toISOString().slice(0, 10);
    if (period === 'daily') return { start: end, end };
    if (period === 'weekly') {
        const start = new Date(now);
        const day = start.getUTCDay() || 7;
        start.setUTCDate(start.getUTCDate() - day + 1);
        return { start: start.toISOString().slice(0, 10), end };
    }
    return { start: `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`, end };
}

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
    const users = await env.DB.prepare(
        `SELECT u.user_id, u.telegram_id, u.updated_at
         FROM users u
         INNER JOIN settings s ON s.user_id = u.user_id
         WHERE u.is_banned = 0
           AND u.display_name IS NOT NULL`
    ).all<{ user_id: number; telegram_id: number; updated_at: string | null }>();

    for (const user of users.results ?? []) {
        await sendSmartNotification(env, user);
    }

    await runTimedDailySummaries(env);
}

async function runDailySummary(env: Env): Promise<void> {
    const users = await env.DB.prepare(
        `SELECT u.user_id, u.telegram_id
         FROM users u
         INNER JOIN settings s ON s.user_id = u.user_id
         WHERE s.reminders_enabled = 1`
    ).all<{ user_id: number; telegram_id: number }>();

    for (const user of users.results ?? []) {
        await sendDailySummaryIfNeeded(env, user.user_id, user.telegram_id);
    }
}

async function runTimedDailySummaries(env: Env): Promise<void> {
    const users = await env.DB.prepare(
        `SELECT u.user_id, u.telegram_id, s.evening_time
         FROM users u
         INNER JOIN settings s ON s.user_id = u.user_id
         WHERE s.reminders_enabled = 1`
    ).all<{ user_id: number; telegram_id: number; evening_time: string }>();

    const hour = getBaghdadHour();
    for (const user of users.results ?? []) {
        if (parseHour(user.evening_time) === hour) {
            await sendDailySummaryIfNeeded(env, user.user_id, user.telegram_id);
        }
    }
}

async function sendDailySummaryIfNeeded(env: Env, userId: number, telegramId: number): Promise<void> {
    const alreadySent = await env.DB.prepare(
        'SELECT 1 FROM daily_summaries WHERE user_id = ? AND summary_date = date("now") AND sent_at IS NOT NULL'
    ).bind(userId).first();
    if (alreadySent) return;

    const wordsResult = await env.DB.prepare(
        'SELECT COUNT(*) as cnt FROM reviews WHERE user_id = ? AND date(reviewed_at) = date("now")'
    ).bind(userId).first<{ cnt: number }>();

    const xpResult = await env.DB.prepare(
        'SELECT COALESCE(SUM(amount), 0) as total FROM xp_log WHERE user_id = ? AND date(created_at) = date("now")'
    ).bind(userId).first<{ total: number }>();

    const streakResult = await env.DB.prepare(
        'SELECT current_streak FROM daily_streaks WHERE user_id = ?'
    ).bind(userId).first<{ current_streak: number }>();

    const tasks = await env.DB.prepare(
        `SELECT task_type, target, progress, completed
         FROM daily_tasks
         WHERE user_id = ? AND task_date = date("now")
         ORDER BY task_type`
    ).bind(userId).all<{ task_type: string; target: number; progress: number; completed: number }>();

    const words = wordsResult?.cnt ?? 0;
    const xp = xpResult?.total ?? 0;
    const streak = streakResult?.current_streak ?? 0;
    const taskText = (tasks.results ?? []).map(task => {
        const label = task.task_type === 'learn_words'
            ? 'تعلم 5 كلمات'
            : task.task_type === 'review_words'
                ? 'راجع 10 كلمات'
                : 'أكمل تدريب واحد';
        return `${task.completed ? '✅' : '▫️'} ${label} (${task.progress}/${task.target})`;
    }).join('\n');

    let text = '📊 *ملخص يومك*\n\n';
    if (words === 0 && xp === 0) {
        text += 'لم تقم بأي نشاط اليوم. لا بأس، غداً يوم جديد.\n';
    } else {
        text += `📚 كلمات مراجعة: ${words}\n⭐ XP: +${xp}\n🔥 سلسلة أيام: ${streak}\n`;
    }
    if (taskText) text += `\n🎯 *مهام اليوم*\n${taskText}`;

    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: telegramId,
            text,
            parse_mode: 'Markdown',
        }),
    });

    await env.DB.prepare(
        `INSERT INTO daily_summaries (user_id, summary_date, words_learned, xp_earned, train_questions, sent_at)
         VALUES (?, date("now"), ?, ?, ?, datetime("now"))
         ON CONFLICT(user_id, summary_date) DO UPDATE SET
         words_learned = excluded.words_learned,
         xp_earned = excluded.xp_earned,
         train_questions = excluded.train_questions,
         sent_at = excluded.sent_at`
    ).bind(userId, words, xp, words).run();
}

function shouldSendReminderNow(user: { notification_mode: string; morning_time: string; evening_time: string }): boolean {
    if (user.notification_mode === 'all_day') return true;

    const hour = getBaghdadHour();
    if (user.notification_mode === 'morning') {
        return parseHour(user.morning_time) === hour;
    }
    if (user.notification_mode === 'morning_evening') {
        return parseHour(user.morning_time) === hour || parseHour(user.evening_time) === hour;
    }
    return false;
}

function parseHour(time: string | null | undefined): number {
    const hour = Number((time ?? '08:00').split(':')[0]);
    return Number.isFinite(hour) ? hour : 8;
}

function getBaghdadHour(): number {
    const hour = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Baghdad',
        hour: '2-digit',
        hour12: false,
    }).format(new Date());
    return Number(hour);
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
