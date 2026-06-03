import type { D1Database } from '@cloudflare/workers-types';
import type { Env, User } from '../models';
import { queryAll, queryOne } from '../db/queries';

export async function sendTelegramMessage(
    env: Env,
    telegramId: number,
    text: string,
    replyMarkup?: unknown
): Promise<void> {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: telegramId, text, parse_mode: 'Markdown', reply_markup: replyMarkup }),
    });
}

export async function sendTelegramPhoto(
    env: Env,
    telegramId: number,
    photo: string,
    caption: string,
    replyMarkup?: unknown
): Promise<void> {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: telegramId, photo, caption, parse_mode: 'Markdown', reply_markup: replyMarkup }),
    });
}

export async function getPeerUser(db: D1Database, userId: number): Promise<User | null> {
    return queryOne<User>(
        db,
        'SELECT * FROM users WHERE user_id != ? AND display_name IS NOT NULL ORDER BY created_at LIMIT 1',
        [userId]
    );
}

export async function getIdentityUsers(db: D1Database): Promise<User[]> {
    return queryAll<User>(db, 'SELECT * FROM users WHERE display_name IS NOT NULL ORDER BY display_name');
}

export function displayUserName(user: Partial<Pick<User, 'display_name' | 'name'>>): string {
    return user.display_name || user.name || 'مستخدم';
}

export async function competitionNotificationsEnabled(db: D1Database, userId: number): Promise<boolean> {
    const settings = await queryOne<{ competition_notifications_enabled: number | boolean | null }>(
        db,
        'SELECT competition_notifications_enabled FROM settings WHERE user_id = ?',
        [userId]
    );
    return settings?.competition_notifications_enabled !== 0 && settings?.competition_notifications_enabled !== false;
}
