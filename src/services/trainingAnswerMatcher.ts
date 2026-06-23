import {
    isAcceptedArabicAnswer as isAcceptedArabicAnswerInternal,
    normalizeArabicTrainingAnswer,
    parseAcceptedArabicAnswers,
} from './arabicAnswerMatcher';

export type AnswerLanguage = 'ar' | 'de';

export type WrittenAnswerMatchType =
    | 'exact'
    | 'normalized'
    | 'alternative'
    | 'safe_descriptor'
    | 'safe_typo'
    | 'incorrect';

export interface EvaluateWrittenAnswerInput {
    userAnswer: string;
    expectedAnswer: string;
    answerLanguage: AnswerLanguage;
    acceptedAnswers?: string[];
}

export interface WrittenAnswerEvaluation {
    accepted: boolean;
    matchType: WrittenAnswerMatchType;
    matchedAnswer: string | null;
    expectedAnswers: string[];
    normalizedUserAnswer: string;
}

const GENERIC_ARABIC_DESCRIPTOR = /^(مارك[هة]|نوع|اسم|فعل|كلم[هة])\s+/;
const ACCEPTED_ANSWER_SEPARATOR = /[|،,؛;\n]+/g;

export function evaluateWrittenAnswer(input: EvaluateWrittenAnswerInput): WrittenAnswerEvaluation {
    return input.answerLanguage === 'ar'
        ? evaluateArabicWrittenAnswer(input)
        : evaluateGermanWrittenAnswer(input);
}

export function parseAcceptedAnswers(expectedAnswer: string, answerLanguage: AnswerLanguage = 'ar'): string[] {
    if (answerLanguage === 'ar') return parseAcceptedArabicAnswers(expectedAnswer);
    return uniquePreserveOrder(
        expectedAnswer
            .split(ACCEPTED_ANSWER_SEPARATOR)
            .map(item => item.trim())
            .filter(Boolean),
        normalizeGermanAnswer
    );
}

export function isAcceptedArabicAnswer(userAnswer: string, expectedAnswer: string, acceptedAnswers?: string[]): boolean {
    return evaluateWrittenAnswer({ userAnswer, expectedAnswer, acceptedAnswers, answerLanguage: 'ar' }).accepted;
}

export function isAcceptedGermanAnswer(userAnswer: string, expectedAnswer: string, acceptedAnswers?: string[]): boolean {
    return evaluateWrittenAnswer({ userAnswer, expectedAnswer, acceptedAnswers, answerLanguage: 'de' }).accepted;
}

