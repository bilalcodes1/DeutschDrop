import type { D1Database } from '@cloudflare/workers-types';
import {
    advanceGoetheSession,
    createGoetheSession,
    getActiveGoetheSession,
    getCurrentGoetheQuestion,
    getGoetheQuestionOptions,
    getGoetheSession,
    getGoetheSessionReview,
    getGoetheUserStats,
    markGoetheQuestionAnswered,
    recordGoetheAttempt,
    selectGoetheQuestionCandidates,
    type GoetheLevel,
    type GoetheSession,
    type GoetheSessionQuestionDetail,
} from '../repositories/goetheRepository.js';
import { evaluateWrittenAnswer } from './trainingAnswerMatcher.js';
import { addXp } from './xpLevels.js';

export type GoetheMode = 'challenge' | 'missed_call' | 'speed' | 'weakness' | 'mock';

export interface GoetheStartResult {
    ok: boolean;
    message?: string;
    sessionId?: number;
}

export interface GoetheAnswerResult {
    ok: boolean;
    duplicate?: boolean;
    finished?: boolean;
    correct?: boolean;
    xpAwarded?: number;
    pointsAwarded?: number;
    correctAnswer?: string;
    explanation?: string | null;
    transcript?: string | null;
    session?: GoetheSession;
    nextQuestion?: GoetheSessionQuestionDetail | null;
    message?: string;
}

export async function startGoetheSession(db: D1Database, userId: number, level: GoetheLevel, mode: GoetheMode): Promise<GoetheStartResult> {
    const existing = await getActiveGoetheSession(db, userId);
    if (existing) return { ok: true, sessionId: existing.session_id, message: 'عندك جلسة Goethe نشطة. كملها أولاً.' };

    const selection = modeSelection(mode);
    const candidates = await selectGoetheQuestionCandidates(db, {
        userId,
        level,
        mode,
        limit: selection.count,
        section: selection.section,
        scenarioTypes: selection.scenarioTypes,
        weakness: mode === 'weakness',
    });
    const picked = pickDiverse(candidates, selection.count).map(q => q.question_id);
    if (picked.length === 0) return { ok: false, message: noQuestionsMessage(level, mode) };

    const sessionId = await createGoetheSession(db, {
        userId,
        mode,
        level,
        section: selection.section ?? null,
        scenarioType: selection.scenarioTypes?.join('|') ?? null,
        questionIds: picked,
        speedSeconds: mode === 'speed' ? 30 : null,
    });
    return { ok: true, sessionId };
}

export async function answerGoetheQuestion(
    db: D1Database,
    userId: number,
    sessionId: number,
    position: number,
    selectedAnswer: string
): Promise<GoetheAnswerResult> {
    const session = await getGoetheSession(db, sessionId);
    if (!session || session.user_id !== userId) return { ok: false, message: 'هذه الجلسة غير متاحة.' };
    if (session.status !== 'active') return { ok: false, message: 'هذه الجلسة انتهت.' };
    if (session.current_position !== position) return { ok: false, message: 'هذا السؤال لم يعد نشطاً.' };

    const question = await getCurrentGoetheQuestion(db, sessionId);
    if (!question || question.position !== position) return { ok: false, message: 'السؤال غير متاح.' };

    const timedOut = Boolean(question.deadline_at && new Date(question.deadline_at.replace(' ', 'T') + 'Z').getTime() < Date.now());
    const correct = !timedOut && isGoetheAnswerCorrect(question, selectedAnswer);
    const marked = await markGoetheQuestionAnswered(db, {
        sessionQuestionId: question.session_question_id,
        selectedAnswer,
        isCorrect: correct,
        responseTimeMs: elapsedMs(session.started_at),
    });
    if (!marked) return { ok: true, duplicate: true, message: 'تم تسجيل الإجابة مسبقاً.' };

    const xpAwarded = correct ? question.points : 0;
    if (xpAwarded > 0) {
        await addXp(db, userId, xpAwarded, {
            reason: 'goethe_correct',
            sourceType: 'goethe_challenge',
            sourceId: String(session.session_id),
            allowDailyCap: true,
            allowBoost: true,
            metadata: {
                session_id: session.session_id,
                question_id: question.question_id,
                level: question.level,
                mode: session.mode,
                source_id: session.source_id,
            },
        });
    }

    await recordGoetheAttempt(db, {
        userId,
        sessionId,
        questionId: question.question_id,
        mode: session.mode,
        selectedAnswer,
        correctAnswer: question.correct_answer,
        isCorrect: correct,
        responseTimeMs: elapsedMs(session.started_at),
        pointsAwarded: correct ? question.points : 0,
        xpAwarded,
        timeout: timedOut,
    });

    const updated = await advanceGoetheSession(db, sessionId, correct, question.points, xpAwarded);
    const nextQuestion = updated.status === 'active' ? await getCurrentGoetheQuestion(db, sessionId) : null;
    return {
        ok: true,
        finished: updated.status === 'finished',
        correct,
        xpAwarded,
        pointsAwarded: correct ? question.points : 0,
        correctAnswer: question.correct_answer,
        explanation: question.explanation,
        transcript: question.transcript,
        session: updated,
        nextQuestion,
    };
}

