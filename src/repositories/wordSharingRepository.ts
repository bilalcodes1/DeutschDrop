import type { D1Database } from '@cloudflare/workers-types';
import { queryAll, queryOne, run, runBatch } from '../db/queries';
import type { Word } from '../models';
import { copyWordToUser, searchWordsByUser } from './wordRepository';

export interface PublicUserWordSummary {
    user_id: number;
    display_name: string;
    word_count: number;
    german_level: string | null;
    last_active_at: string | null;
}

export interface WordCollection {
    id: number;
    owner_user_id: number;
    title: string;
    description: string | null;
    visibility: 'public' | 'private';
    source_label: string | null;
    created_at: string;
    updated_at: string;
    is_deleted: number;
    owner_name?: string | null;
    word_count?: number;
}

export interface SharedWordOffer {
    id: number;
    sender_user_id: number;
    receiver_user_id: number;
    offer_type: 'word' | 'words' | 'collection';
    payload_json: string;
    status: 'pending' | 'accepted' | 'ignored' | 'expired';
    expires_at: string;
    created_at: string;
    updated_at: string;
}

export async function countPublicWordUsers(db: D1Database, currentUserId: number): Promise<number> {
    const row = await queryOne<{ count: number }>(
        db,
        `SELECT COUNT(*) AS count
         FROM users u
         WHERE u.user_id != ?
           AND u.display_name IS NOT NULL
           AND COALESCE(u.is_banned, 0) = 0
           AND COALESCE(u.is_deleted, 0) = 0
           AND EXISTS (SELECT 1 FROM words w WHERE w.added_by = u.user_id)`,
        [currentUserId]
    );
    return row?.count ?? 0;
}

export async function getPublicWordUsers(db: D1Database, currentUserId: number, limit: number, offset: number): Promise<PublicUserWordSummary[]> {
    return queryAll<PublicUserWordSummary>(
        db,
        `SELECT u.user_id, u.display_name, COUNT(w.word_id) AS word_count, s.german_level, u.last_active_at
         FROM users u
         INNER JOIN words w ON w.added_by = u.user_id
         LEFT JOIN settings s ON s.user_id = u.user_id
         WHERE u.user_id != ?
           AND u.display_name IS NOT NULL
           AND COALESCE(u.is_banned, 0) = 0
           AND COALESCE(u.is_deleted, 0) = 0
         GROUP BY u.user_id
         ORDER BY COALESCE(u.last_active_at, u.updated_at, u.created_at) DESC
         LIMIT ? OFFSET ?`,
        [currentUserId, limit, offset]
    );
}

export async function getPublicWordOwner(db: D1Database, ownerUserId: number): Promise<PublicUserWordSummary | null> {
    return queryOne<PublicUserWordSummary>(
        db,
        `SELECT u.user_id, u.display_name, COUNT(w.word_id) AS word_count, s.german_level, u.last_active_at
         FROM users u
         INNER JOIN words w ON w.added_by = u.user_id
         LEFT JOIN settings s ON s.user_id = u.user_id
         WHERE u.user_id = ?
           AND u.display_name IS NOT NULL
           AND COALESCE(u.is_banned, 0) = 0
           AND COALESCE(u.is_deleted, 0) = 0
         GROUP BY u.user_id`,
        [ownerUserId]
    );
}

export async function copyWordsToUser(db: D1Database, wordIds: number[], targetUserId: number): Promise<{ copied: number; skipped: number; copiedWordIds: number[] }> {
    let copied = 0;
    let skipped = 0;
    const copiedWordIds: number[] = [];
    for (const wordId of wordIds.slice(0, 100)) {
        const result = await copyWordToUser(db, wordId, targetUserId);
        if (result.status === 'copied') {
            copied++;
            copiedWordIds.push(result.wordId);
        } else {
            skipped++;
        }
    }
    return { copied, skipped, copiedWordIds };
}

export async function createWordCollection(db: D1Database, ownerUserId: number, title: string, description: string | null, visibility: 'public' | 'private' = 'public'): Promise<number> {
    const result = await run(
        db,
        `INSERT INTO word_collections (owner_user_id, title, description, visibility)
         VALUES (?, ?, ?, ?)`,
        [ownerUserId, title, description, visibility]
    );
    return (result.meta as { last_row_id?: number })?.last_row_id ?? 0;
}

export async function addWordsToCollection(db: D1Database, collectionId: number, ownerUserId: number, wordIds: number[]): Promise<number> {
    const owned = await queryAll<{ word_id: number }>(
        db,
        `SELECT word_id FROM words
         WHERE added_by = ? AND word_id IN (${wordIds.map(() => '?').join(',') || 'NULL'})`,
        [ownerUserId, ...wordIds]
    );
    const ids = owned.map(row => row.word_id);
    if (ids.length === 0) return 0;
    const current = await queryOne<{ max_position: number }>(
        db,
        'SELECT COALESCE(MAX(position), 0) AS max_position FROM word_collection_items WHERE collection_id = ?',
        [collectionId]
    );
    const start = current?.max_position ?? 0;
    const results = await runBatch(db, ids.map((wordId, index) => ({
        sql: `INSERT OR IGNORE INTO word_collection_items (collection_id, word_id, owner_user_id, position)
              VALUES (?, ?, ?, ?)`,
        params: [collectionId, wordId, ownerUserId, start + index + 1],
    })));
    return results.reduce((sum, result) => sum + (((result.meta as { changes?: number } | undefined)?.changes ?? 0) > 0 ? 1 : 0), 0);
}

