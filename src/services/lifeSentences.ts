import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '../models';
import { parseJsonResult, runAiTask } from './ai/aiRouter';
import { calculateNextReview } from './srs';
import {
    completeLifeGate,
    createLifeSentence,
    ensureLifeSettings,
    getCompletedLifeGateDates,
    getLifeGate,
    type CreateLifeSentenceInput,
    type LifeKeyword,
    type LifeLevel,
    type LifeSentence,
} from '../repositories/lifeSentenceRepository';
import { addXp } from './xpLevels';

export interface LifeSentenceDraft {
    original_arabic: string;
    german: string;
    arabic: string;
    pronunciation_ar?: string | null;
    memory_hint?: string | null;
    keywords: Array<{ german: string; arabic: string }>;
    level: LifeLevel;
    tense?: string | null;
}

export interface LifeGateStatus {
    enabled: boolean;
    completed: boolean;
    gateDate: string;
    timezone: string;
}

export function getLifeGateDate(now: Date = new Date(), timezone = 'Asia/Baghdad'): string {
    try {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: timezone || 'UTC',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).formatToParts(now);
        const year = parts.find(part => part.type === 'year')?.value;
        const month = parts.find(part => part.type === 'month')?.value;
        const day = parts.find(part => part.type === 'day')?.value;
        if (year && month && day) return `${year}-${month}-${day}`;
    } catch {
        // Fall through to UTC date.
    }
    return now.toISOString().slice(0, 10);
}

export async function getLifeGateStatus(db: D1Database, userId: number, now: Date = new Date()): Promise<LifeGateStatus> {
    const settings = await ensureLifeSettings(db, userId);
    const timezone = settings.timezone || 'Asia/Baghdad';
    const gateDate = getLifeGateDate(now, timezone);
    const gate = await getLifeGate(db, userId, gateDate);
    return {
        enabled: settings.gate_enabled === 1,
        completed: Boolean(gate?.completed_at),
        gateDate,
        timezone,
    };
}

export async function isLifeGateOpen(db: D1Database, userId: number, now: Date = new Date()): Promise<boolean> {
    const status = await getLifeGateStatus(db, userId, now);
    return !status.enabled || status.completed;
}

export function validateLifeOriginalInput(text: string): { ok: true; value: string } | { ok: false; message: string } {
    const value = text.replace(/\s+/g, ' ').trim();
    if (!value) return { ok: false, message: 'اكتب موقفاً قصيراً، لا ترسل رسالة فارغة.' };
    if (value.length > 500) return { ok: false, message: 'الموقف طويل جداً. اختصره إلى أقل من 500 حرف.' };
    if (!/[\p{Letter}\p{Number}]/u.test(value)) return { ok: false, message: 'اكتب جملة حقيقية، وليس رموزاً أو إيموجي فقط.' };
    return { ok: true, value };
}

export function validateLifeDraft(raw: unknown, originalArabic: string): LifeSentenceDraft | null {
    if (!raw || typeof raw !== 'object') return null;
    const value = raw as Record<string, unknown>;
    const german = cleanText(value.german);
    const arabic = cleanText(value.arabic);
    if (!german || !arabic) return null;
    const level = normalizeLifeLevel(cleanText(value.level)) ?? 'A1';
    const pronunciation = cleanOptionalText(value.pronunciation_ar);
    const memory = cleanOptionalText(value.memory_hint);
    const tense = cleanOptionalText(value.tense);
    const keywords = normalizeLifeKeywords(value.keywords);
    return {
        original_arabic: originalArabic,
        german,
        arabic,
        pronunciation_ar: pronunciation,
        memory_hint: memory,
        keywords,
        level,
        tense,
    };
}

