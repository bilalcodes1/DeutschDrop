import type { D1Database } from '@cloudflare/workers-types';
import { queryAll, run } from '../db/queries';

export type TemporaryDeletePolicy = 'after_ttl' | 'after_next_interaction' | 'after_seen_or_ttl';

export const ACTIVE_TEMP_TTL_SECONDS = 5;
export const IMPORTANT_TEMP_FALLBACK_TTL_SECONDS = 300;
export const IMPORTANT_MIN_VISIBLE_SECONDS = 30;

export interface TemporaryMessageRow {
    id: number;
    user_id: number;
    chat_id: number;
    message_id: number;
    kind: string;
    word_id: number | null;
    text: string | null;
    delete_policy: TemporaryDeletePolicy;
    seen_after_interaction: number;
    min_visible_until: string | null;
    expires_at: string;
    created_at: string;
}

export async function recordTemporaryMessage(
    db: D1Database,
    input: {
        userId: number;
        chatId: number;
        messageId: number;
        kind: string;
        wordId?: number | null;
        text?: string | null;
        deletePolicy: TemporaryDeletePolicy;
        ttlSeconds: number;
        minVisibleSeconds?: number | null;
    }
): Promise<void> {
    await run(
        db,
        `INSERT INTO temporary_messages (user_id, chat_id, message_id, kind, word_id, text, delete_policy, min_visible_until, expires_at)
         VALUES (
            ?, ?, ?, ?, ?, ?, ?,
            CASE WHEN ? IS NULL THEN NULL ELSE datetime('now', '+' || ? || ' seconds') END,
            datetime('now', '+' || ? || ' seconds')
         )`,
        [
            input.userId,
            input.chatId,
            input.messageId,
            input.kind,
            input.wordId ?? null,
            input.text ?? null,
            input.deletePolicy,
            input.minVisibleSeconds ?? null,
            input.minVisibleSeconds ?? null,
            input.ttlSeconds,
        ]
    );
}

export async function getTemporaryMessagesByKind(
    db: D1Database,
    userId: number,
    chatId: number,
    kind: string
): Promise<TemporaryMessageRow[]> {
    return queryAll<TemporaryMessageRow>(
        db,
        `SELECT * FROM temporary_messages
         WHERE user_id = ? AND chat_id = ? AND kind = ?
         ORDER BY created_at ASC`,
        [userId, chatId, kind]
    );
}

export async function getMessagesForUserInteraction(db: D1Database, userId: number): Promise<TemporaryMessageRow[]> {
    return queryAll<TemporaryMessageRow>(
        db,
        `SELECT * FROM temporary_messages
         WHERE user_id = ?
           AND kind != 'active_panel'
           AND (
                (delete_policy = 'after_ttl' AND expires_at <= datetime('now'))
             OR (delete_policy = 'after_next_interaction' AND (min_visible_until IS NULL OR min_visible_until <= datetime('now')))
             OR (delete_policy = 'after_seen_or_ttl' AND (min_visible_until IS NULL OR min_visible_until <= datetime('now')))
           )
         ORDER BY created_at ASC
         LIMIT 50`,
        [userId]
    );
}

export async function getExpiredTemporaryMessages(db: D1Database, limit = 100): Promise<TemporaryMessageRow[]> {
    return queryAll<TemporaryMessageRow>(
        db,
        `SELECT * FROM temporary_messages
         WHERE kind != 'active_panel'
           AND expires_at <= datetime('now')
           AND (
                delete_policy = 'after_ttl'
             OR delete_policy = 'after_next_interaction'
             OR delete_policy = 'after_seen_or_ttl'
           )
         ORDER BY expires_at ASC
         LIMIT ?`,
        [limit]
    );
}

export async function markTemporaryMessageSeenAfterInteraction(db: D1Database, id: number): Promise<void> {
    await run(db, 'UPDATE temporary_messages SET seen_after_interaction = 1 WHERE id = ?', [id]);
}

export async function deleteTemporaryMessageRecord(db: D1Database, id: number): Promise<void> {
    await run(db, 'DELETE FROM temporary_messages WHERE id = ?', [id]);
}
