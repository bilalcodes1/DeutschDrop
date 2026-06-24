import type { D1Database } from '@cloudflare/workers-types';
import { queryOne, run } from '../db/queries.js';

export type BotSessionType = 'learn' | 'train' | 'add_word' | 'word_edit' | 'challenge' | 'register' | 'rename' | 'profile_rename' | 'support_proof' | 'admin_broadcast' | 'admin_announcement' | 'admin_source' | 'admin_source_add' | 'admin_source_edit' | 'admin_private_message' | 'admin_confirm' | 'csv_update' | 'word_selection' | 'word_search' | 'ai_word' | 'train_explain' | 'shared_word_search' | 'shared_word_selection' | 'shared_word_copy_selection' | 'collection_create' | 'collection_add_word_direct' | 'collection_csv_upload' | 'collection_add_existing_words' | 'collection_edit' | 'global_search' | 'delete_confirmation' | 'word_visual_edit' | 'word_image_search' | 'word_image_results' | 'word_image_upload' | 'awaiting_manual_word_image_upload' | 'word_image_prepare_missing' | 'game_challenge_user_search' | 'goethe_pack_upload' | 'start_keyboard';

export interface BotSession<T> {
    session_id: string;
    user_id: number;
    type: BotSessionType;
    data: T;
    expires_at: string;
    created_at: string;
}

interface BotSessionRow {
    session_id: string;
    user_id: number;
    type: BotSessionType;
    data: string;
    expires_at: string;
    created_at: string;
}

function sessionId(userId: number, type: BotSessionType): string {
    return `${type}:${userId}`;
}

function expiresAt(ttlMinutes: number): string {
    const date = new Date();
    date.setMinutes(date.getMinutes() + ttlMinutes);
    return date.toISOString();
}

export async function saveBotSession<T>(
    db: D1Database,
    userId: number,
    type: BotSessionType,
    data: T,
    ttlMinutes: number = 60
): Promise<void> {
    await run(
        db,
        `INSERT INTO bot_sessions (session_id, user_id, type, data, expires_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
            data = excluded.data,
            expires_at = excluded.expires_at`,
        [sessionId(userId, type), userId, type, JSON.stringify(data), expiresAt(ttlMinutes)]
    );
}

export async function getBotSession<T>(
    db: D1Database,
    userId: number,
    type: BotSessionType
): Promise<BotSession<T> | null> {
    const row = await queryOne<BotSessionRow>(
        db,
        'SELECT * FROM bot_sessions WHERE session_id = ? AND expires_at > datetime(\'now\')',
        [sessionId(userId, type)]
    );

    if (!row) return null;

    return {
        ...row,
        data: JSON.parse(row.data) as T,
    };
}

export async function deleteBotSession(
    db: D1Database,
    userId: number,
    type: BotSessionType
): Promise<void> {
    await run(db, 'DELETE FROM bot_sessions WHERE session_id = ?', [sessionId(userId, type)]);
}

export async function deleteAllBotSessionsForUser(db: D1Database, userId: number): Promise<void> {
    await run(db, 'DELETE FROM bot_sessions WHERE user_id = ? AND type <> ?', [userId, 'start_keyboard']);
}

export async function deleteExpiredBotSessions(db: D1Database): Promise<void> {
    await run(db, 'DELETE FROM bot_sessions WHERE expires_at <= datetime(\'now\')');
}
