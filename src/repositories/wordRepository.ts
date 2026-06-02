import type { D1Database } from '@cloudflare/workers-types';
import { queryOne, queryAll, run, runBatch } from '../db/queries';
import type { Word, UserUploadedList, ListWord } from '../models';

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
