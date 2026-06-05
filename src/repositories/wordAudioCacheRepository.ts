import type { D1Database } from '@cloudflare/workers-types';
import { queryOne, run } from '../db/queries';

export interface WordAudioCacheRow {
    id: number;
    user_id: number;
    word_id: number;
    text: string;
    provider: string;
    telegram_file_id: string | null;
    content_hash: string;
    language: string | null;
    voice: string | null;
    model: string | null;
    format: string | null;
    created_at: string;
    updated_at: string;
}

export async function getCachedWordAudio(
    db: D1Database,
    userId: number,
    wordId: number,
    text: string,
    provider: string,
    language: string,
    voice: string,
    model: string,
    format: string
): Promise<WordAudioCacheRow | null> {
    return queryOne<WordAudioCacheRow>(
        db,
        `SELECT * FROM word_audio_cache
         WHERE user_id = ? AND word_id = ? AND text = ? AND provider = ?
           AND language = ? AND voice = ? AND model = ?
           AND format = ?
           AND telegram_file_id IS NOT NULL
         LIMIT 1`,
        [userId, wordId, text, provider, language, voice, model, format]
    );
}

export async function upsertWordAudioFileId(
    db: D1Database,
    input: {
        userId: number;
        wordId: number;
        text: string;
        provider: string;
        telegramFileId: string;
        contentHash: string;
        language: string;
        voice: string;
        model: string;
        format: string;
    }
): Promise<void> {
    await run(
        db,
        `INSERT INTO word_audio_cache (user_id, word_id, text, provider, telegram_file_id, content_hash, language, voice, model, format)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, word_id, text, provider) DO UPDATE SET
            telegram_file_id = excluded.telegram_file_id,
            content_hash = excluded.content_hash,
            language = excluded.language,
            voice = excluded.voice,
            model = excluded.model,
            format = excluded.format,
            updated_at = datetime('now')`,
        [input.userId, input.wordId, input.text, input.provider, input.telegramFileId, input.contentHash, input.language, input.voice, input.model, input.format]
    );
}

export async function countGeneratedAudioToday(db: D1Database, userId: number, provider: string): Promise<number> {
    const row = await queryOne<{ count: number }>(
        db,
        `SELECT COUNT(*) AS count
         FROM word_audio_cache
         WHERE user_id = ? AND provider = ? AND date(created_at) = date('now')`,
        [userId, provider]
    );
    return row?.count ?? 0;
}

export async function acquireTtsRequestLock(
    db: D1Database,
    input: { userId: number; wordId: number; text: string; ttlSeconds?: number }
): Promise<boolean> {
    const lockKey = ttsLockKey(input.userId, input.wordId, input.text);
    await run(db, 'DELETE FROM tts_request_locks WHERE expires_at <= datetime("now")');
    const ttl = Math.max(5, Math.min(input.ttlSeconds ?? 8, 10));
    const result = await run(
        db,
        `INSERT OR IGNORE INTO tts_request_locks (lock_key, user_id, word_id, text, expires_at)
         VALUES (?, ?, ?, ?, datetime('now', '+' || ? || ' seconds'))`,
        [lockKey, input.userId, input.wordId, input.text, ttl]
    );
    return ((result.meta as { changes?: number } | undefined)?.changes ?? 0) > 0;
}

export async function releaseTtsRequestLock(db: D1Database, userId: number, wordId: number, text: string): Promise<void> {
    await run(db, 'DELETE FROM tts_request_locks WHERE lock_key = ?', [ttsLockKey(userId, wordId, text)]);
}

function ttsLockKey(userId: number, wordId: number, text: string): string {
    return `${userId}:${wordId}:${text}`;
}