export async function generateLifeSentenceWithAi(
    env: Env,
    db: D1Database,
    userId: number,
    originalArabic: string,
    targetLevel: LifeLevel,
    regenerate = false
): Promise<{ ok: true; draft: LifeSentenceDraft } | { ok: false; status: string }> {
    const normalized = validateLifeOriginalInput(originalArabic);
    if (!normalized.ok) return { ok: false, status: normalized.message };

    for (let attempt = 0; attempt < 2; attempt++) {
        const ai = await runAiTask<unknown>(
            env,
            db,
            'generate_life_sentence',
            {
                original_arabic: normalized.value,
                target_level: targetLevel,
                retry: attempt > 0,
                regenerate,
            },
            {
                userId,
                bypassCache: regenerate || attempt > 0,
                validateResult: result => Boolean(validateLifeDraft(result, normalized.value)),
            }
        );
        if (ai.result) {
            const draft = validateLifeDraft(ai.result, normalized.value);
            if (draft) return { ok: true, draft };
        }
    }

    return { ok: false, status: 'تعذر توليد جملة مناسبة حالياً. جرّب إعادة المحاولة أو استخدم ChatGPT الخارجي.' };
}

export function parseExternalLifeResult(text: string, originalArabic = ''): LifeSentenceDraft | null {
    const german = extractNamedField(text, 'German');
    const arabic = extractNamedField(text, 'Arabic');
    if (!german || !arabic) return null;
    const pronunciation = extractNamedField(text, 'Pronunciation');
    const memory = extractNamedField(text, 'Memory');
    const level = normalizeLifeLevel(extractNamedField(text, 'Level')) ?? 'A1';
    return {
        original_arabic: originalArabic || arabic,
        german,
        arabic,
        pronunciation_ar: pronunciation,
        memory_hint: memory,
        keywords: parseExternalKeywords(extractNamedFieldRaw(text, 'Keywords') ?? ''),
        level,
        tense: null,
    };
}

export function parseLifeJsonText(text: string, originalArabic: string): LifeSentenceDraft | null {
    return validateLifeDraft(parseJsonResult(text), originalArabic);
}

export function parseExternalKeywords(value: string): Array<{ german: string; arabic: string }> {
    return value
        .split(/\n|,|\|/g)
        .map(part => part.replace(/^[-•\s]+/, '').trim())
        .map(part => {
            const [german, ...rest] = part.split(/\s*(?:=|—|-)\s*/);
            return { german: german?.trim() ?? '', arabic: rest.join(' ').trim() };
        })
        .filter(item => item.german && item.arabic)
        .slice(0, 5);
}

export async function saveLifeSentenceAndGate(
    db: D1Database,
    userId: number,
    gateDate: string,
    draft: LifeSentenceDraft,
    sourceType: CreateLifeSentenceInput['sourceType']
): Promise<{ sentenceId: number; gateCompletedNow: boolean; xpAwarded: number }> {
    const nextReview = new Date();
    nextReview.setDate(nextReview.getDate() + 1);
    const sentenceId = await createLifeSentence(db, {
        userId,
        sourceType,
        originalArabic: draft.original_arabic,
        germanText: draft.german,
        arabicText: draft.arabic,
        pronunciationAr: draft.pronunciation_ar ?? null,
        memoryHint: draft.memory_hint ?? null,
        level: draft.level,
        tense: draft.tense ?? null,
        nextReviewAt: nextReview.toISOString(),
        keywords: draft.keywords.map(keyword => ({ german_word: keyword.german, arabic_meaning: keyword.arabic })),
    });
    const gateCompletedNow = await completeLifeGate(db, userId, gateDate, sentenceId);
    let xpAwarded = 0;
    if (gateCompletedNow) {
        xpAwarded = 5;
        await addXp(db, userId, xpAwarded, {
            reason: 'life_sentence_daily',
            sourceType: 'life_sentence',
            sourceId: String(sentenceId),
            allowDailyCap: false,
            allowBoost: false,
            metadata: { gate_date: gateDate },
        });
    }
    return { sentenceId, gateCompletedNow, xpAwarded };
}