export function normalizeGermanAnswer(value: string): string {
    return String(value ?? '')
        .normalize('NFKC')
        .trim()
        .toLocaleLowerCase('de-DE')
        .replace(/[’‘`´]/g, "'")
        .replace(/ß/g, 'ss')
        .replace(/[.,!?;:،؛؟"'“”‘’]+$/g, '')
        .replace(/[^\p{Letter}\p{Number}'\s-]/gu, ' ')
        .replace(/[-_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function formatExpectedAnswers(expectedAnswer: string, answerLanguage: AnswerLanguage, acceptedAnswers?: string[]): string {
    const answers = resolveExpectedAnswers(expectedAnswer, answerLanguage, acceptedAnswers);
    return answers.length ? answers.join(' / ') : expectedAnswer.trim();
}

function evaluateArabicWrittenAnswer(input: EvaluateWrittenAnswerInput): WrittenAnswerEvaluation {
    const expectedAnswers = resolveExpectedAnswers(input.expectedAnswer, 'ar', input.acceptedAnswers);
    const normalizedUserAnswer = normalizeArabicTrainingAnswer(input.userAnswer);
    const base: WrittenAnswerEvaluation = {
        accepted: false,
        matchType: 'incorrect',
        matchedAnswer: null,
        expectedAnswers,
        normalizedUserAnswer,
    };
    if (!input.userAnswer.trim() || expectedAnswers.length === 0 || !normalizedUserAnswer) return base;

    const exact = expectedAnswers.find(answer => answer.trim() === input.userAnswer.trim());
    if (exact) return { ...base, accepted: true, matchType: expectedAnswers.indexOf(exact) > 0 ? 'alternative' : 'exact', matchedAnswer: exact };

    const normalized = expectedAnswers.find(answer => normalizeArabicTrainingAnswer(answer) === normalizedUserAnswer);
    if (normalized) return { ...base, accepted: true, matchType: expectedAnswers.indexOf(normalized) > 0 ? 'alternative' : 'normalized', matchedAnswer: normalized };

    const descriptor = expectedAnswers.find(answer => safeDescriptorMatch(normalizedUserAnswer, normalizeArabicTrainingAnswer(answer)));
    if (descriptor) return { ...base, accepted: true, matchType: 'safe_descriptor', matchedAnswer: descriptor };

    const accepted = isAcceptedArabicAnswerInternal(input.userAnswer, expectedAnswers.join('|'));
    if (!accepted) return base;

    return {
        ...base,
        accepted: true,
        matchType: expectedAnswers.length > 1 ? 'alternative' : 'safe_typo',
        matchedAnswer: findBestNormalizedMatch(normalizedUserAnswer, expectedAnswers, normalizeArabicTrainingAnswer) ?? expectedAnswers[0] ?? null,
    };
}

function evaluateGermanWrittenAnswer(input: EvaluateWrittenAnswerInput): WrittenAnswerEvaluation {
    const expectedAnswers = resolveExpectedAnswers(input.expectedAnswer, 'de', input.acceptedAnswers);
    const normalizedUserAnswer = normalizeGermanAnswer(input.userAnswer);
    const base: WrittenAnswerEvaluation = {
        accepted: false,
        matchType: 'incorrect',
        matchedAnswer: null,
        expectedAnswers,
        normalizedUserAnswer,
    };
    if (!input.userAnswer.trim() || expectedAnswers.length === 0 || !normalizedUserAnswer) return base;

    const exact = expectedAnswers.find(answer => answer.trim() === input.userAnswer.trim());
    if (exact) return { ...base, accepted: true, matchType: expectedAnswers.indexOf(exact) > 0 ? 'alternative' : 'exact', matchedAnswer: exact };

    const normalized = expectedAnswers.find(answer => normalizeGermanAnswer(answer) === normalizedUserAnswer);
    if (!normalized) return base;
    return {
        ...base,
        accepted: true,
        matchType: expectedAnswers.indexOf(normalized) > 0 ? 'alternative' : 'normalized',
        matchedAnswer: normalized,
    };
}

function resolveExpectedAnswers(expectedAnswer: string, answerLanguage: AnswerLanguage, acceptedAnswers?: string[]): string[] {
    const fromAccepted = acceptedAnswers?.map(item => item.trim()).filter(Boolean);
    const values = fromAccepted?.length ? fromAccepted : parseAcceptedAnswers(expectedAnswer, answerLanguage);
    return uniquePreserveOrder(values.length ? values : [expectedAnswer].filter(Boolean), answerLanguage === 'ar' ? normalizeArabicTrainingAnswer : normalizeGermanAnswer);
}

function safeDescriptorMatch(user: string, expected: string): boolean {
    if (!user || !expected) return false;
    if (stripSafeArabicDescriptor(expected) === user) return true;
    if (stripSafeArabicDescriptor(user) === expected) return true;
    return false;
}

function stripSafeArabicDescriptor(value: string): string {
    return value.replace(GENERIC_ARABIC_DESCRIPTOR, '').trim();
}

function findBestNormalizedMatch(
    normalizedUserAnswer: string,
    expectedAnswers: string[],
    normalize: (value: string) => string
): string | null {
    return expectedAnswers.find(answer => normalize(answer) === normalizedUserAnswer) ?? null;
}

function uniquePreserveOrder(values: string[], normalize: (value: string) => string): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
        const key = normalize(value);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        result.push(value);
    }
    return result;
}