export async function getGoetheQuestionRenderData(db: D1Database, sessionId: number): Promise<{
    question: GoetheSessionQuestionDetail | null;
    options: Awaited<ReturnType<typeof getGoetheQuestionOptions>>;
}> {
    const question = await getCurrentGoetheQuestion(db, sessionId);
    return {
        question,
        options: question ? await getGoetheQuestionOptions(db, question.question_id) : [],
    };
}

export async function formatGoetheStats(db: D1Database, userId: number): Promise<string> {
    const stats = await getGoetheUserStats(db, userId);
    const rate = stats.questions > 0 ? Math.round((stats.correct / stats.questions) * 100) : 0;
    const weak = stats.weak.length
        ? stats.weak.map(item => `• ${item.scenario_type}: ${item.weakness}`).join('\n')
        : '• لا توجد نقاط ضعف بعد';
    return `📊 إحصائياتي في غوته\n\n` +
        `الجلسات: ${stats.sessions}\n` +
        `الأسئلة: ${stats.questions}\n` +
        `نسبة النجاح: ${rate}%\n` +
        `متوسط زمن الإجابة: ${stats.avg_ms ? `${(stats.avg_ms / 1000).toFixed(1)} ثانية` : 'غير متوفر'}\n\n` +
        `نقاط تحتاج مراجعة:\n${weak}`;
}

export async function formatGoetheReview(db: D1Database, sessionId: number, userId: number): Promise<string> {
    const rows = await getGoetheSessionReview(db, sessionId, userId);
    if (!rows.length) return 'لا توجد مراجعة لهذه الجلسة.';
    return `📖 مراجعة الإجابات\n\n` + rows.slice(0, 20).map(row =>
        `${row.position + 1}. ${row.question_text}\n` +
        `إجابتك: ${row.user_answer ?? '-'}\n` +
        `الصحيح: ${row.correct_answer}\n` +
        (row.explanation ? `شرح: ${row.explanation}\n` : '')
    ).join('\n');
}

function isGoetheAnswerCorrect(question: GoetheSessionQuestionDetail, selectedAnswer: string): boolean {
    const answer = selectedAnswer.trim();
    if (question.format === 'mcq_single') return answer.toUpperCase() === question.correct_answer.toUpperCase();
    if (question.format === 'true_false') return answer.toLowerCase() === question.correct_answer.toLowerCase();
    return evaluateWrittenAnswer({
        userAnswer: answer,
        expectedAnswer: question.correct_answer,
        acceptedAnswers: parseGoetheAcceptedAnswers(question.accepted_answers_json, question.correct_answer),
        answerLanguage: 'de',
    }).accepted;
}

function parseGoetheAcceptedAnswers(raw: string | null, fallback: string): string[] {
    if (raw) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return parsed.map(String);
        } catch {
            // fall through
        }
    }
    return fallback.split('|').map(value => value.trim()).filter(Boolean);
}

function modeSelection(mode: GoetheMode): { count: number; section?: string; scenarioTypes?: string[] } {
    if (mode === 'missed_call') return { count: 10, section: 'listening', scenarioTypes: ['phone', 'voicemail'] };
    if (mode === 'mock') return { count: 20 };
    return { count: 10 };
}

function pickDiverse<T extends { question_id: number; difficulty: number; section: string; scenario_type: string }>(items: T[], count: number): T[] {
    const picked: T[] = [];
    const seen = new Set<number>();
    const buckets = [...items].sort((a, b) => a.difficulty - b.difficulty || a.question_id - b.question_id);
    for (const item of buckets) {
        if (seen.has(item.question_id)) continue;
        picked.push(item);
        seen.add(item.question_id);
        if (picked.length >= count) break;
    }
    return picked;
}

function noQuestionsMessage(level: GoetheLevel, mode: GoetheMode): string {
    if (mode === 'missed_call') return `لا توجد أسئلة phone/voicemail فعالة لمستوى ${level}.`;
    if (mode === 'weakness') return `لا توجد أسئلة ضعف أو أسئلة فعالة لمستوى ${level}.`;
    return `لا توجد أسئلة فعالة لمستوى ${level}.`;
}

function elapsedMs(startedAt: string): number {
    const started = new Date(startedAt.replace(' ', 'T') + 'Z').getTime();
    return Math.max(0, Date.now() - started);
}