export function reviewLifeSentenceStats(sentence: LifeSentence, isCorrect: boolean): {
    difficulty: 'easy' | 'medium' | 'hard';
    easeFactor: number;
    interval: number;
    repetitions: number;
    nextReviewAt: string;
} {
    const wrongCount = sentence.wrong_count + (isCorrect ? 0 : 1);
    const difficulty = !isCorrect || wrongCount >= 3 ? 'hard' : sentence.difficulty === 'easy' ? 'easy' : 'medium';
    const srs = calculateNextReview(
        {
            easeFactor: sentence.ease_factor ?? 2.5,
            interval: sentence.interval ?? 0,
            repetitions: sentence.repetitions ?? 0,
            correctCount: sentence.correct_count,
            wrongCount: sentence.wrong_count,
        },
        isCorrect,
        isCorrect ? 'medium' : 'hard'
    );
    return {
        difficulty,
        easeFactor: srs.easeFactor,
        interval: srs.interval,
        repetitions: srs.repetitions,
        nextReviewAt: srs.nextReview,
    };
}

export function chooseGapKeyword(sentence: LifeSentence, keywords: LifeKeyword[]): { prompt: string; answer: string } {
    const keyword = keywords.find(item => sentence.german_text.includes(item.german_word));
    const answer = keyword?.german_word || sentence.german_text.split(/\s+/).find(word => word.length > 3) || sentence.german_text.split(/\s+/)[0] || sentence.german_text;
    const escaped = answer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return {
        prompt: sentence.german_text.replace(new RegExp(escaped, 'i'), '____'),
        answer,
    };
}

export function shuffledSentenceWords(german: string): string[] {
    const words = german.split(/\s+/).map(word => word.trim()).filter(Boolean);
    if (words.length <= 1) return words;
    return words.map((word, index) => ({ word, sort: (index * 37 + 11) % words.length })).sort((a, b) => a.sort - b.sort).map(item => item.word);
}

export function calculateLifeStreak(dates: string[], today = getLifeGateDate()): { current: number; best: number; completedDays: number } {
    const unique = [...new Set(dates)].sort();
    const set = new Set(unique);
    let current = 0;
    const cursor = new Date(`${today}T00:00:00Z`);
    while (set.has(cursor.toISOString().slice(0, 10))) {
        current++;
        cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
    let best = 0;
    let run = 0;
    let previous: Date | null = null;
    for (const dateText of unique) {
        const date = new Date(`${dateText}T00:00:00Z`);
        if (previous && (date.getTime() - previous.getTime()) / 86_400_000 === 1) {
            run++;
        } else {
            run = 1;
        }
        best = Math.max(best, run);
        previous = date;
    }
    return { current, best, completedDays: unique.length };
}

export async function getLifeStreak(db: D1Database, userId: number, today?: string): Promise<{ current: number; best: number; completedDays: number }> {
    return calculateLifeStreak(await getCompletedLifeGateDates(db, userId), today);
}

function extractNamedField(text: string, label: string): string | null {
    return cleanOptionalText(extractNamedFieldRaw(text, label));
}

function extractNamedFieldRaw(text: string, label: string): string | null {
    const labels = ['German', 'Arabic', 'Pronunciation', 'Memory', 'Keywords', 'Level'];
    const current = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const others = labels.filter(item => item !== label).map(item => item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const regex = new RegExp(`(?:^|\\n)\\s*${current}\\s*:\\s*([\\s\\S]*?)(?=\\n\\s*(?:${others})\\s*:|$)`, 'i');
    return regex.exec(text)?.[1]?.trim() || null;
}

function cleanText(value: unknown): string {
    return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 500) : '';
}

function cleanOptionalText(value: unknown): string | null {
    const text = cleanText(value);
    return text || null;
}

function normalizeLifeLevel(value: string | null): LifeLevel | null {
    const normalized = value?.toUpperCase().trim();
    return normalized === 'A1' || normalized === 'A2' || normalized === 'B1' ? normalized : null;
}

function normalizeLifeKeywords(value: unknown): Array<{ german: string; arabic: string }> {
    if (!Array.isArray(value)) return [];
    return value
        .map(item => {
            if (!item || typeof item !== 'object') return null;
            const record = item as Record<string, unknown>;
            const german = cleanText(record.german);
            const arabic = cleanText(record.arabic);
            return german && arabic ? { german, arabic } : null;
        })
        .filter((item): item is { german: string; arabic: string } => Boolean(item))
        .slice(0, 5);
}
