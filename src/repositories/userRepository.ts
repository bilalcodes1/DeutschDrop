import type { D1Database } from '@cloudflare/workers-types';
import { queryOne, queryAll, run } from '../db/queries';
import type { User, Settings } from '../models';

export async function getUserByTelegramId(
    db: D1Database,
    telegramId: number
): Promise<User | null> {
    return queryOne<User>(
        db,
        'SELECT * FROM users WHERE telegram_id = ?',
        [telegramId]
    );
}

export async function createUser(
    db: D1Database,
    name: string,
    telegramId: number,
    telegramUsername: string | null
): Promise<number> {
    const result = await run(
        db,
        'INSERT INTO users (name, telegram_id, telegram_username) VALUES (?, ?, ?)',
        [name, telegramId, telegramUsername]
    );
    const lastId = (result.meta as { last_row_id?: number })?.last_row_id ?? 0;
    // Initialize default settings
    await run(
        db,
        'INSERT INTO settings (user_id) VALUES (?)',
        [lastId]
    );
    // Initialize streak
    await run(
        db,
        'INSERT INTO daily_streaks (user_id, current_streak) VALUES (?, 0)',
        [lastId]
    );
    return lastId;
}

export async function getAllUsers(db: D1Database): Promise<User[]> {
    return queryAll<User>(db, 'SELECT * FROM users ORDER BY created_at DESC');
}

export async function getUserSettings(
    db: D1Database,
    userId: number
): Promise<Settings | null> {
    return queryOne<Settings>(
        db,
        'SELECT * FROM settings WHERE user_id = ?',
        [userId]
    );
}

export async function updateUserSettings(
    db: D1Database,
    userId: number,
    settings: Partial<Settings>
): Promise<void> {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (settings.daily_goal !== undefined) {
        fields.push('daily_goal = ?');
        values.push(settings.daily_goal);
    }
    if (settings.new_words_per_day !== undefined) {
        fields.push('new_words_per_day = ?');
        values.push(settings.new_words_per_day);
    }
    if (settings.notification_mode !== undefined) {
        fields.push('notification_mode = ?');
        values.push(settings.notification_mode);
    }
    if (settings.morning_time !== undefined) {
        fields.push('morning_time = ?');
        values.push(settings.morning_time);
    }
    if (settings.evening_time !== undefined) {
        fields.push('evening_time = ?');
        values.push(settings.evening_time);
    }

    if (fields.length === 0) return;

    values.push(userId);
    await run(
        db,
        `UPDATE settings SET ${fields.join(', ')} WHERE user_id = ?`,
        values
    );
}
