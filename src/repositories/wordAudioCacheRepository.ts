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
    created_at: string;
    updated_at: string;
}

export async function getCachedWordAudio(
    db: D1Database,
    userId: number,
    wordId: number,
    text: string,
    provider: string
): Promise<WordAudioCacheRow | null> {
    return queryOne<WordAudioCacheRow>(
        db,
        `SELECT * FROM word_audio_cache
         WHERE user_id = ? AND word_id = ? AND text = ? AND provider = ? AND telegram_file_id IS NOT NULL
         LIMIT 1`,
        [userId, wordId, text, provider]
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
    }
): Promise<void> {
    await run(
        db,
        `INSERT INTO word_audio_cache (user_id, word_id, text, provider, telegram_file_id, content_hash)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, word_id, text, provider) DO UPDATE SET
            telegram_file_id = excluded.telegram_file_id,
            content_hash = excluded.content_hash,
            updated_at = datetime('now')`,
        [input.userId, input.wordId, input.text, input.provider, input.telegramFileId, input.contentHash]
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
