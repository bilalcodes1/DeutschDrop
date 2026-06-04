import type { D1Database } from '@cloudflare/workers-types';

export type AdaptiveQuestionType =
    'multiple_choice' | 'de_to_ar' | 'ar_to_de' | 'typing_de' | 'typing_ar' |
    'missing_letters' | 'first_last_hint' | 'example_context' | 'pictogram_recall';
export type AdaptiveGrade = 'correct' | 'almost' | 'wrong' | 'easy' | 'medium' | 'hard';
export type AdaptiveSource = 'learn' | 'train' | 'challenge' | 'notification';

interface AdaptiveAnswerInput {
    userId: number;
    wordId: number;
    questionType: AdaptiveQuestionType | string;
    isCorrect: boolean;
    grade?: AdaptiveGrade;
    answeredAt?: Date;
    source: AdaptiveSource;
}

export async function updateWordLearningAfterAnswer(db: D1Database, input: AdaptiveAnswerInput): Promise<void> {
    const now = (input.answeredAt ?? new Date()).toISOString();
    const current = await db.prepare(
        `SELECT * FROM word_learning_stats WHERE user_id = ? AND word_id = ?`
    ).bind(input.userId, input.wordId).first<{
        seen_count: number; correct_count: number; wrong_count: number; lapse_count: number;
        consecutive_correct: number; consecutive_wrong: number; ease_factor: number;
        stability: number; difficulty_score: number; is_hard: number;
    }>();

    const seenCount = (current?.seen_count ?? 0) + 1;
    const wasLearned = (current?.consecutive_correct ?? 0) > 0 || (current?.correct_count ?? 0) >= 2;
    const isAlmost = input.grade === 'almost';
    const weightedWrong = !input.isCorrect || isAlmost;
    const sourceImpact = input.source === 'challenge' ? 0.5 : input.source === 'notification' ? 0.45 : 1;
    const correctCount = (current?.correct_count ?? 0) + (input.isCorrect && !isAlmost ? 1 : 0);
    const wrongCount = (current?.wrong_count ?? 0) + (weightedWrong ? 1 : 0);
    const lapseCount = (current?.lapse_count ?? 0) + (weightedWrong && wasLearned ? 1 : 0);
    const consecutiveCorrect = input.isCorrect && !isAlmost ? (current?.consecutive_correct ?? 0) + 1 : 0;
    const consecutiveWrong = weightedWrong ? (current?.consecutive_wrong ?? 0) + 1 : 0;
    const easeFactor = clamp((current?.ease_factor ?? 2.5) + (input.isCorrect ? 0.05 : -0.2) * sourceImpact, 1.3, 3.2);
    const stability = Math.max(0, (current?.stability ?? 0) + (input.isCorrect ? 1 : -0.5) * sourceImpact);
    const difficultyScore = calculateDifficultyScore({
        seenCount,
        correctCount,
        wrongCount,
        lapseCount,
        consecutiveWrong,
        questionType: input.questionType,
        previous: current?.difficulty_score ?? 0,
        isCorrect: input.isCorrect && !isAlmost,
        sourceImpact,
    });
    const hard = shouldBeHard({ wrongCount, lapseCount, consecutiveWrong, consecutiveCorrect, difficultyScore });
    const hardReason = hard
        ? consecutiveWrong >= 2 ? 'consecutive_wrong'
            : wrongCount >= 3 ? 'repeated_mistakes'
                : difficultyScore >= 0.7 ? 'low_success_rate'
                    : 'user_marked_hard'
        : null;

    await db.prepare(
        `INSERT INTO word_learning_stats (
            user_id, word_id, seen_count, correct_count, wrong_count, lapse_count,
            consecutive_correct, consecutive_wrong, last_seen_at, last_correct_at, last_wrong_at,
            last_question_type, ease_factor, stability, difficulty_score, retrievability,
            is_hard, hard_reason, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
         ON CONFLICT(user_id, word_id) DO UPDATE SET
            seen_count = excluded.seen_count,
            correct_count = excluded.correct_count,
            wrong_count = excluded.wrong_count,
            lapse_count = excluded.lapse_count,
            consecutive_correct = excluded.consecutive_correct,
            consecutive_wrong = excluded.consecutive_wrong,
            last_seen_at = excluded.last_seen_at,
            last_correct_at = COALESCE(excluded.last_correct_at, word_learning_stats.last_correct_at),
            last_wrong_at = COALESCE(excluded.last_wrong_at, word_learning_stats.last_wrong_at),
            last_question_type = excluded.last_question_type,
            ease_factor = excluded.ease_factor,
            stability = excluded.stability,
            difficulty_score = excluded.difficulty_score,
            retrievability = excluded.retrievability,
            is_hard = excluded.is_hard,
            hard_reason = excluded.hard_reason,
            updated_at = datetime('now')`
    ).bind(
        input.userId,
        input.wordId,
        seenCount,
        correctCount,
        wrongCount,
        lapseCount,
        consecutiveCorrect,
        consecutiveWrong,
        now,
        input.isCorrect && !isAlmost ? now : null,
        weightedWrong ? now : null,
        input.questionType,
        easeFactor,
        stability,
        difficultyScore,
        clamp(1 - difficultyScore, 0, 1),
        hard ? 1 : 0,
        hardReason
    ).run();

    if (input.source !== 'learn') {
        await updateLegacyWordStats(db, input, hard, easeFactor);
    }
}

