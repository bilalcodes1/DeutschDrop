import type { Env } from '../models';
import {
    deleteTemporaryMessageRecord,
    getExpiredTemporaryMessages,
    getMessagesForUserInteraction,
    getTemporaryMessagesByKind,
    markTemporaryMessageSeenAfterInteraction,
    type TemporaryMessageRow,
} from '../repositories/temporaryMessageRepository';

export async function cleanupTemporaryMessagesForUserInteraction(env: Env, userId: number): Promise<void> {
    const rows = await getMessagesForUserInteraction(env.DB, userId);
    await deleteTemporaryRows(env, rows, true);
}

export async function cleanupExpiredTemporaryMessages(env: Env, limit = 100): Promise<void> {
    const rows = await getExpiredTemporaryMessages(env.DB, limit);
    await deleteTemporaryRows(env, rows, false);
}

export async function deleteTemporaryMessagesByKind(env: Env, userId: number, chatId: number, kind: string): Promise<void> {
    const rows = await getTemporaryMessagesByKind(env.DB, userId, chatId, kind);
    await deleteTemporaryRows(env, rows, false);
}

async function deleteTemporaryRows(env: Env, rows: TemporaryMessageRow[], markSeen: boolean): Promise<void> {
    for (const row of rows) {
        if (markSeen) {
            await markTemporaryMessageSeenAfterInteraction(env.DB, row.id).catch(() => undefined);
        }
        await deleteTelegramMessage(env, row.chat_id, row.message_id).catch(() => undefined);
        await deleteTemporaryMessageRecord(env.DB, row.id).catch(() => undefined);
    }
}

async function deleteTelegramMessage(env: Env, chatId: number, messageId: number): Promise<void> {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/deleteMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
    });
}
