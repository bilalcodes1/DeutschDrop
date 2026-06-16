import type { D1Database } from '@cloudflare/workers-types';

export interface BotMessageLog {
    id: number;
    telegram_id: number;
    chat_id: number;
    message_id: number;
    created_at: string;
}

export async function logBotMessage(db: D1Database, telegramId: number, chatId: number, messageId: number): Promise<void> {
    await db.prepare(
        'INSERT INTO bot_message_log (telegram_id, chat_id, message_id) VALUES (?, ?, ?)'
    ).bind(telegramId, chatId, messageId).run().catch(() => {});
}

export async function getBotMessageLogs(db: D1Database, telegramId: number, limit = 100): Promise<BotMessageLog[]> {
    const { results } = await db.prepare(
        'SELECT * FROM bot_message_log WHERE telegram_id = ? ORDER BY created_at DESC LIMIT ?'
    ).bind(telegramId, limit).all<BotMessageLog>();
    return results ?? [];
}

export async function deleteBotMessageLogs(db: D1Database, ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    await db.prepare(
        `DELETE FROM bot_message_log WHERE id IN (${placeholders})`
    ).bind(...ids).run().catch(() => {});
}

export async function cleanupOldBotMessageLogs(db: D1Database, telegramId: number, keepCount = 100): Promise<void> {
    await db.prepare(
        `DELETE FROM bot_message_log 
         WHERE telegram_id = ? AND id NOT IN (
            SELECT id FROM bot_message_log WHERE telegram_id = ? ORDER BY created_at DESC LIMIT ?
         )`
    ).bind(telegramId, telegramId, keepCount).run().catch(() => {});
}
