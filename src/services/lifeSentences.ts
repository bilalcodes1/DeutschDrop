import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '../models';
import { parseJsonResult, runAiTask } from './ai/aiRouter';
import { calculateNextReview } from './srs';
import {
    completeLifeGate,
    createLifeSentence,
    ensureLifeSettings,
    getLifeShareCodeExists,
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
    understood_meaning_ar?: string | null;
    german: string;
    arabic: string;
    pronunciation_ar?: string | null;
    memory_hint?: string | null;
    keywords: Array<{ german: string; arabic: string }>;
    level: LifeLevel;
    tense?: string | null;
    confidence?: number | null;
}

export type GenerateLifeSentenceResult =
    | { ok: true; draft: LifeSentenceDraft }
    | { ok: false; status: string; clarificationQuestion?: string; originalArabic?: string };

interface LifeGenerationOk {
    status: 'ok';
    source_arabic: string;
    understood_meaning_ar: string;
    german: string;
    arabic: string;
    pronunciation_ar: string;
    memory_hint?: string | null;
    keywords: Array<{ german: string; arabic: string }>;
    level: LifeLevel;
    tense: string;
    confidence: number;
}

interface LifeGenerationClarify {
    status: 'clarify';
    source_arabic: string;
    clarification_question_ar: string;
}

type LifeGenerationResult = LifeGenerationOk | LifeGenerationClarify;

interface LifeVerificationPass {
    verdict: 'pass';
    issues: string[];
    preserves_actor: boolean;
    preserves_action: boolean;
    preserves_time: boolean;
    preserves_negation: boolean;
    preserves_place: boolean;
    invented_details: boolean;
}

interface LifeVerificationRepair {
    verdict: 'repair';
    issues: string[];
    repaired: Omit<LifeGenerationOk, 'status' | 'source_arabic' | 'understood_meaning_ar' | 'confidence'> & { confidence?: number };
}

interface LifeVerificationClarify {
    verdict: 'clarify';
    clarification_question_ar: string;
}

type LifeVerificationResult = LifeVerificationPass | LifeVerificationRepair | LifeVerificationClarify;

export interface LifeGateStatus {
    enabled: boolean;
    completed: boolean;
    gateDate: string;
    timezone: string;
}

export function validateLifeSearchQuery(text: string): { ok: true; query: string } | { ok: false; message: string } {
    const query = text.replace(/\s+/g, ' ').trim();
    if (query.length < 2) return { ok: false, message: 'اكتب حرفين على الأقل للبحث.' };
    if (query.length > 100) return { ok: false, message: 'عبارة البحث طويلة جداً. اختصرها إلى أقل من 100 حرف.' };
    if (!/[\p{Letter}\p{Number}]/u.test(query)) return { ok: false, message: 'اكتب كلمة عربية أو ألمانية للبحث.' };
    return { ok: true, query };
}

export function sanitizeLifeShareDisplayName(value: string): string | null {
    const name = value.replace(/\s+/g, ' ').trim();
    if (name.length < 2 || name.length > 30) return null;
    if (/https?:\/\//i.test(name) || /(?:t\.me|telegram\.me|instagram\.com|www\.)/i.test(name)) return null;
    if (!/[\p{Letter}\p{Number}]/u.test(name)) return null;
    return name.replace(/[<>]/g, '');
}

export function publicLifeAuthorName(value: string | null | undefined): string {
    return value?.trim() ? value.trim() : 'متعلم في DeutschDrop';
}

export async function generateUniqueLifeShareCode(db: D1Database): Promise<string> {
    for (let attempt = 0; attempt < 8; attempt++) {
        const code = randomShareCode();
        if (!await getLifeShareCodeExists(db, code)) return code;
    }
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
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
    if (value.status === 'ok') {
        const generated = validateLifeGenerationResult(value, originalArabic);
        return generated?.status === 'ok' ? lifeDraftFromGeneration(generated, originalArabic) : null;
    }
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
        understood_meaning_ar: cleanOptionalText(value.understood_meaning_ar),
        german,
        arabic,
        pronunciation_ar: pronunciation,
        memory_hint: memory,
        keywords,
        level,
        tense,
        confidence: typeof value.confidence === 'number' && Number.isFinite(value.confidence) ? value.confidence : null,
    };
}

