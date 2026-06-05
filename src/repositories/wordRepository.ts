import type { D1Database } from '@cloudflare/workers-types';
import { queryOne, queryAll, run, runBatch } from '../db/queries';
import type { Word, UserUploadedList, ListWord } from '../models';
import { buildWordSearchFields, normalizeWordSearchQuery, rankWordSearchResults } from '../services/wordSearch';

export const DUPLICATE_WORD_ERROR = 'duplicate_word';
const WORD_SELECT_COLUMNS = `word_id, german, arabic, example, example_ar, pronunciation_ar,
    pronunciation_latin, level, added_by, created_at, updated_at, german_search, arabic_search, example_search`;
const WORD_SELECT_COLUMNS_SAFE = 'word_id, german, arabic, example, added_by, created_at';
const SEARCH_CANDIDATE_LIMIT = 200;

export function normalizeGermanForCompare(value: string): string {
    return value
        .replace(/^\uFEFF/, '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLocaleLowerCase('de-DE');
}

export async function getWordById(
    db: D1Database,
    wordId: number
): Promise<Word | null> {
    return queryOne<Word>(db, 'SELECT * FROM words WHERE word_id = ?', [wordId]);
}

export async function getWordsByUser(
    db: D1Database,
    userId: number
): Promise<Word[]> {
    return queryAll<Word>(
        db,
        'SELECT * FROM words WHERE added_by = ? ORDER BY created_at DESC',
        [userId]
    );
}

export async function countWordsByUser(db: D1Database, userId: number): Promise<number> {
    const row = await queryOne<{ count: number }>(
        db,
        'SELECT COUNT(*) AS count FROM words WHERE added_by = ?',
        [userId]
    );
    return row?.count ?? 0;
}

export async function getWordsByUserPaginated(
    db: D1Database,
    userId: number,
    limit: number,
    offset: number
): Promise<Word[]> {
    const safeLimit = Math.max(1, Math.min(200, Math.floor(Number(limit) || 10)));
    const safeOffset = Math.max(0, Math.floor(Number(offset) || 0));
    return queryAll<Word>(
        db,
        `SELECT ${WORD_SELECT_COLUMNS} FROM words WHERE added_by = ? ORDER BY created_at DESC, word_id DESC LIMIT ? OFFSET ?`,
        [userId, safeLimit, safeOffset]
    );
}

export async function getWordsByUserPaginatedFallback(
    db: D1Database,
    userId: number,
    limit: number,
    offset: number
): Promise<Word[]> {
    const safeLimit = Math.max(1, Math.min(200, Math.floor(Number(limit) || 10)));
    const safeOffset = Math.max(0, Math.floor(Number(offset) || 0));
    return queryAll<Word>(
        db,
        `SELECT ${WORD_SELECT_COLUMNS_SAFE} FROM words WHERE added_by = ? ORDER BY word_id DESC LIMIT ? OFFSET ?`,
        [userId, safeLimit, safeOffset]
    );
}

export async function searchWordsByUser(
    db: D1Database,
    userId: number,
    query: string,
    limit: number,
    offset: number
): Promise<Word[]> {
    const safeLimit = Math.max(1, Math.min(200, Math.floor(Number(limit) || 10)));
    const safeOffset = Math.max(0, Math.floor(Number(offset) || 0));
    const candidates = await searchWordCandidates(db, userId, query);
    return rankWordSearchResults(candidates, query).slice(safeOffset, safeOffset + safeLimit);
}

export async function countSearchWordsByUser(db: D1Database, userId: number, query: string): Promise<number> {
    const candidates = await searchWordCandidates(db, userId, query);
    return rankWordSearchResults(candidates, query).length;
}

async function searchWordCandidates(db: D1Database, userId: number, query: string): Promise<Word[]> {
    const normalized = normalizeWordSearchQuery(query);
    const germanPrefix = `${normalized.german}%`;
    const germanContains = `%${normalized.german}%`;
    const arabicPrefix = `${normalized.arabic}%`;
    const arabicContains = `%${normalized.arabic}%`;
    const rawContains = `%${normalized.raw}%`;

    try {
        return queryAll<Word>(
            db,
            `SELECT ${WORD_SELECT_COLUMNS} FROM words
             WHERE added_by = ?
               AND (
                    german_search LIKE ?
                 OR arabic_search LIKE ?
                 OR german_search LIKE ?
                 OR arabic_search LIKE ?
                 OR example_search LIKE ?
                 OR LOWER(german) LIKE LOWER(?)
                 OR arabic LIKE ?
                 OR example LIKE ?
               )
             ORDER BY
                CASE
                    WHEN german_search = ? THEN 100
                    WHEN german_search LIKE ? THEN 90
                    WHEN german_search LIKE ? THEN 80
                    WHEN arabic_search = ? THEN 75
                    WHEN arabic_search LIKE ? THEN 70
                    WHEN arabic_search LIKE ? THEN 60
                    ELSE 10
                END DESC,
                created_at DESC,
                word_id DESC
             LIMIT ?`,
            [
                userId,
                germanPrefix,
                arabicPrefix,
                germanContains,
                arabicContains,
                `%${normalized.german || normalized.arabic}%`,
                rawContains,
                rawContains,
                rawContains,
                normalized.german,
                germanPrefix,
                germanContains,
                normalized.arabic,
                arabicPrefix,
                arabicContains,
                SEARCH_CANDIDATE_LIMIT,
            ]
        );
    } catch {
        return queryAll<Word>(
            db,
            `SELECT ${WORD_SELECT_COLUMNS_SAFE} FROM words
             WHERE added_by = ?
               AND (
                    LOWER(german) LIKE LOWER(?)
                 OR arabic LIKE ?
                 OR example LIKE ?
               )
             ORDER BY created_at DESC, word_id DESC
             LIMIT ?`,
            [userId, rawContains, rawContains, rawContains, SEARCH_CANDIDATE_LIMIT]
        );
    }
}

export async function createWord(
    db: D1Database,
    german: string,
    arabic: string,
    example: string | null,
    addedBy: number
): Promise<number> {
    const search = buildWordSearchFields(german, arabic, example);
    const result = await run(
        db,
        `INSERT INTO words (german, arabic, example, added_by, german_search, arabic_search, example_search)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [german, arabic, example, addedBy, search.german_search, search.arabic_search, search.example_search]
    );
    return (result.meta as { last_row_id?: number })?.last_row_id ?? 0;
}

export async function createWordAndAssignToUser(
    db: D1Database,
    german: string,
    arabic: string,
    example: string | null,
    userId: number,
    listId?: number
): Promise<number> {
    const duplicate = await searchDuplicateWordForUser(db, userId, german);
    if (duplicate) {
        throw new Error(DUPLICATE_WORD_ERROR);
    }

    const wordId = await createWord(db, german, arabic, example, userId);

    // Add to user's vocabulary
    await run(
        db,
        'INSERT OR IGNORE INTO user_words (user_id, word_id, status, next_review) VALUES (?, ?, ?, datetime("now"))',
        [userId, wordId, 'new']
    );

    // If a list is specified, add to the list
    if (listId) {
        await run(
            db,
            'INSERT OR IGNORE INTO list_words (list_id, word_id) VALUES (?, ?)',
            [listId, wordId]
        );
    }

    return wordId;
}

export async function searchDuplicateWordForUser(
    db: D1Database,
    userId: number,
    german: string,
    excludeWordId?: number
): Promise<Word | null> {
    const words = await queryAll<Word>(db, 'SELECT * FROM words WHERE added_by = ?', [userId]);
    const key = normalizeGermanForCompare(german);
    return words.find(word =>
        normalizeGermanForCompare(word.german) === key &&
        (excludeWordId === undefined || word.word_id !== excludeWordId)
    ) ?? null;
}

export async function updateExistingWordFieldsForUser(
    db: D1Database,
    userId: number,
    german: string,
    arabic: string,
    example: string | null
): Promise<boolean> {
    const existing = await searchDuplicateWordForUser(db, userId, german);
    if (!existing) return false;

    const search = buildWordSearchFields(german, arabic, example);
    const result = await run(
        db,
        `UPDATE words
         SET arabic = ?, example = ?, arabic_search = ?, example_search = ?
         WHERE word_id = ? AND added_by = ?`,
        [arabic, example, search.arabic_search, search.example_search, existing.word_id, userId]
    );
    return ((result.meta as { changes?: number })?.changes ?? 0) > 0;
}

export async function searchDuplicateWordForUserSql(
    db: D1Database,
    userId: number,
    german: string,
    excludeWordId?: number
): Promise<Word | null> {
    const params: unknown[] = [userId, normalizeGermanForCompare(german)];
    let sql = 'SELECT * FROM words WHERE added_by = ? AND LOWER(TRIM(german)) = ?';
    if (excludeWordId !== undefined) {
        sql += ' AND word_id != ?';
        params.push(excludeWordId);
    }
    sql += ' LIMIT 1';
    return queryOne<Word>(db, sql, params);
}

export async function searchDuplicateWord(
    db: D1Database,
    german: string
): Promise<Word | null> {
    return queryOne<Word>(
        db,
        'SELECT * FROM words WHERE LOWER(german) = LOWER(?) LIMIT 1',
        [german.trim()]
    );
}

export async function updateWordForUser(
    db: D1Database,
    userId: number,
    wordId: number,
    german: string,
    arabic: string,
    example: string | null
): Promise<boolean> {
    const duplicate = await searchDuplicateWordForUser(db, userId, german, wordId);
    if (duplicate) {
        throw new Error(DUPLICATE_WORD_ERROR);
    }

    const search = buildWordSearchFields(german, arabic, example);
    const result = await run(
        db,
        `UPDATE words
         SET german = ?, arabic = ?, example = ?, german_search = ?, arabic_search = ?, example_search = ?
         WHERE word_id = ? AND added_by = ?`,
        [german, arabic, example, search.german_search, search.arabic_search, search.example_search, wordId, userId]
    );
    return ((result.meta as { changes?: number })?.changes ?? 0) > 0;
}

export async function updateWordAiFieldsForUser(
    db: D1Database,
    userId: number,
    wordId: number,
    fields: { example?: string | null; example_ar?: string | null; pronunciation_ar?: string | null; pronunciation_latin?: string | null; level?: string | null }
): Promise<boolean> {
    const updates: string[] = [];
    const values: unknown[] = [];

    if (fields.example !== undefined) {
        updates.push('example = ?');
        values.push(fields.example);
        updates.push('example_search = ?');
        const current = await getWordById(db, wordId);
        values.push(current ? buildWordSearchFields(current.german, current.arabic, fields.example).example_search : buildWordSearchFields('', '', fields.example).example_search);
    }
    if (fields.example_ar !== undefined) { updates.push('example_ar = ?'); values.push(fields.example_ar); }
    if (fields.pronunciation_ar !== undefined) { updates.push('pronunciation_ar = ?'); values.push(fields.pronunciation_ar); }
    if (fields.pronunciation_latin !== undefined) { updates.push('pronunciation_latin = ?'); values.push(fields.pronunciation_latin); }
    if (fields.level !== undefined) { updates.push('level = ?'); values.push(fields.level); }
    if (updates.length === 0) return false;

    values.push(wordId, userId);
    const result = await run(
        db,
        `UPDATE words SET ${updates.join(', ')} WHERE word_id = ? AND added_by = ?`,
        values
    );
    return ((result.meta as { changes?: number })?.changes ?? 0) > 0;
}

export async function deleteWordForUser(
    db: D1Database,
    userId: number,
    wordId: number
): Promise<boolean> {
    const word = await queryOne<Word>(
        db,
        'SELECT * FROM words WHERE word_id = ? AND added_by = ?',
        [wordId, userId]
    );
    if (!word) return false;

    await runBatch(db, [
        { sql: 'DELETE FROM list_words WHERE word_id = ?', params: [wordId] },
        { sql: 'DELETE FROM word_pictograms WHERE word_id = ?', params: [wordId] },
        { sql: 'DELETE FROM word_audio WHERE word_id = ?', params: [wordId] },
        { sql: 'DELETE FROM reviews WHERE word_id = ? AND user_id = ?', params: [wordId, userId] },
        { sql: 'DELETE FROM user_words WHERE word_id = ? AND user_id = ?', params: [wordId, userId] },
        { sql: 'DELETE FROM words WHERE word_id = ? AND added_by = ?', params: [wordId, userId] },
    ]);

    return true;
}

export async function deleteWordsForUser(db: D1Database, userId: number, wordIds: number[]): Promise<number> {
    let deleted = 0;
    for (const wordId of wordIds) {
        if (await deleteWordForUser(db, userId, wordId)) deleted++;
    }
    return deleted;
}

export async function deleteAllWordsForUser(db: D1Database, userId: number): Promise<number> {
    const words = await getWordsByUser(db, userId);
    return deleteWordsForUser(db, userId, words.map(word => word.word_id));
}

export async function getPeerWordSuggestions(
    db: D1Database,
    userId: number,
    limit: number = 10
): Promise<Array<Word & { owner_name: string }>> {
    return queryAll(
        db,
        `SELECT w.*, u.name AS owner_name
         FROM words w
         INNER JOIN users u ON u.user_id = w.added_by
         WHERE w.added_by != ?
           AND u.display_name IS NOT NULL
           AND NOT EXISTS (
                SELECT 1 FROM words own
                WHERE own.added_by = ?
                  AND LOWER(own.german) = LOWER(w.german)
           )
         ORDER BY w.created_at DESC
         LIMIT ?`,
        [userId, userId, limit]
    );
}

export async function createUploadedList(
    db: D1Database,
    userId: number,
    name: string
): Promise<number> {
    const result = await run(
        db,
        'INSERT INTO user_uploaded_lists (user_id, name) VALUES (?, ?)',
        [userId, name]
    );
    return (result.meta as { last_row_id?: number })?.last_row_id ?? 0;
}

export async function getUserLists(
    db: D1Database,
    userId: number
): Promise<UserUploadedList[]> {
    return queryAll<UserUploadedList>(
        db,
        'SELECT * FROM user_uploaded_lists WHERE user_id = ? ORDER BY created_at DESC',
        [userId]
    );
}

export async function getWordsInList(
    db: D1Database,
    listId: number
): Promise<Word[]> {
    return queryAll<Word>(
        db,
        `SELECT w.* FROM words w
         INNER JOIN list_words lw ON w.word_id = lw.word_id
         WHERE lw.list_id = ?
         ORDER BY lw.added_at DESC`,
        [listId]
    );
}

export async function getWordsForUserWithStatus(
    db: D1Database,
    userId: number,
    status?: string
): Promise<Array<Word & { status: string; next_review: string | null; correct_count: number; wrong_count: number }>> {
    let sql = `SELECT w.*, uw.status, uw.next_review, uw.correct_count, uw.wrong_count
               FROM words w
               INNER JOIN user_words uw ON w.word_id = uw.word_id
               WHERE uw.user_id = ?`;
    const params: unknown[] = [userId];
    if (status) {
        sql += ' AND uw.status = ?';
        params.push(status);
    }
    sql += ' ORDER BY uw.added_at DESC';
    return queryAll(db, sql, params);
}

export async function getTrainingWordCandidates(
    db: D1Database,
    userId: number,
    limit: number = 100
): Promise<Array<Word & { status: string; next_review: string | null; correct_count: number; wrong_count: number; difficulty_score?: number; stats_is_hard?: number; consecutive_wrong?: number }>> {
    return queryAll(
        db,
        `SELECT w.*, uw.status, uw.next_review, uw.correct_count, uw.wrong_count,
                COALESCE(wls.difficulty_score, 0) AS difficulty_score,
                COALESCE(wls.is_hard, 0) AS stats_is_hard,
                COALESCE(wls.consecutive_wrong, 0) AS consecutive_wrong
         FROM words w
         INNER JOIN user_words uw ON w.word_id = uw.word_id
         LEFT JOIN word_learning_stats wls ON wls.user_id = uw.user_id AND wls.word_id = uw.word_id
         WHERE uw.user_id = ?
         ORDER BY
            CASE
                WHEN uw.next_review IS NOT NULL AND datetime(uw.next_review) <= datetime('now') THEN 0
                WHEN COALESCE(wls.is_hard, 0) = 1 OR COALESCE(wls.difficulty_score, 0) >= 0.7 OR uw.wrong_count >= 2 OR uw.wrong_count > uw.correct_count OR uw.status = 'learning' THEN 1
                WHEN uw.wrong_count > 0 THEN 2
                WHEN uw.status = 'new' OR (uw.correct_count = 0 AND uw.wrong_count = 0) THEN 3
                ELSE 4
            END,
            RANDOM()
         LIMIT ?`,
        [userId, limit]
    );
}
