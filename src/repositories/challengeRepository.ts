import type { D1Database } from '@cloudflare/workers-types';
import { queryAll, queryOne, run, runBatch } from '../db/queries';

export interface AsyncChallenge {
    challenge_id: number;
    creator_user_id: number;
    opponent_user_id: number;
    question_count: number;
    status: 'waiting_opponent' | 'in_progress' | 'completed' | 'expired' | 'cancelled';
    created_at: string;
    expires_at: string | null;
    completed_at: string | null;
    creator_score: number;
    opponent_score: number;
    creator_time_ms: number | null;
    opponent_time_ms: number | null;
    winner_user_id: number | null;
    challenge_source_type: string | null;
    challenge_source_id: string | null;
    challenge_word_origin_json: string | null;
}

export interface ChallengeQuestion {
    challenge_id: number;
    word_id: number;
    prompt: string;
    answer: string;
    options: string;
    direction: 'de_ar' | 'ar_de';
    position: number;
}

export async function createAsyncChallenge(
    db: D1Database,
    creatorUserId: number,
    opponentUserId: number,
    questions: Array<{ word_id: number; prompt: string; answer: string; options: string[]; direction: 'de_ar' | 'ar_de'; type?: string; german?: string; helper?: string }>,
    metadata?: { sourceType?: string; sourceId?: string | number | null; wordOrigin?: unknown }
): Promise<number> {
    const result = await run(
        db,
        `INSERT INTO async_challenges (
            creator_user_id, opponent_user_id, question_count, status, expires_at,
            challenge_source_type, challenge_source_id, challenge_word_origin_json
         )
         VALUES (?, ?, ?, 'waiting_opponent', datetime('now', '+24 hours'), ?, ?, ?)`,
        [
            creatorUserId,
            opponentUserId,
            questions.length,
            metadata?.sourceType ?? 'all_words',
            metadata?.sourceId == null ? null : String(metadata.sourceId),
            metadata?.wordOrigin ? JSON.stringify(metadata.wordOrigin) : null,
        ]
    );
    const challengeId = (result.meta as { last_row_id?: number })?.last_row_id ?? 0;

    await runBatch(
        db,
        questions.map((question, index) => ({
            sql: `INSERT INTO challenge_questions (challenge_id, word_id, prompt, answer, options, direction, position)
                  VALUES (?, ?, ?, ?, ?, ?, ?)`,
            params: [challengeId, question.word_id, question.prompt, question.answer, serializeChallengeQuestionOptions(question), question.direction, index],
        }))
    );

    return challengeId;
}

function serializeChallengeQuestionOptions(question: { options: string[]; type?: string; german?: string; helper?: string }): string {
    if (!question.type && !question.german && !question.helper) {
        return JSON.stringify(question.options);
    }
    return JSON.stringify({
        options: question.options,
        type: question.type,
        german: question.german,
        helper: question.helper,
    });
}

export async function getChallenge(db: D1Database, challengeId: number): Promise<AsyncChallenge | null> {
    return queryOne<AsyncChallenge>(db, 'SELECT * FROM async_challenges WHERE challenge_id = ?', [challengeId]);
}

export async function getChallengeQuestions(db: D1Database, challengeId: number): Promise<ChallengeQuestion[]> {
    return queryAll<ChallengeQuestion>(
        db,
        'SELECT * FROM challenge_questions WHERE challenge_id = ? ORDER BY position',
        [challengeId]
    );
}

export async function submitChallengeResult(
    db: D1Database,
    challengeId: number,
    userId: number,
    score: number,
    timeMs: number
): Promise<AsyncChallenge | null> {
    const challenge = await getChallenge(db, challengeId);
    if (!challenge) return null;

    if (challenge.creator_user_id === userId) {
        await run(
            db,
            `UPDATE async_challenges
             SET creator_score = ?,
                 creator_time_ms = ?,
                 status = CASE WHEN opponent_time_ms IS NULL THEN 'waiting_opponent' ELSE status END
             WHERE challenge_id = ?`,
            [score, timeMs, challengeId]
        );
    } else if (challenge.opponent_user_id === userId) {
        await run(
            db,
            `UPDATE async_challenges
             SET opponent_score = ?,
                 opponent_time_ms = ?,
                 status = CASE WHEN creator_time_ms IS NULL THEN 'waiting_opponent' ELSE status END
             WHERE challenge_id = ?`,
            [score, timeMs, challengeId]
        );
    }

    const updated = await getChallenge(db, challengeId);
    if (!updated) return null;
    if (updated.creator_time_ms !== null && updated.opponent_time_ms !== null && updated.status !== 'completed') {
        const winnerId = pickWinnerByScoreAndDuration(
            updated.creator_user_id,
            updated.creator_score,
            updated.creator_time_ms,
            updated.opponent_user_id,
            updated.opponent_score,
            updated.opponent_time_ms
        );
        await run(
            db,
            `UPDATE async_challenges
             SET winner_user_id = ?, status = 'completed', completed_at = datetime('now')
             WHERE challenge_id = ?`,
            [winnerId, challengeId]
        );
    }

    return getChallenge(db, challengeId);
}

export async function hasOpenChallengeBetween(db: D1Database, userA: number, userB: number): Promise<boolean> {
    const row = await queryOne<{ count: number }>(
        db,
        `SELECT COUNT(*) AS count
         FROM async_challenges
         WHERE status IN ('waiting_opponent', 'in_progress')
           AND ((creator_user_id = ? AND opponent_user_id = ?) OR (creator_user_id = ? AND opponent_user_id = ?))`,
        [userA, userB, userB, userA]
    );
    return (row?.count ?? 0) > 0;
}

export async function expireOldChallenges(db: D1Database): Promise<AsyncChallenge[]> {
    const expired = await queryAll<AsyncChallenge>(
        db,
        `SELECT * FROM async_challenges
         WHERE status IN ('waiting_opponent', 'in_progress')
           AND expires_at IS NOT NULL
           AND expires_at <= datetime('now')`
    );
    if (expired.length > 0) {
        await run(
            db,
            `UPDATE async_challenges
             SET status = 'expired', completed_at = datetime('now')
             WHERE status IN ('waiting_opponent', 'in_progress')
               AND expires_at IS NOT NULL
               AND expires_at <= datetime('now')`
        );
    }
    return expired;
}

export function pickWinnerByScoreAndDuration(
    creatorId: number,
    creatorScore: number,
    creatorTimeMs: number | null,
    opponentId: number,
    opponentScore: number,
    opponentTimeMs: number | null
): number | null {
    if (creatorScore > opponentScore) return creatorId;
    if (opponentScore > creatorScore) return opponentId;
    if (creatorTimeMs === null || opponentTimeMs === null) return null;
    if (creatorTimeMs < opponentTimeMs) return creatorId;
    if (opponentTimeMs < creatorTimeMs) return opponentId;
    return null;
}
