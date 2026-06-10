import type { D1Database } from '@cloudflare/workers-types';
import type { Word, User } from '../models/index.js';
import type { WordCollection } from './wordSharingRepository.js';
import { queryAll } from '../db/queries.js';
import { buildFtsQuery, normalizeGermanSearch, normalizeArabicSearch } from '../services/searchNormalization.js';

const WORD_SELECT_COLUMNS = 'word_id, german, arabic, example, example_ar, pronunciation_ar, pronunciation_latin, level, is_hard, added_by, created_at, updated_at';

export async function searchUserWords(db: D1Database, userId: number, term: string, limit: number, offset: number): Promise<Word[]> {
    const ftsQuery = buildFtsQuery(term);
    if (!ftsQuery) return [];

    try {
        const query = `
            SELECT w.*, bm25(words_fts) as score
            FROM words_fts f
            JOIN words w ON w.word_id = f.word_id
            WHERE f.words_fts MATCH ?
              AND w.added_by = ?
            ORDER BY score
            LIMIT ? OFFSET ?
        `;
        return await queryAll<Word>(db, query, [ftsQuery, userId, limit, offset]);
    } catch (err) {
        console.warn('FTS query failed for searchUserWords, using fallback.', err);
        return fallbackSearchWords(db, userId, term, limit, offset);
    }
}

export async function searchCollectionWords(db: D1Database, collectionId: number, currentUserId: number, term: string, limit: number, offset: number): Promise<Word[]> {
    const ftsQuery = buildFtsQuery(term);
    if (!ftsQuery) return [];

    try {
        // Must ensure visibility (either owner or public collection)
        const query = `
            SELECT w.*, bm25(words_fts) as score
            FROM words_fts f
            JOIN words w ON w.word_id = f.word_id
            JOIN word_collection_items i ON w.word_id = i.word_id
            JOIN word_collections c ON c.id = i.collection_id
            WHERE f.words_fts MATCH ?
              AND i.collection_id = ?
              AND (c.owner_user_id = ? OR c.visibility = 'public')
              AND w.added_by = c.owner_user_id
              AND c.is_deleted = 0
            ORDER BY score
            LIMIT ? OFFSET ?
        `;
        return await queryAll<Word>(db, query, [ftsQuery, collectionId, currentUserId, limit, offset]);
    } catch (err) {
        console.warn('FTS query failed for searchCollectionWords, using fallback.', err);
        return fallbackSearchCollectionWords(db, collectionId, currentUserId, term, limit, offset);
    }
}

export async function searchCollections(db: D1Database, currentUserId: number, term: string, limit: number, offset: number): Promise<WordCollection[]> {
    // For collections, we use normalized LIKE for now as requested
    const termClean = term.trim().replace(/\s+/g, '%');
    if (!termClean || termClean.length > 80) return [];

    const normGerman = normalizeGermanSearch(term);
    const normArabic = normalizeArabicSearch(term);

    const query = `
        SELECT c.*, u.first_name as owner_name
        FROM word_collections c
        LEFT JOIN users u ON u.user_id = c.owner_user_id
        WHERE (c.owner_user_id = ? OR c.visibility = 'public')
          AND c.is_deleted = 0
          AND (
              LOWER(c.title) LIKE LOWER(?)
           OR LOWER(c.description) LIKE LOWER(?)
           OR LOWER(c.title) LIKE LOWER(?)
           OR LOWER(c.description) LIKE LOWER(?)
          )
        ORDER BY c.created_at DESC
        LIMIT ? OFFSET ?
    `;

    return await queryAll<WordCollection>(db, query, [
        currentUserId, 
        `%${termClean}%`, 
        `%${termClean}%`,
        `%${normGerman || normArabic}%`,
        `%${normGerman || normArabic}%`,
        limit, 
        offset
    ]);
}

import { normalizeUserSearchText } from '../services/searchNormalization.js';

export async function searchUsers(db: D1Database, term: string, limit: number, offset: number, isAdmin: boolean = false): Promise<User[]> {
    try {
        const normalizedTerm = normalizeUserSearchText(term);
        if (!normalizedTerm || normalizedTerm.length < 2 || normalizedTerm.length > 80) return [];

        // Fetch a broad set of candidates since SQL LIKE doesn't handle homoglyphs or diacritics well
        const candidatesLimit = 200;
        const query = `
            SELECT user_id, first_name, last_name, username, telegram_username, name, display_name, telegram_id, telegram_user_id
            FROM users
            WHERE COALESCE(is_deleted, 0) = 0
            ORDER BY user_id DESC
            LIMIT ?
        `;
        const candidates = await queryAll<User>(db, query, [candidatesLimit]);

        // Filter candidates in memory using our powerful normalizer
        const filtered = candidates.filter(u => {
            const check = (val: string | null | undefined) => {
                if (!val) return false;
                return normalizeUserSearchText(val).includes(normalizedTerm);
            };
            
            let match = check(u.display_name) || check(u.name) || check(u.first_name) || check(u.last_name);
            
            if (isAdmin && !match) {
                match = check(u.username) || check(u.telegram_username) || check(u.telegram_id?.toString()) || check(u.telegram_user_id?.toString());
            }
            return match;
        });

        // Apply pagination on the filtered results
        return filtered.slice(offset, offset + limit);
    } catch (e) {
        console.error('searchUsers error:', e);
        throw e;
    }
}

// Fallback functions
async function fallbackSearchWords(db: D1Database, userId: number, term: string, limit: number, offset: number): Promise<Word[]> {
    const normGerman = normalizeGermanSearch(term);
    const normArabic = normalizeArabicSearch(term);
    const rawMatch = `%${term.trim().replace(/\s+/g, '%')}%`;
    const normMatch = `%${normGerman || normArabic}%`;

    const query = `
        SELECT ${WORD_SELECT_COLUMNS} FROM words
        WHERE added_by = ?
          AND (
              german_search LIKE ?
           OR arabic_search LIKE ?
           OR LOWER(german) LIKE LOWER(?)
           OR arabic LIKE ?
          )
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
    `;
    return await queryAll<Word>(db, query, [userId, normMatch, normMatch, rawMatch, rawMatch, limit, offset]);
}

async function fallbackSearchCollectionWords(db: D1Database, collectionId: number, currentUserId: number, term: string, limit: number, offset: number): Promise<Word[]> {
    const normGerman = normalizeGermanSearch(term);
    const normArabic = normalizeArabicSearch(term);
    const rawMatch = `%${term.trim().replace(/\s+/g, '%')}%`;
    const normMatch = `%${normGerman || normArabic}%`;

    const query = `
        SELECT w.*
        FROM words w
        JOIN word_collection_items i ON w.word_id = i.word_id
        JOIN word_collections c ON c.id = i.collection_id
        WHERE i.collection_id = ?
          AND (c.owner_user_id = ? OR c.visibility = 'public')
          AND w.added_by = c.owner_user_id
          AND c.is_deleted = 0
          AND (
              w.german_search LIKE ?
           OR w.arabic_search LIKE ?
           OR LOWER(w.german) LIKE LOWER(?)
           OR w.arabic LIKE ?
          )
        ORDER BY w.created_at DESC
        LIMIT ? OFFSET ?
    `;
    return await queryAll<Word>(db, query, [collectionId, currentUserId, normMatch, normMatch, rawMatch, rawMatch, limit, offset]);
}
