import type { D1Database } from '@cloudflare/workers-types';
import { queryOne, queryAll, run } from '../db/queries';
import type { User, Settings } from '../models';

export async function getUserByTelegramId(
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
    return queryAll<User>(db, 'SELECT * FROM users WHERE display_name IS NOT NULL ORDER BY created_at DESC');
}

export async function getChallengeCandidates(db: D1Database, currentUserId: number): Promise<Array<Pick<User, 'user_id' | 'display_name' | 'name'>>> {
    return queryAll(
        db,
        'SELECT user_id, display_name, name FROM users WHERE user_id != ? AND display_name IS NOT NULL ORDER BY display_name LIMIT 10',
        [currentUserId]
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
    if (settings.notification_mode !== undefined) { fields.push('notification_mode = ?'); values.push(settings.notification_mode); }
    if (settings.morning_time !== undefined) { fields.push('morning_time = ?'); values.push(settings.morning_time); }
    if (settings.evening_time !== undefined) { fields.push('evening_time = ?'); values.push(settings.evening_time); }
    if (settings.reminders_enabled !== undefined) { fields.push('reminders_enabled = ?'); values.push(settings.reminders_enabled ? 1 : 0); }
    if (settings.competition_notifications_enabled !== undefined) { fields.push('competition_notifications_enabled = ?'); values.push(settings.competition_notifications_enabled ? 1 : 0); }

    if (fields.length === 0) return;

    values.push(userId);
    await run(db, `UPDATE settings SET ${fields.join(', ')} WHERE user_id = ?`, values);
}
