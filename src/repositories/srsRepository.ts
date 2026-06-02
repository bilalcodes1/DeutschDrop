import type { D1Database } from '@cloudflare/workers-types';
import { queryOne, queryAll, run } from '../db/queries';
import type { UserWord, Review } from '../models';

export async function getDueWords(
    db: D1Database,
    userId: number,
    limit: number = 10
): Promise<Array<UserWord & { german: string; arabic: string; example: string | null }>> {
    return queryAll(
        db,
        `SELECT uw.*, w.german, w.arabic, w.example
         FROM user_words uw
         INNER JOIN words w ON uw.word_id = w.word_id
         WHERE uw.user_id = ?
           AND (uw.status = 'new' OR uw.next_review <= datetime('now'))
         ORDER BY uw.next_review ASC NULLS LAST, uw.added_at ASC
         LIMIT ?`,
        [userId, limit]
    );
}

export async function getWordProgress(
    db: D1Database,
    userId: number,
    wordId: number
): Promise<UserWord | null> {
    return queryOne<UserWord>(
        db,
        'SELECT * FROM user_words WHERE user_id = ? AND word_id = ?',
        [userId, wordId]
    );
}

export async function updateWordProgress(
    db: D1Database,
    userId: number,
    wordId: number,
    update: {
        status?: string;
        ease_factor?: number;
        interval?: number;
        repetitions?: number;
        next_review?: string | null;
        correct_count?: number;
        wrong_count?: number;
    }
): Promise<void> {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (update.status !== undefined) { fields.push('status = ?'); values.push(update.status); }
    if (update.ease_factor !== undefined) { fields.push('ease_factor = ?'); values.push(update.ease_factor); }
    if (update.interval !== undefined) { fields.push('interval = ?'); values.push(update.interval); }
    if (update.repetitions !== undefined) { fields.push('repetitions = ?'); values.push(update.repetitions); }
    if (update.next_review !== undefined) { fields.push('next_review = ?'); values.push(update.next_review); }
    if (update.correct_count !== undefined) { fields.push('correct_count = ?'); values.push(update.correct_count); }
    if (update.wrong_count !== undefined) { fields.push('wrong_count = ?'); values.push(update.wrong_count); }

    if (fields.length === 0) return;

    values.push(userId, wordId);
    await run(
        db,
        `UPDATE user_words SET ${fields.join(', ')} WHERE user_id = ? AND word_id = ?`,
        values
    );
}

export async function recordReview(
    db: D1Database,
    userId: number,
    wordId: number,
    isCorrect: boolean,
    responseTimeMs: number | null,
    difficultyRating: string | null
): Promise<void> {
    await run(
        db,
        'INSERT INTO reviews (user_id, word_id, is_correct, response_time_ms, difficulty_rating) VALUES (?, ?, ?, ?, ?)',
        [userId, wordId, isCorrect ? 1 : 0, responseTimeMs, difficultyRating]
    );
}

export async function getWordCountByStatus(
    db: D1Database,
    userId: number
): Promise<Record<string, number>> {
    const rows = await queryAll<{ status: string; count: number }>(
        db,
        'SELECT status, COUNT(*) as count FROM user_words WHERE user_id = ? GROUP BY status',
        [userId]
    );
    const result: Record<string, number> = {};
    for (const row of rows) {
        result[row.status] = row.count;
    }
    return result;
}
