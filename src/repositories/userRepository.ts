import type { D1Database } from '@cloudflare/workers-types';
import { queryOne, queryAll, run } from '../db/queries';
import type { User, Settings } from '../models';

export async function getUserByTelegramId(
    db: D1Database,
    telegramId: number
): Promise<User | null> {
    return queryOne<User>(
        db,
        'SELECT * FROM users WHERE (telegram_user_id = ? OR telegram_id = ?) AND COALESCE(is_deleted, 0) = 0',
        [telegramId, telegramId]
    );
}

export async function getUserByTelegramIdIncludingDeleted(
    db: D1Database,
    telegramId: number
): Promise<User | null> {
    return queryOne<User>(
        db,
        'SELECT * FROM users WHERE telegram_user_id = ? OR telegram_id = ?',
        [telegramId, telegramId]
    );
}

export async function createUser(
    db: D1Database,
    name: string,
    telegramId: number,
    telegramUsername: string | null,
    firstName?: string | null,
    lastName?: string | null,
    displayName?: string | null
): Promise<number> {
    const result = await run(
        db,
        `INSERT INTO users (
            id, name, telegram_id, telegram_user_id, telegram_username, username, first_name, last_name, display_name
         ) VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [displayName ?? name, telegramId, telegramId, telegramUsername, telegramUsername, firstName ?? name, lastName ?? null, displayName ?? null]
    );
    const lastId = (result.meta as { last_row_id?: number })?.last_row_id ?? 0;

    await run(db, 'UPDATE users SET id = user_id WHERE user_id = ?', [lastId]);
    await run(db, 'INSERT INTO settings (user_id) VALUES (?)', [lastId]);
    await run(db, 'INSERT INTO daily_streaks (user_id, current_streak) VALUES (?, 0)', [lastId]);
    return lastId;
}

export async function createPendingUser(
    db: D1Database,
    telegramId: number,
    username: string | null,
    firstName: string | null,
    lastName: string | null
): Promise<number> {
    const existing = await getUserByTelegramIdIncludingDeleted(db, telegramId);
    if (existing?.is_deleted) {
        await run(
            db,
            `UPDATE users
             SET is_deleted = 0,
                 deleted_at = NULL,
                 display_name = NULL,
                 name = ?,
                 telegram_username = ?,
                 username = ?,
                 first_name = ?,
                 last_name = ?,
                 updated_at = datetime('now'),
                 last_active_at = datetime('now')
             WHERE user_id = ?`,
            [firstName ?? username ?? 'User', username, username, firstName, lastName, existing.user_id]
        );
        return existing.user_id;
    }
    return createUser(db, firstName ?? username ?? 'User', telegramId, username, firstName, lastName, null);
}

export async function completeUserRegistration(
    db: D1Database,
    userId: number,
    displayName: string
): Promise<void> {
    await run(
        db,
        `UPDATE users
         SET display_name = ?, name = ?, updated_at = datetime('now')
         WHERE user_id = ?`,
        [displayName, displayName, userId]
    );
}

export async function renameUser(
    db: D1Database,
    userId: number,
    displayName: string
): Promise<void> {
    await completeUserRegistration(db, userId, displayName);
}

export function isRegisteredUser(user: User | null): user is User {
    return Boolean(user?.display_name?.trim());
}

export async function getAllUsers(db: D1Database): Promise<User[]> {
    return queryAll<User>(db, 'SELECT * FROM users WHERE display_name IS NOT NULL AND COALESCE(is_deleted, 0) = 0 ORDER BY created_at DESC');
}

export async function getAdminUserList(db: D1Database, limit: number = 10, offset: number = 0): Promise<Array<User & { total_xp: number; word_count: number; is_supporter_active: number; german_level: string | null; supporter_until: string | null }>> {
    return queryAll(
        db,
        `SELECT u.*,
                COALESCE(SUM(x.amount), 0) AS total_xp,
                COUNT(DISTINCT w.word_id) AS word_count,
                s.german_level,
                us.supporter_until,
                CASE
                    WHEN us.is_supporter = 1 AND us.supporter_until > datetime('now') THEN 1
                    ELSE 0
                END AS is_supporter_active
         FROM users u
         LEFT JOIN xp_log x ON x.user_id = u.user_id
         LEFT JOIN words w ON w.added_by = u.user_id
         LEFT JOIN settings s ON s.user_id = u.user_id
         LEFT JOIN user_support_status us ON us.user_id = u.user_id
         WHERE u.display_name IS NOT NULL
         GROUP BY u.user_id
         ORDER BY u.created_at DESC
         LIMIT ? OFFSET ?`,
        [limit, offset]
    );
}

export async function countAdminUsers(db: D1Database): Promise<number> {
    const row = await queryOne<{ count: number }>(
        db,
        'SELECT COUNT(*) AS count FROM users WHERE display_name IS NOT NULL'
    );
    return row?.count ?? 0;
}

export async function getAdminUserDetail(db: D1Database, userId: number): Promise<User & { total_xp: number; word_count: number; is_supporter_active: number; german_level: string | null; supporter_until: string | null } | null> {
    return queryOne(
        db,
        `SELECT u.*,
                COALESCE(SUM(x.amount), 0) AS total_xp,
                COUNT(DISTINCT w.word_id) AS word_count,
                s.german_level,
                us.supporter_until,
                CASE WHEN us.is_supporter = 1 AND us.supporter_until > datetime('now') THEN 1 ELSE 0 END AS is_supporter_active
         FROM users u
         LEFT JOIN xp_log x ON x.user_id = u.user_id
         LEFT JOIN words w ON w.added_by = u.user_id
         LEFT JOIN settings s ON s.user_id = u.user_id
         LEFT JOIN user_support_status us ON us.user_id = u.user_id
         WHERE u.user_id = ?
         GROUP BY u.user_id`,
        [userId]
    );
}

export async function setUserBanned(db: D1Database, telegramId: number, banned: boolean): Promise<boolean> {
    const result = await run(
        db,
        'UPDATE users SET is_banned = ?, updated_at = datetime("now") WHERE telegram_user_id = ? OR telegram_id = ?',
        [banned ? 1 : 0, telegramId, telegramId]
    );
    return ((result.meta as { changes?: number })?.changes ?? 0) > 0;
}

export async function getChallengeCandidates(db: D1Database, currentUserId: number): Promise<Array<Pick<User, 'user_id' | 'display_name' | 'name'>>> {
    return queryAll(
        db,
        `SELECT u.user_id, u.display_name, u.name
         FROM users u
         WHERE u.user_id != ?
           AND u.display_name IS NOT NULL
           AND COALESCE(u.is_banned, 0) = 0
           AND COALESCE(u.is_deleted, 0) = 0
           AND u.last_active_at >= datetime('now', '-7 days')
           AND EXISTS (SELECT 1 FROM words w WHERE w.added_by = u.user_id)
         ORDER BY CASE WHEN u.last_active_at >= datetime('now', '-1 day') THEN 0 ELSE 1 END, RANDOM()
         LIMIT 10`,
        [currentUserId]
    );
}

export async function updateUserLastActive(db: D1Database, userId: number): Promise<void> {
    await run(db, 'UPDATE users SET updated_at = datetime("now"), last_active_at = datetime("now") WHERE user_id = ?', [userId]);
}

export async function resetUserXp(db: D1Database, userId: number): Promise<void> {
    await run(db, 'UPDATE users SET xp = 0, level = 1, updated_at = datetime("now") WHERE user_id = ?', [userId]);
    await run(db, 'DELETE FROM xp_log WHERE user_id = ?', [userId]);
    await run(db, 'DELETE FROM xp_events WHERE user_id = ?', [userId]);
}

export async function resetUserStreak(db: D1Database, userId: number): Promise<void> {
    await run(db, 'UPDATE users SET streak = 0, updated_at = datetime("now") WHERE user_id = ?', [userId]);
    await run(db, 'UPDATE daily_streaks SET current_streak = 0, last_active_date = NULL WHERE user_id = ?', [userId]);
}

export async function softDeleteUser(db: D1Database, userId: number): Promise<void> {
    await run(
        db,
        'UPDATE users SET is_deleted = 1, deleted_at = datetime("now"), display_name = NULL, updated_at = datetime("now") WHERE user_id = ?',
        [userId]
    );
}

export async function logAdminAction(
    db: D1Database,
    adminUserId: number,
    targetUserId: number | null,
    actionType: string,
    details: unknown = null
): Promise<void> {
    await run(
        db,
        'INSERT INTO admin_actions (admin_user_id, target_user_id, action_type, details_json) VALUES (?, ?, ?, ?)',
        [adminUserId, targetUserId, actionType, details ? JSON.stringify(details) : null]
    );
}

export async function getUserSettings(
    db: D1Database,
    userId: number
): Promise<Settings | null> {
    return queryOne<Settings>(db, 'SELECT * FROM settings WHERE user_id = ?', [userId]);
}

export async function updateUserSettings(
    db: D1Database,
    userId: number,
    settings: Partial<Settings>
): Promise<void> {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (settings.daily_goal !== undefined) { fields.push('daily_goal = ?'); values.push(settings.daily_goal); }
    if (settings.new_words_per_day !== undefined) { fields.push('new_words_per_day = ?'); values.push(settings.new_words_per_day); }
    if (settings.german_level !== undefined) { fields.push('german_level = ?'); values.push(settings.german_level); }
    if (settings.notification_mode !== undefined) { fields.push('notification_mode = ?'); values.push(settings.notification_mode); }
    if (settings.notification_interval_hours !== undefined) { fields.push('notification_interval_hours = ?'); values.push(settings.notification_interval_hours); }
    if (settings.review_plan !== undefined) { fields.push('review_plan = ?'); values.push(settings.review_plan); }
    if (settings.notification_batch_size !== undefined) { fields.push('notification_batch_size = ?'); values.push(settings.notification_batch_size); }
    if (settings.morning_time !== undefined) { fields.push('morning_time = ?'); values.push(settings.morning_time); }
    if (settings.afternoon_time !== undefined) { fields.push('afternoon_time = ?'); values.push(settings.afternoon_time); }
    if (settings.evening_time !== undefined) { fields.push('evening_time = ?'); values.push(settings.evening_time); }
    if (settings.reminders_enabled !== undefined) { fields.push('reminders_enabled = ?'); values.push(settings.reminders_enabled ? 1 : 0); }
    if (settings.notification_intensity !== undefined) { fields.push('notification_intensity = ?'); values.push(settings.notification_intensity); }
    if (settings.notification_timezone !== undefined) { fields.push('notification_timezone = ?'); values.push(settings.notification_timezone); }
    if (settings.last_notification_at !== undefined) { fields.push('last_notification_at = ?'); values.push(settings.last_notification_at); }
    if (settings.last_notified_word_id !== undefined) { fields.push('last_notified_word_id = ?'); values.push(settings.last_notified_word_id); }
    if (settings.competition_notifications_enabled !== undefined) { fields.push('competition_notifications_enabled = ?'); values.push(settings.competition_notifications_enabled ? 1 : 0); }
    if (settings.leaderboard_notifications_enabled !== undefined) { fields.push('leaderboard_notifications_enabled = ?'); values.push(settings.leaderboard_notifications_enabled ? 1 : 0); }

    if (fields.length === 0) return;

    values.push(userId);
    await run(db, `UPDATE settings SET ${fields.join(', ')} WHERE user_id = ?`, values);
}