export function calculateDifficultyScore(input: {
    seenCount: number;
    correctCount: number;
    wrongCount: number;
    lapseCount: number;
    consecutiveWrong: number;
    questionType: string;
    previous: number;
    isCorrect: boolean;
    sourceImpact: number;
}): number {
    const wrongRatio = input.wrongCount / Math.max(1, input.seenCount);
    const lapsePenalty = Math.min(0.3, input.lapseCount * 0.08);
    const streakPenalty = Math.min(0.25, input.consecutiveWrong * 0.08);
    const typePenalty = questionTypePenalty(input.questionType);
    const raw = clamp(wrongRatio + lapsePenalty + streakPenalty + typePenalty, 0, 1);
    const blended = input.isCorrect
        ? input.previous * 0.7 + raw * 0.3 - 0.08 * input.sourceImpact
        : input.previous * 0.35 + raw * 0.65 + 0.08 * input.sourceImpact;
    return Math.round(clamp(blended, 0, 1) * 100) / 100;
}

export function shouldBeHard(input: {
    wrongCount: number;
    lapseCount: number;
    consecutiveWrong: number;
    consecutiveCorrect: number;
    difficultyScore: number;
}): boolean {
    if (input.consecutiveCorrect >= 4 && input.difficultyScore < 0.35) return false;
    return input.wrongCount >= 3 ||
        input.lapseCount >= 2 ||
        input.consecutiveWrong >= 2 ||
        input.difficultyScore >= 0.7;
}

function questionTypePenalty(questionType: string): number {
    const penalties: Record<string, number> = {
        multiple_choice: 0,
        de_ar: 0.05,
        de_to_ar: 0.05,
        ar_de: 0.08,
        ar_to_de: 0.08,
        typing_de: 0.15,
        typing_ar: 0.10,
        missing_letters: 0.12,
        first_last_hint: 0.12,
        example_context: 0.10,
    };
    return penalties[questionType] ?? 0.05;
}

async function updateLegacyWordStats(db: D1Database, input: AdaptiveAnswerInput, isHard: boolean, easeFactor: number): Promise<void> {
    const delay = !input.isCorrect
        ? input.grade === 'almost' ? '+4 hours' : '+1 hour'
        : isHard ? '+1 day' : '+3 days';
    await db.prepare(
        `UPDATE user_words
         SET correct_count = correct_count + ?,
             wrong_count = wrong_count + ?,
             ease_factor = ?,
             status = CASE
                WHEN ? = 1 THEN 'learning'
                WHEN correct_count + ? >= 3 THEN 'reviewing'
                ELSE status
             END,
             next_review = datetime('now', ?)
         WHERE user_id = ? AND word_id = ?`
    ).bind(
        input.isCorrect ? 1 : 0,
        input.isCorrect ? 0 : 1,
        easeFactor,
        isHard ? 1 : 0,
        input.isCorrect ? 1 : 0,
        delay,
        input.userId,
        input.wordId
    ).run();
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}