export async function getCollectionById(db: D1Database, collectionId: number): Promise<WordCollection | null> {
    return queryOne<WordCollection>(
        db,
        `SELECT c.*, u.display_name AS owner_name, COUNT(i.word_id) AS word_count
         FROM word_collections c
         INNER JOIN users u ON u.user_id = c.owner_user_id
         LEFT JOIN word_collection_items i ON i.collection_id = c.id
         WHERE c.id = ? AND c.is_deleted = 0
         GROUP BY c.id`,
        [collectionId]
    );
}

export async function getCollectionWords(db: D1Database, collectionId: number, limit = 100, offset = 0): Promise<Word[]> {
    return queryAll<Word>(
        db,
        `SELECT w.*
         FROM word_collection_items i
         INNER JOIN words w ON w.word_id = i.word_id
         WHERE i.collection_id = ?
         ORDER BY i.position ASC, i.id ASC
         LIMIT ? OFFSET ?`,
        [collectionId, limit, offset]
    );
}

export async function countCollectionsByUser(db: D1Database, userId: number): Promise<number> {
    const row = await queryOne<{ count: number }>(db, 'SELECT COUNT(*) AS count FROM word_collections WHERE owner_user_id = ? AND is_deleted = 0', [userId]);
    return row?.count ?? 0;
}

export async function getCollectionsByUser(db: D1Database, userId: number, limit: number, offset: number): Promise<WordCollection[]> {
    return queryAll<WordCollection>(
        db,
        `SELECT c.*, u.display_name AS owner_name, COUNT(i.word_id) AS word_count
         FROM word_collections c
         INNER JOIN users u ON u.user_id = c.owner_user_id
         LEFT JOIN word_collection_items i ON i.collection_id = c.id
         WHERE c.owner_user_id = ? AND c.is_deleted = 0
         GROUP BY c.id
         ORDER BY c.updated_at DESC, c.id DESC
         LIMIT ? OFFSET ?`,
        [userId, limit, offset]
    );
}

export async function countPublicCollections(db: D1Database, currentUserId: number, query?: string): Promise<number> {
    const like = `%${query ?? ''}%`;
    const row = await queryOne<{ count: number }>(
        db,
        `SELECT COUNT(*) AS count
         FROM word_collections c
         INNER JOIN users u ON u.user_id = c.owner_user_id
         WHERE c.owner_user_id != ?
           AND c.visibility = 'public'
           AND c.is_deleted = 0
           AND COALESCE(u.is_banned, 0) = 0
           AND COALESCE(u.is_deleted, 0) = 0
           AND (? = '%%' OR c.title LIKE ? OR c.description LIKE ?)`,
        [currentUserId, like, like, like]
    );
    return row?.count ?? 0;
}

export async function getPublicCollections(db: D1Database, currentUserId: number, limit: number, offset: number, query?: string): Promise<WordCollection[]> {
    const like = `%${query ?? ''}%`;
    return queryAll<WordCollection>(
        db,
        `SELECT c.*, u.display_name AS owner_name, COUNT(i.word_id) AS word_count
         FROM word_collections c
         INNER JOIN users u ON u.user_id = c.owner_user_id
         LEFT JOIN word_collection_items i ON i.collection_id = c.id
         WHERE c.owner_user_id != ?
           AND c.visibility = 'public'
           AND c.is_deleted = 0
           AND COALESCE(u.is_banned, 0) = 0
           AND COALESCE(u.is_deleted, 0) = 0
           AND (? = '%%' OR c.title LIKE ? OR c.description LIKE ?)
         GROUP BY c.id
         ORDER BY c.updated_at DESC, c.id DESC
         LIMIT ? OFFSET ?`,
        [currentUserId, like, like, like, limit, offset]
    );
}

export async function searchOtherUserWords(db: D1Database, ownerUserId: number, query: string, limit: number, offset: number): Promise<Word[]> {
    return searchWordsByUser(db, ownerUserId, query, limit, offset);
}

export async function createSharedWordOffer(db: D1Database, senderUserId: number, receiverUserId: number, offerType: 'word' | 'words' | 'collection', payload: unknown): Promise<number | null> {
    const payloadJson = JSON.stringify(payload);
    const recent = await queryOne<{ id: number }>(
        db,
        `SELECT id FROM shared_word_offers
         WHERE sender_user_id = ? AND receiver_user_id = ? AND offer_type = ?
           AND payload_json = ? AND created_at >= datetime('now', '-1 hour')
         LIMIT 1`,
        [senderUserId, receiverUserId, offerType, payloadJson]
    );
    if (recent) return null;
    const result = await run(
        db,
        `INSERT INTO shared_word_offers (sender_user_id, receiver_user_id, offer_type, payload_json, expires_at)
         VALUES (?, ?, ?, ?, datetime('now', '+7 days'))`,
        [senderUserId, receiverUserId, offerType, payloadJson]
    );
    return (result.meta as { last_row_id?: number })?.last_row_id ?? 0;
}

export async function getSharedWordOffer(db: D1Database, offerId: number): Promise<SharedWordOffer | null> {
    return queryOne<SharedWordOffer>(db, 'SELECT * FROM shared_word_offers WHERE id = ?', [offerId]);
}

export async function isSharedWordOfferExpired(db: D1Database, offerId: number): Promise<boolean> {
    const row = await queryOne<{ expired: number }>(
        db,
        `SELECT CASE WHEN expires_at <= datetime('now') THEN 1 ELSE 0 END AS expired
         FROM shared_word_offers
         WHERE id = ?`,
        [offerId]
    );
    return row?.expired === 1;
}

export async function updateSharedWordOfferStatus(db: D1Database, offerId: number, status: 'accepted' | 'ignored' | 'expired'): Promise<void> {
    await run(db, 'UPDATE shared_word_offers SET status = ?, updated_at = datetime("now") WHERE id = ?', [status, offerId]);
}
