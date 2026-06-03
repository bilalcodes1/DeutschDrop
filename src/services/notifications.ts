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

export async function getPeerUser(db: D1Database, userId: number): Promise<User | null> {
    const current = await queryOne<User>(db, 'SELECT * FROM users WHERE user_id = ?', [userId]);
    if (!current?.identity) return null;

    const targetIdentity = current.identity === 'bilal' ? 'malak' : 'bilal';
    return queryOne<User>(db, 'SELECT * FROM users WHERE identity = ? LIMIT 1', [targetIdentity]);
}

export async function getIdentityUsers(db: D1Database): Promise<User[]> {
    return queryAll<User>(db, 'SELECT * FROM users WHERE identity IN ("bilal", "malak") ORDER BY identity');
}

export function displayUserName(user: Pick<User, 'identity' | 'name'>): string {
    if (user.identity === 'bilal') return 'بلال';
    if (user.identity === 'malak') return 'ملاك';
    return user.name;
}

export async function competitionNotificationsEnabled(db: D1Database, userId: number): Promise<boolean> {
    const settings = await queryOne<{ competition_notifications_enabled: number | boolean | null }>(
        db,
        'SELECT competition_notifications_enabled FROM settings WHERE user_id = ?',
        [userId]
    );
    return settings?.competition_notifications_enabled !== 0 && settings?.competition_notifications_enabled !== false;
}
