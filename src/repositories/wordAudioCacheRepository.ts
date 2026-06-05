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
    api_key_hash: string | null;
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
        apiKeyHash?: string | null;
    }
): Promise<void> {
    await run(
        db,
        `INSERT INTO word_audio_cache (user_id, word_id, text, provider, telegram_file_id, content_hash, language, voice, model, format, api_key_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, word_id, text, provider) DO UPDATE SET
            telegram_file_id = excluded.telegram_file_id,
            content_hash = excluded.content_hash,
            language = excluded.language,
            voice = excluded.voice,
            model = excluded.model,
            format = excluded.format,
            api_key_hash = excluded.api_key_hash,
            updated_at = datetime('now')`,
        [input.userId, input.wordId, input.text, input.provider, input.telegramFileId, input.contentHash, input.language, input.voice, input.model, input.format, input.apiKeyHash ?? null]
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

export async function countGeneratedAudioTodayByKeyHash(db: D1Database, provider: string, apiKeyHash: string): Promise<number> {
    const row = await queryOne<{ count: number }>(
        db,
        `SELECT COUNT(*) AS count
         FROM word_audio_cache
         WHERE provider = ? AND api_key_hash = ? AND date(created_at) = date('now')`,
        [provider, apiKeyHash]
    );
    return row?.count ?? 0;
}

export async function getGeneratedAudioUsageTodayByKeyHash(
    db: D1Database,
    provider: string,
    apiKeyHashes: string[]
): Promise<Record<string, number>> {
    if (apiKeyHashes.length === 0) return {};
    const placeholders = apiKeyHashes.map(() => '?').join(', ');
    const result = await db.prepare(
        `SELECT api_key_hash, COUNT(*) AS count
         FROM word_audio_cache
         WHERE provider = ?
           AND api_key_hash IN (${placeholders})
           AND date(created_at) = date('now')
         GROUP BY api_key_hash`
    ).bind(provider, ...apiKeyHashes).all<{ api_key_hash: string; count: number }>();

    const usage: Record<string, number> = {};
    for (const hash of apiKeyHashes) usage[hash] = 0;
    for (const row of result.results ?? []) usage[row.api_key_hash] = row.count;
    return usage;
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
