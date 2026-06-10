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

export interface AddXpOptions {
    reason: string;
    sourceType?: string;
    sourceId?: string;
    metadata?: Record<string, any>;
    allowDailyCap?: boolean;
}

export function calculateCappedAmount(amount: number, todayCapped: number, dailyCap: number): number {
    if (todayCapped >= dailyCap) return 0;
    if (todayCapped + amount > dailyCap) return dailyCap - todayCapped;
    return amount;
}

export async function addXp(
    db: D1Database,
    userId: number,
    amount: number,
    options: AddXpOptions | string
): Promise<number> {
    const reason = typeof options === 'string' ? options : options.reason;
    const sourceType = typeof options === 'string' ? null : options.sourceType ?? null;
    const sourceId = typeof options === 'string' ? null : options.sourceId ?? null;
    const metadata = typeof options === 'string' ? null : options.metadata ?? null;
    const allowDailyCap = typeof options === 'string' ? false : options.allowDailyCap ?? false;

    let finalAmount = amount;
    let capApplied = 0;
    const multiplier = 1.0;
    const dailyCapEligible = allowDailyCap ? 1 : 0;

    if (allowDailyCap) {
        try {
            const capQuery = await queryOne<{ today_capped: number }>(
                db,
                `SELECT COALESCE(SUM(final_amount), 0) as today_capped
                 FROM xp_transactions
                 WHERE user_id = ? AND daily_cap_eligible = 1 AND date(created_at) = date('now')`,
                [userId]
            );
            const todayCapped = capQuery?.today_capped ?? 0;
            const DAILY_CAP = 300;

            finalAmount = calculateCappedAmount(amount, todayCapped, DAILY_CAP);
            if (finalAmount < amount) {
                capApplied = 1;
            }
        } catch (e) {
            // Ignore error if table doesn't exist yet in some environments
        }
    }

    const metadataJson = metadata ? JSON.stringify(metadata) : null;

    try {
        await run(
            db,
            `INSERT INTO xp_transactions (user_id, amount, base_amount, final_amount, reason, source_type, source_id, multiplier, cap_applied, daily_cap_eligible, metadata_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [userId, finalAmount, amount, finalAmount, reason, sourceType, sourceId, multiplier, capApplied, dailyCapEligible, metadataJson]
        );
    } catch (e) {
        // Fallback for tests/environments where migration 0036 is not yet applied
    }
    await run(
        db,
        'INSERT INTO xp_log (user_id, amount, reason) VALUES (?, ?, ?)',
        [userId, finalAmount, reason]
    );
    await run(
        db,
        'INSERT INTO xp_events (user_id, amount, reason) VALUES (?, ?, ?)',
        [userId, finalAmount, reason]
    ).catch(() => undefined);
    const total = await getTotalXp(db, userId);
    const level = getLevelFromXp(total).level;
    await run(
        db,
        'UPDATE users SET xp = ?, level = ?, updated_at = datetime("now") WHERE user_id = ?',
        [total, level, userId]
    );
    return total;
}

export type LeaderboardPeriod = 'daily' | 'weekly' | 'monthly' | 'all_time';

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
): Promise<Array<{ user_id: number; display_name: string; telegram_username: string | null; total_xp: number; weekly_xp: number; level: number; achievements_count: number; is_supporter_active: number }>> {
    const rows = await queryAll<{ user_id: number; display_name: string; telegram_username: string | null; total_xp: number; weekly_xp: number; achievements_count: number; is_supporter_active: number }>(
        db,
        `SELECT u.user_id,
                COALESCE(u.display_name, u.name) AS display_name,
                COALESCE(u.username, u.telegram_username) AS telegram_username,
                COALESCE(SUM(x.amount), 0) AS total_xp,
                COALESCE(SUM(CASE WHEN x.created_at >= datetime('now', '-7 days') THEN x.amount ELSE 0 END), 0) AS weekly_xp,
                COUNT(DISTINCT ua.achievement_id) AS achievements_count,
                CASE
                    WHEN us.is_supporter = 1 AND us.supporter_until > datetime('now') THEN 1
                    ELSE 0
                END AS is_supporter_active
         FROM users u
         LEFT JOIN xp_log x ON u.user_id = x.user_id
         LEFT JOIN user_achievements ua ON ua.user_id = u.user_id
         LEFT JOIN user_support_status us ON us.user_id = u.user_id
         WHERE u.display_name IS NOT NULL
         GROUP BY u.user_id
         ORDER BY total_xp DESC`
    );
    return rows.map(r => ({
        ...r,
        level: getLevelFromXp(r.total_xp).level,
    }));
}

export async function getLeaderboardByPeriod(
    db: D1Database,
    period: LeaderboardPeriod
): Promise<Array<{ user_id: number; display_name: string; total_xp: number; period_xp: number; achievements_count: number; is_supporter_active: number }>> {
    if (period === 'all_time') {
        const rows = await getLeaderboard(db);
        return rows.map(row => ({
            user_id: row.user_id,
            display_name: row.display_name,
            total_xp: row.total_xp,
            period_xp: row.total_xp,
            achievements_count: row.achievements_count,
            is_supporter_active: row.is_supporter_active,
        }));
    }

    const condition = periodCondition(period);
    return queryAll(
        db,
        `SELECT u.user_id,
                COALESCE(u.display_name, u.name) AS display_name,
                COALESCE(u.xp, 0) AS total_xp,
                COALESCE(SUM(x.amount), 0) AS period_xp,
                COUNT(DISTINCT ua.achievement_id) AS achievements_count,
                CASE
                    WHEN us.is_supporter = 1 AND us.supporter_until > datetime('now') THEN 1
                    ELSE 0
                END AS is_supporter_active
         FROM users u
         LEFT JOIN xp_events x ON x.user_id = u.user_id AND ${condition}
         LEFT JOIN user_achievements ua ON ua.user_id = u.user_id
         LEFT JOIN user_support_status us ON us.user_id = u.user_id
         WHERE u.display_name IS NOT NULL
         GROUP BY u.user_id
         ORDER BY period_xp DESC, total_xp DESC`
    );
}

export async function createLeaderboardSnapshot(
    db: D1Database,
    period: Exclude<LeaderboardPeriod, 'all_time'>
): Promise<{ winner_user_id: number | null; winner_xp: number }> {
    const rows = await getLeaderboardByPeriod(db, period);
    const winner = rows.find(row => row.period_xp > 0);
    const bounds = periodBounds(period);
    await run(
        db,
        `INSERT INTO leaderboard_snapshots (period_type, period_start, period_end, winner_user_id, winner_xp)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(period_type, period_start, period_end) DO UPDATE SET
         winner_user_id = excluded.winner_user_id,
         winner_xp = excluded.winner_xp,
         created_at = datetime('now')`,
        [period, bounds.start, bounds.end, winner?.user_id ?? null, winner?.period_xp ?? 0]
    );
    return { winner_user_id: winner?.user_id ?? null, winner_xp: winner?.period_xp ?? 0 };
}

function periodCondition(period: Exclude<LeaderboardPeriod, 'all_time'>): string {
    if (period === 'daily') return `date(x.created_at) = date('now')`;
    if (period === 'weekly') return `date(x.created_at) >= date('now', 'weekday 1', '-7 days')`;
    return `strftime('%Y-%m', x.created_at) = strftime('%Y-%m', 'now')`;
}

function periodBounds(period: Exclude<LeaderboardPeriod, 'all_time'>): { start: string; end: string } {
    const today = new Date();
    const end = today.toISOString().slice(0, 10);
    if (period === 'daily') return { start: end, end };
    if (period === 'weekly') {
        const start = new Date(today);
        const day = start.getUTCDay() || 7;
        start.setUTCDate(start.getUTCDate() - day + 1);
        return { start: start.toISOString().slice(0, 10), end };
    }
    return { start: `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-01`, end };
}