export async function generateLifeSentenceWithAi(
    env: Env,
    db: D1Database,
    userId: number,
    originalArabic: string,
    targetLevel: LifeLevel,
    regenerate = false,
    clarificationAnswer?: string | null
): Promise<GenerateLifeSentenceResult> {
    const normalized = validateLifeOriginalInput(originalArabic);
    if (!normalized.ok) return { ok: false, status: normalized.message };

    let repairUsed = false;
    for (let attempt = 0; attempt < 2; attempt++) {
        const ai = await runAiTask<LifeGenerationResult>(
            env,
            db,
            'generate_life_sentence',
            {
                original_arabic: normalized.value,
                target_level: targetLevel,
                clarification_answer: clarificationAnswer?.trim() || null,
                retry: attempt > 0,
                regenerate,
            },
            {
                userId,
                bypassCache: regenerate || attempt > 0,
                validateResult: result => Boolean(validateLifeGenerationResult(result, normalized.value)),
            }
        );
        if (ai.result) {
            const generated = validateLifeGenerationResult(ai.result, normalized.value);
            if (generated?.status === 'clarify') {
                return {
                    ok: false,
                    status: 'clarify',
                    clarificationQuestion: generated.clarification_question_ar,
                    originalArabic: normalized.value,
                };
            }
            if (generated?.status === 'ok') {
                const verified = await verifyLifeCandidate(env, db, userId, normalized.value, targetLevel, generated, !repairUsed);
                if (verified.repairAttempted) repairUsed = true;
                if (verified.ok) return { ok: true, draft: verified.draft };
                if (verified.clarificationQuestion) {
                    return {
                        ok: false,
                        status: 'clarify',
                        clarificationQuestion: verified.clarificationQuestion,
                        originalArabic: normalized.value,
                    };
                }
            }
        }
    }

    return { ok: false, status: 'لم أستطع إنشاء جملة دقيقة من هذا الموقف.\n\nجرّب كتابته بصورة أوضح، أو استخدم خيار ChatGPT الخارجي.' };
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

export function validateLifeGenerationResult(raw: unknown, originalArabic: string): LifeGenerationResult | null {
    if (!raw || typeof raw !== 'object') return null;
    const value = raw as Record<string, unknown>;
    const status = cleanText(value.status);
    const sourceArabic = cleanText(value.source_arabic);
    if (!sourceArabicMatches(sourceArabic, originalArabic)) return null;
    if (status === 'clarify') {
        const question = cleanText(value.clarification_question_ar);
        return question ? { status: 'clarify', source_arabic: sourceArabic, clarification_question_ar: question } : null;
    }
    if (status !== 'ok') return null;
    const understood = cleanText(value.understood_meaning_ar);
    const german = cleanText(value.german);
    const arabic = cleanText(value.arabic);
    const pronunciation = cleanText(value.pronunciation_ar);
    const level = normalizeLifeLevel(cleanText(value.level));
    const confidence = typeof value.confidence === 'number' && Number.isFinite(value.confidence) ? value.confidence : NaN;
    const keywords = normalizeLifeKeywords(value.keywords);
    if (!understood || !german || !arabic || !pronunciation || !level || keywords.length === 0) return null;
    if (confidence < 0.55 || confidence > 1) return null;
    const wordCount = german.split(/\s+/).filter(Boolean).length;
    if (wordCount > 24) return null;
    return {
        status: 'ok',
        source_arabic: sourceArabic,
        understood_meaning_ar: understood,
        german,
        arabic,
        pronunciation_ar: pronunciation,
        memory_hint: cleanOptionalText(value.memory_hint),
        keywords,
        level,
        tense: cleanOptionalText(value.tense) ?? 'mixed',
        confidence,
    };
}

export function validateLifeVerificationResult(raw: unknown): LifeVerificationResult | null {
    if (!raw || typeof raw !== 'object') return null;
    const value = raw as Record<string, unknown>;
    const verdict = cleanText(value.verdict);
    if (verdict === 'clarify') {
        const question = cleanText(value.clarification_question_ar);
        return question ? { verdict: 'clarify', clarification_question_ar: question } : null;
    }
    const issues = Array.isArray(value.issues) ? value.issues.map(cleanText).filter(Boolean).slice(0, 5) : [];
    if (verdict === 'pass') {
        const pass: LifeVerificationPass = {
            verdict: 'pass',
            issues,
            preserves_actor: value.preserves_actor === true,
            preserves_action: value.preserves_action === true,
            preserves_time: value.preserves_time !== false,
            preserves_negation: value.preserves_negation !== false,
            preserves_place: value.preserves_place !== false,
            invented_details: value.invented_details === true,
        };
        return pass.preserves_actor && pass.preserves_action && !pass.invented_details ? pass : null;
    }
    if (verdict === 'repair') {
        const repaired = validateRepairedLifeDraft(value.repaired);
        return repaired ? { verdict: 'repair', issues, repaired } : null;
    }
    return null;
}

async function verifyLifeCandidate(
    env: Env,
    db: D1Database,
    userId: number,
    originalArabic: string,
    targetLevel: LifeLevel,
    generated: LifeGenerationOk,
    allowRepair: boolean
): Promise<{ ok: true; draft: LifeSentenceDraft; repairAttempted?: boolean } | { ok: false; clarificationQuestion?: string; repairAttempted?: boolean }> {
    const first = await runLifeVerification(env, db, userId, originalArabic, targetLevel, generated);
    if (first?.verdict === 'pass') return { ok: true, draft: lifeDraftFromGeneration(generated, originalArabic) };
    if (first?.verdict === 'clarify') return { ok: false, clarificationQuestion: first.clarification_question_ar };
    if (first?.verdict !== 'repair' || !allowRepair) return { ok: false };

    const repaired = generationFromRepair(first.repaired, generated, originalArabic);
    if (!repaired) return { ok: false, repairAttempted: true };
    const final = await runLifeVerification(env, db, userId, originalArabic, targetLevel, repaired);
    if (final?.verdict === 'pass') return { ok: true, draft: lifeDraftFromGeneration(repaired, originalArabic), repairAttempted: true };
    if (final?.verdict === 'clarify') return { ok: false, clarificationQuestion: final.clarification_question_ar, repairAttempted: true };
    return { ok: false, repairAttempted: true };
}

async function runLifeVerification(
    env: Env,
    db: D1Database,
    userId: number,
    originalArabic: string,
    targetLevel: LifeLevel,
    candidate: LifeGenerationOk
): Promise<LifeVerificationResult | null> {
    const verification = await runAiTask<LifeVerificationResult>(
        env,
        db,
        'validate_life_sentence',
        {
            original_arabic: originalArabic,
            understood_meaning_ar: candidate.understood_meaning_ar,
            german: candidate.german,
            back_translation_arabic: candidate.arabic,
            target_level: targetLevel,
        },
        {
            userId,
            bypassCache: true,
            countUsage: false,
            validateResult: result => Boolean(validateLifeVerificationResult(result)),
        }
    );
    return verification.result ? validateLifeVerificationResult(verification.result) : null;
}

function lifeDraftFromGeneration(value: LifeGenerationOk, originalArabic: string): LifeSentenceDraft {
    return {
        original_arabic: originalArabic,
        understood_meaning_ar: value.understood_meaning_ar,
        german: value.german,
        arabic: value.arabic,
        pronunciation_ar: value.pronunciation_ar,
        memory_hint: value.memory_hint ?? null,
        keywords: value.keywords,
        level: value.level,
        tense: value.tense,
        confidence: value.confidence,
    };
}

function generationFromRepair(
    repaired: LifeVerificationRepair['repaired'],
    original: LifeGenerationOk,
    originalArabic: string
): LifeGenerationOk | null {
    return validateLifeGenerationResult({
        status: 'ok',
        source_arabic: originalArabic,
        understood_meaning_ar: original.understood_meaning_ar,
        german: repaired.german,
        arabic: repaired.arabic,
        pronunciation_ar: repaired.pronunciation_ar,
        memory_hint: repaired.memory_hint,
        keywords: repaired.keywords,
        level: repaired.level,
        tense: repaired.tense,
        confidence: typeof repaired.confidence === 'number' ? repaired.confidence : Math.min(original.confidence, 0.85),
    }, originalArabic) as LifeGenerationOk | null;
}

function validateRepairedLifeDraft(raw: unknown): LifeVerificationRepair['repaired'] | null {
    if (!raw || typeof raw !== 'object') return null;
    const value = raw as Record<string, unknown>;
    const german = cleanText(value.german);
    const arabic = cleanText(value.arabic);
    const pronunciation = cleanText(value.pronunciation_ar);
    const level = normalizeLifeLevel(cleanText(value.level));
    const keywords = normalizeLifeKeywords(value.keywords);
    if (!german || !arabic || !pronunciation || !level || keywords.length === 0) return null;
    return {
        german,
        arabic,
        pronunciation_ar: pronunciation,
        memory_hint: cleanOptionalText(value.memory_hint),
        keywords,
        level,
        tense: cleanOptionalText(value.tense) ?? 'mixed',
        confidence: typeof value.confidence === 'number' && Number.isFinite(value.confidence) ? value.confidence : 0.8,
    };
}

function sourceArabicMatches(sourceArabic: string, originalArabic: string): boolean {
    return normalizeSourceArabic(sourceArabic) === normalizeSourceArabic(originalArabic);
}

function normalizeSourceArabic(value: string): string {
    return value
        .trim()
        .replace(/[\u064B-\u065F\u0670]/g, '')
        .replace(/\u0640/g, '')
        .replace(/\s+/g, ' ');
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

function randomShareCode(): string {
    const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return [...bytes].map(byte => alphabet[byte % alphabet.length]).join('');
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
    const keyword = keywords.find(item => sentence.german_text.toLocaleLowerCase('de-DE').includes(item.german_word.toLocaleLowerCase('de-DE')));
    const words = sentence.german_text
        .split(/\s+/)
        .map(word => word.replace(/^[^\p{Letter}\p{Number}]+|[^\p{Letter}\p{Number}]+$/gu, ''))
        .filter(Boolean);
    const weakWords = new Set(['der', 'die', 'das', 'ein', 'eine', 'und', 'oder', 'ich', 'du', 'er', 'sie', 'es', 'wir', 'ihr', 'zu', 'im', 'in', 'am']);
    const answer = keyword?.german_word
        || words.find(word => word.length > 3 && !weakWords.has(word.toLocaleLowerCase('de-DE')))
        || words.find(word => word.length > 2)
        || words[0]
        || sentence.german_text;
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
