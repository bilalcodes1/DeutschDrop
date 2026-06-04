import type { BotContext } from '../bot/context';
import type { Word } from '../models';
import { runAiTask } from './ai/aiRouter';

export interface TrainingGradeResult {
    isCorrect: boolean;
    verdict: 'correct' | 'almost' | 'wrong';
    source: 'local' | 'ai' | 'fallback';
    feedback?: string;
}

interface AiGradeResult {
    is_correct?: boolean;
    confidence?: number;
    verdict?: 'correct' | 'almost' | 'wrong';
    short_feedback?: string;
}

interface GradeInput {
    questionType: string;
    direction: 'de_ar' | 'ar_de';
    correctAnswer: string;
    userAnswer: string;
    word: Word | null;
    userId: number;
}

export async function gradeTrainingAnswer(ctx: BotContext, input: GradeInput): Promise<TrainingGradeResult> {
    const local = gradeTrainingAnswerLocal(input.correctAnswer, input.userAnswer, input.direction);
    if (local !== 'uncertain') {
        return { isCorrect: local, verdict: local ? 'correct' : 'wrong', source: 'local' };
    }

    if (ctx.env.AI_ENABLED !== 'true') {
        return { isCorrect: false, verdict: 'wrong', source: 'fallback' };
    }

    const ai = await runAiTask<AiGradeResult>(
        ctx.env,
        ctx.db,
        'grade_training_answer',
        {
            question_type: input.questionType,
            direction: input.direction === 'de_ar' ? 'de_to_ar' : 'ar_to_de',
            german: input.word?.german ?? null,
            arabic: input.word?.arabic ?? null,
            example: input.word?.example ?? null,
            correct_answer: input.correctAnswer,
            user_answer: input.userAnswer,
            level: input.word?.level ?? 'Unknown',
        },
        {
            userId: input.userId,
            validateResult: (result) => validateAiGradeResult(result as AiGradeResult),
        }
    );

    if (!ai.result) return { isCorrect: false, verdict: 'wrong', source: 'fallback' };

    if (ai.result.is_correct === true && (ai.result.confidence ?? 0) >= 0.75) {
        return {
            isCorrect: true,
            verdict: 'correct',
            source: 'ai',
            feedback: ai.result.short_feedback || 'قبلتها لأن المعنى نفسه.',
        };
    }

    if (ai.result.verdict === 'almost') {
        return {
            isCorrect: false,
            verdict: 'almost',
            source: 'ai',
            feedback: ai.result.short_feedback || 'قريب، بس الجواب الأدق مختلف.',
        };
    }

    return {
        isCorrect: false,
        verdict: 'wrong',
        source: 'ai',
        feedback: ai.result.short_feedback,
    };
}

export function gradeTrainingAnswerLocal(correctAnswer: string, userAnswer: string, direction: 'de_ar' | 'ar_de'): boolean | 'uncertain' {
    if (direction === 'ar_de') {
        return normalizeGermanAnswer(correctAnswer) === normalizeGermanAnswer(userAnswer);
    }

    const correct = normalizeArabicAnswer(correctAnswer);
    const user = normalizeArabicAnswer(userAnswer);
    if (correct === user) return true;

    const correctWithoutParentheses = normalizeArabicAnswer(correctAnswer.replace(/[()（）]/g, ' '));
    if (correctWithoutParentheses === user) return true;

    if (hasParentheticalMeaning(correctAnswer) && correctWithoutParentheses === user) return true;
    if (isSingleArabicToken(correct) && isSingleArabicToken(user)) return false;

    return 'uncertain';
}

export function normalizeGermanAnswer(value: string): string {
    return value
        .trim()
        .toLocaleLowerCase('de-DE')
        .replace(/ß/g, 'ss')
        .replace(/[.,!?;:،؛؟]+$/g, '')
        .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function normalizeArabicAnswer(value: string): string {
    return value
        .trim()
        .replace(/[\u064B-\u065F\u0670]/g, '')
        .replace(/[()（）]/g, ' ')
        .replace(/[أإآٱ]/g, 'ا')
        .replace(/ى/g, 'ي')
        .replace(/ة/g, 'ه')
        .replace(/[.,!?;:،؛؟"']/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function validateAiGradeResult(result: AiGradeResult): boolean {
    if (!result || typeof result !== 'object') return false;
    if (!['correct', 'almost', 'wrong'].includes(result.verdict ?? '')) return false;
    if (typeof result.is_correct !== 'boolean') return false;
    if (typeof result.confidence !== 'number') return false;
    return result.confidence >= 0 && result.confidence <= 1;
}

function hasParentheticalMeaning(value: string): boolean {
    return /\(.+?\)|（.+?）/.test(value);
}

function isSingleArabicToken(value: string): boolean {
    return value.split(/\s+/).filter(Boolean).length === 1;
}
