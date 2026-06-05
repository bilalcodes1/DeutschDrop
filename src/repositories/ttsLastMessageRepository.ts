import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '../models';
import { queryAll, queryOne, run } from '../db/queries';

export const DEFAULT_TTS_MESSAGE_TTL_SECONDS = 60;

export interface TtsLastMessageRow {
    id: number;
    user_id: number;
    chat_id: number;
    message_id: number;
    word_id: number | null;
    text: string;
    expires_at: string;
    created_at: string;
}

export function getTtsMessageTtlSeconds(env: Pick<Env, 'TTS_MESSAGE_TTL_SECONDS'>): number {
    const parsed = Number(env.TTS_MESSAGE_TTL_SECONDS ?? DEFAULT_TTS_MESSAGE_TTL_SECONDS);
    if (!Number.isFinite(parsed)) return DEFAULT_TTS_MESSAGE_TTL_SECONDS;
    return Math.max(10, Math.min(Math.floor(parsed), 300));
}

export async function getLastTtsMessage(db: D1Database, userId: number, chatId: number): Promise<TtsLastMessageRow | null> {
    return queryOne<TtsLastMessageRow>(
        db,
        `SELECT * FROM tts_last_messages
         WHERE user_id = ? AND chat_id = ?
         LIMIT 1`,
        [userId, chatId]
    );
}

export async function upsertLastTtsMessage(
    db: D1Database,
    input: {
        userId: number;
        chatId: number;
        messageId: number;
        wordId: number;
        text: string;
        ttlSeconds: number;
    }
): Promise<void> {
    await run(
        db,
        `INSERT INTO tts_last_messages (user_id, chat_id, message_id, word_id, text, expires_at)
         VALUES (?, ?, ?, ?, ?, datetime('now', '+' || ? || ' seconds'))
         ON CONFLICT(user_id, chat_id) DO UPDATE SET
            message_id = excluded.message_id,
            word_id = excluded.word_id,
            text = excluded.text,
            expires_at = excluded.expires_at,
            created_at = datetime('now')`,
        [input.userId, input.chatId, input.messageId, input.wordId, input.text, input.ttlSeconds]
    );
}

export async function deleteLastTtsMessageRecord(db: D1Database, userId: number, chatId: number): Promise<void> {
    await run(db, 'DELETE FROM tts_last_messages WHERE user_id = ? AND chat_id = ?', [userId, chatId]);
}

export async function getExpiredTtsMessages(db: D1Database, limit = 50): Promise<TtsLastMessageRow[]> {
    return queryAll<TtsLastMessageRow>(
        db,
        `SELECT * FROM tts_last_messages
         WHERE expires_at <= datetime('now')
         ORDER BY expires_at ASC
         LIMIT ?`,
        [limit]
    );
}

export async function deleteTtsLastMessageById(db: D1Database, id: number): Promise<void> {
    await run(db, 'DELETE FROM tts_last_messages WHERE id = ?', [id]);
}
