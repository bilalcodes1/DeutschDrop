import type { D1Database } from '@cloudflare/workers-types';
import { queryOne, queryAll, run, runBatch } from '../db/queries';
import type { Word, UserUploadedList, ListWord } from '../models';

export const DUPLICATE_WORD_ERROR = 'duplicate_word';

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

export async function createWord(
    db: D1Database,
    german: string,
    arabic: string,
    example: string | null,
    addedBy: number
): Promise<number> {
    const result = await run(
        db,
        'INSERT INTO words (german, arabic, example, added_by) VALUES (?, ?, ?, ?)',
        [german, arabic, example, addedBy]
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

    const result = await run(
        db,
        'UPDATE words SET arabic = ?, example = ? WHERE word_id = ? AND added_by = ?',
        [arabic, example, existing.word_id, userId]
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

    const result = await run(
        db,
        'UPDATE words SET german = ?, arabic = ?, example = ? WHERE word_id = ? AND added_by = ?',
        [german, arabic, example, wordId, userId]
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
