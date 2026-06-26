import type { D1Database } from '@cloudflare/workers-types';
import { queryAll, queryOne, run, runBatch } from '../db/queries.js';
import type { Word } from '../models/index.js';
import { copyWordToUser, searchWordsByUser } from './wordRepository.js';
import { createShareImageSnapshotsForWords } from './wordImageRepository.js';

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

export async function countPublicWordUsers(db: D1Database, currentUserId: number, query?: string): Promise<number> {
    const like = `%${query ?? ''}%`;
    const row = await queryOne<{ count: number }>(
        db,
        `SELECT COUNT(*) AS count
         FROM users u
         WHERE u.user_id != ?
           AND u.display_name IS NOT NULL
           AND COALESCE(u.is_banned, 0) = 0
           AND COALESCE(u.is_deleted, 0) = 0
           AND (? = '%%' OR u.display_name LIKE ? OR u.username LIKE ?)
           AND EXISTS (SELECT 1 FROM words w WHERE w.added_by = u.user_id)`,
        [currentUserId, like, like, like]
    );
    return row?.count ?? 0;
}

export async function getPublicWordUsers(db: D1Database, currentUserId: number, limit: number, offset: number, query?: string): Promise<PublicUserWordSummary[]> {
    const like = `%${query ?? ''}%`;
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
           AND (? = '%%' OR u.display_name LIKE ? OR u.username LIKE ?)
         GROUP BY u.user_id
         ORDER BY COALESCE(u.last_active_at, u.updated_at, u.created_at) DESC
         LIMIT ? OFFSET ?`,
        [currentUserId, like, like, like, limit, offset]
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

export async function copyWordsToUser(
    db: D1Database,
    wordIds: number[],
    targetUserId: number,
    options: { sourceCollectionId?: number | null; originType?: 'copied_word' | 'copied_collection'; shareType?: string | null; shareId?: number | null } = {}
): Promise<{ copied: number; skipped: number; copiedWordIds: number[]; copiedPairs: Array<{ sourceWordId: number; targetWordId: number }> }> {
    let copied = 0;
    let skipped = 0;
    const copiedWordIds: number[] = [];
    const copiedPairs: Array<{ sourceWordId: number; targetWordId: number }> = [];
    for (const wordId of wordIds.slice(0, 100)) {
        const result = await copyWordToUser(db, wordId, targetUserId, options);
        if (result.status === 'copied') {
            copied++;
            copiedWordIds.push(result.wordId);
            copiedPairs.push({ sourceWordId: wordId, targetWordId: result.wordId });
        } else {
            skipped++;
        }
    }
    return { copied, skipped, copiedWordIds, copiedPairs };
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
    const offerId = (result.meta as { last_row_id?: number })?.last_row_id ?? 0;
    if (offerId > 0) {
        const data = payload as { wordIds?: number[]; collectionId?: number };
        const wordIds = data.collectionId
            ? (await getCollectionWords(db, data.collectionId, 200, 0)).map(word => word.word_id)
            : data.wordIds ?? [];
        await createShareImageSnapshotsForWords(db, 'offer', offerId, senderUserId, wordIds, data.collectionId ?? null);
    }
    return offerId;
}

export async function getSharedWordOffer(db: D1Database, offerId: number): Promise<SharedWordOffer | null> {
    return queryOne<SharedWordOffer>(db, 'SELECT * FROM shared_word_offers WHERE id = ?', [offerId]);
}

export async function countIncomingSharedWordOffers(db: D1Database, receiverUserId: number): Promise<number> {
    const row = await queryOne<{ count: number }>(
        db,
        `SELECT COUNT(*) AS count
         FROM shared_word_offers
         WHERE receiver_user_id = ?
           AND status = 'pending'
           AND expires_at > datetime('now')`,
        [receiverUserId]
    );
    return row?.count ?? 0;
}

export async function getIncomingSharedWordOffers(db: D1Database, receiverUserId: number, limit: number, offset: number): Promise<Array<SharedWordOffer & { sender_name: string | null }>> {
    return queryAll<SharedWordOffer & { sender_name: string | null }>(
        db,
        `SELECT o.*, COALESCE(u.display_name, u.name) AS sender_name
         FROM shared_word_offers o
         INNER JOIN users u ON u.user_id = o.sender_user_id
         WHERE o.receiver_user_id = ?
           AND o.status = 'pending'
           AND o.expires_at > datetime('now')
           AND COALESCE(u.is_banned, 0) = 0
           AND COALESCE(u.is_deleted, 0) = 0
         ORDER BY o.created_at DESC
         LIMIT ? OFFSET ?`,
        [receiverUserId, limit, offset]
    );
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

export async function updateCollection(db: D1Database, collectionId: number, ownerUserId: number, updates: { title?: string; description?: string | null; visibility?: 'public' | 'private' }): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (updates.title !== undefined) { sets.push('title = ?'); params.push(updates.title); }
    if (updates.description !== undefined) { sets.push('description = ?'); params.push(updates.description); }
    if (updates.visibility !== undefined) { sets.push('visibility = ?'); params.push(updates.visibility); }
    
    if (sets.length === 0) return;
    params.push(collectionId, ownerUserId);
    await run(db, `UPDATE word_collections SET ${sets.join(', ')} WHERE id = ? AND owner_user_id = ?`, params);
}

export async function deleteCollection(db: D1Database, collectionId: number, ownerUserId: number): Promise<boolean> {
    const collection = await queryOne<{ id: number }>(
        db,
        'SELECT id FROM word_collections WHERE id = ? AND owner_user_id = ? AND is_deleted = 0',
        [collectionId, ownerUserId]
    );
    if (!collection) return false;

    // We do soft delete by deleting the links and the collection itself.
    // The requirement says: "وضّح أن الحذف يحذف المجموعة والربط فقط، ولا يحذف الكلمات من حساب المستخدم"
    // Since word_collection_items has collection_id, deleting it removes the links.
    // Words are stored in words and user_words, so they remain unaffected.
    await run(db, `DELETE FROM word_collection_items WHERE collection_id = ? AND EXISTS (SELECT 1 FROM word_collections WHERE id = ? AND owner_user_id = ?)`, [collectionId, collectionId, ownerUserId]);
    const result = await run(db, `DELETE FROM word_collections WHERE id = ? AND owner_user_id = ?`, [collectionId, ownerUserId]);
    return ((result.meta as { changes?: number })?.changes ?? 0) > 0;
}

export async function deleteAllCollectionsForUser(db: D1Database, ownerUserId: number): Promise<number> {
    const row = await queryOne<{ count: number }>(
        db,
        'SELECT COUNT(*) AS count FROM word_collections WHERE owner_user_id = ? AND is_deleted = 0',
        [ownerUserId]
    );
    const count = row?.count ?? 0;
    if (count === 0) return 0;

    await run(
        db,
        `DELETE FROM word_collection_items
         WHERE owner_user_id = ?
            OR collection_id IN (SELECT id FROM word_collections WHERE owner_user_id = ?)`,
        [ownerUserId, ownerUserId]
    );
    await run(db, 'DELETE FROM word_collections WHERE owner_user_id = ?', [ownerUserId]);
    return count;
}

export async function deleteCollectionWordsForUser(db: D1Database, collectionId: number, ownerUserId: number): Promise<number | null> {
    const collection = await queryOne<{ id: number }>(
        db,
        'SELECT id FROM word_collections WHERE id = ? AND owner_user_id = ? AND is_deleted = 0',
        [collectionId, ownerUserId]
    );
    if (!collection) return null;

    const result = await run(
        db,
        `DELETE FROM word_collection_items
         WHERE collection_id = ?
           AND owner_user_id = ?
           AND EXISTS (
                SELECT 1 FROM word_collections
                WHERE id = ? AND owner_user_id = ?
           )`,
        [collectionId, ownerUserId, collectionId, ownerUserId]
    );
    return (result.meta as { changes?: number })?.changes ?? 0;
}
