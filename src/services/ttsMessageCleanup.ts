import type { Env } from '../models';
import { deleteTtsLastMessageById, getExpiredTtsMessages } from '../repositories/ttsLastMessageRepository';

export async function cleanupExpiredTtsMessages(env: Env, limit = 50): Promise<void> {
    const rows = await getExpiredTtsMessages(env.DB, limit);
    for (const row of rows) {
        await deleteTelegramMessage(env, row.chat_id, row.message_id).catch(() => undefined);
        await deleteTtsLastMessageById(env.DB, row.id).catch(() => undefined);
    }
}

async function deleteTelegramMessage(env: Env, chatId: number, messageId: number): Promise<void> {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/deleteMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
    });
}
