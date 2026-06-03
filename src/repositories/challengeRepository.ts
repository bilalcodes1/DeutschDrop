import type { D1Database } from '@cloudflare/workers-types';
import { queryAll, queryOne, run, runBatch } from '../db/queries';

export interface AsyncChallenge {
    challenge_id: number;
    creator_user_id: number;
    opponent_user_id: number;
    question_count: number;
    status: 'creator_pending' | 'opponent_pending' | 'completed';
    created_at: string;
    completed_at: string | null;
    creator_score: number;
    opponent_score: number;
    creator_time_ms: number | null;
    opponent_time_ms: number | null;
    winner_user_id: number | null;
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
    questions: Array<{ word_id: number; prompt: string; answer: string; options: string[]; direction: 'de_ar' | 'ar_de' }>
): Promise<number> {
    const result = await run(
        db,
        'INSERT INTO async_challenges (creator_user_id, opponent_user_id, question_count) VALUES (?, ?, ?)',
        [creatorUserId, opponentUserId, questions.length]
    );
    const challengeId = (result.meta as { last_row_id?: number })?.last_row_id ?? 0;

    await runBatch(
        db,
        questions.map((question, index) => ({
            sql: `INSERT INTO challenge_questions (challenge_id, word_id, prompt, answer, options, direction, position)
                  VALUES (?, ?, ?, ?, ?, ?, ?)`,
            params: [challengeId, question.word_id, question.prompt, question.answer, JSON.stringify(question.options), question.direction, index],
        }))
    );

    return challengeId;
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
            'UPDATE async_challenges SET creator_score = ?, creator_time_ms = ?, status = ? WHERE challenge_id = ?',
            [score, timeMs, 'opponent_pending', challengeId]
        );
    } else if (challenge.opponent_user_id === userId) {
        const winnerId = pickWinner(challenge.creator_user_id, challenge.creator_score, challenge.creator_time_ms, userId, score, timeMs);
        await run(
            db,
            `UPDATE async_challenges
             SET opponent_score = ?, opponent_time_ms = ?, winner_user_id = ?, status = 'completed', completed_at = datetime('now')
             WHERE challenge_id = ?`,
            [score, timeMs, winnerId, challengeId]
        );
    }

    return getChallenge(db, challengeId);
}

function pickWinner(creatorId: number, creatorScore: number, creatorTimeMs: number | null, opponentId: number, opponentScore: number, opponentTimeMs: number): number | null {
    if (creatorScore > opponentScore) return creatorId;
    if (opponentScore > creatorScore) return opponentId;
    if (creatorTimeMs !== null && creatorTimeMs < opponentTimeMs) return creatorId;
    if (creatorTimeMs !== null && opponentTimeMs < creatorTimeMs) return opponentId;
    return null;
}
