const ARABIC_ANSWER_SEPARATOR = /[|/،,؛;\n]+/g;
const GENERIC_LEADING_WORDS = new Set(['ماركه', 'نوع', 'اسم', 'فعل', 'كلمه']);

export function parseAcceptedArabicAnswers(correctAnswer: string): string[] {
    return uniquePreserveOrder(
        correctAnswer
            .split(ARABIC_ANSWER_SEPARATOR)
            .map(item => item.trim())
            .filter(Boolean)
    );
}

export function formatAcceptedArabicAnswers(correctAnswer: string): string {
    const answers = parseAcceptedArabicAnswers(correctAnswer);
    return answers.length ? answers.join(' / ') : correctAnswer.trim();
}

export function isAcceptedArabicAnswer(userAnswer: string, correctAnswer: string): boolean {
    const correctAnswers = parseAcceptedArabicAnswers(correctAnswer);
    if (!userAnswer.trim() || correctAnswers.length === 0) return false;

    const normalizedUser = normalizeArabicTrainingAnswer(userAnswer);
    const normalizedCorrect = correctAnswers.map(normalizeArabicTrainingAnswer).filter(Boolean);
    if (!normalizedUser || normalizedCorrect.length === 0) return false;

    if (normalizedCorrect.some(correct => arabicEquivalent(normalizedUser, correct))) return true;
    if (acceptsCombinedSingleWordAlternatives(normalizedUser, normalizedCorrect)) return true;
    return acceptsOneSafeTypo(normalizedUser, normalizedCorrect);
}

export function normalizeArabicTrainingAnswer(value: string): string {
    return value
        .trim()
        .replace(/[\u064B-\u065F\u0670]/g, '')
        .replace(/\u0640/g, '')
        .replace(/[أإآٱ]/g, 'ا')
        .replace(/ى/g, 'ي')
        .replace(/ؤ/g, 'و')
        .replace(/ئ/g, 'ي')
        .replace(/ء/g, '')
        .replace(/و{2,}/g, 'و')
        .replace(/ي{2,}/g, 'ي')
        .replace(/[()[\]{}.,!?;:،؛؟"'“”‘’]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .map(token => token.replace(/[ةه]$/g, 'ه'))
        .join(' ');
}

function acceptsCombinedSingleWordAlternatives(user: string, correctAnswers: string[]): boolean {
    if (!correctAnswers.every(isSingleToken)) return false;
    const userTokens = user.split(/\s+/).filter(Boolean);
    if (userTokens.length <= 1) return false;
    const correctVariants = new Set(correctAnswers.flatMap(answer => equivalentArabicForms(answer)));
    return userTokens.every(token => correctVariants.has(token));
}

function acceptsOneSafeTypo(user: string, correctAnswers: string[]): boolean {
    for (const correct of correctAnswers) {
        const userTokens = user.split(/\s+/).filter(Boolean);
        const correctTokens = correct.split(/\s+/).filter(Boolean);
        if (userTokens.length !== correctTokens.length || userTokens.length === 0) continue;
        let typoCount = 0;
        let failed = false;
        for (let index = 0; index < correctTokens.length; index++) {
            const userToken = userTokens[index];
            const correctToken = correctTokens[index];
            if (arabicEquivalent(userToken, correctToken)) continue;
            if (Math.max(userToken.length, correctToken.length) >= 5 && Math.min(userToken.length, correctToken.length) >= 4 && editDistanceAtMostOne(userToken, correctToken)) {
                typoCount++;
                if (typoCount <= 1) continue;
            }
            failed = true;
            break;
        }
        if (!failed && typoCount === 1) return true;
    }
    return false;
}

function arabicEquivalent(left: string, right: string): boolean {
    const leftForms = equivalentArabicForms(left);
    const rightForms = new Set(equivalentArabicForms(right));
    return leftForms.some(form => rightForms.has(form));
}

function equivalentArabicForms(value: string): string[] {
    const normalized = normalizeArabicTrainingAnswer(value);
    const forms = new Set<string>([normalized]);
    const withoutGeneric = stripLeadingGenericWord(normalized);
    if (withoutGeneric !== normalized) forms.add(withoutGeneric);
    for (const form of [...forms]) {
        forms.add(stripDefiniteArticleFromFirstToken(form));
    }
    return [...forms].filter(Boolean);
}

function stripLeadingGenericWord(value: string): string {
    const tokens = value.split(/\s+/).filter(Boolean);
    if (tokens.length > 1 && GENERIC_LEADING_WORDS.has(tokens[0])) {
        return tokens.slice(1).join(' ');
    }
    return value;
}

function stripDefiniteArticleFromFirstToken(value: string): string {
    const tokens = value.split(/\s+/).filter(Boolean);
    if (!tokens.length) return value;
    const first = tokens[0];
    if (first.startsWith('ال') && first.length > 3) {
        tokens[0] = first.slice(2);
    }
    return tokens.join(' ');
}

function isSingleToken(value: string): boolean {
    return value.split(/\s+/).filter(Boolean).length === 1;
}

function editDistanceAtMostOne(left: string, right: string): boolean {
    if (left === right) return true;
    if (Math.abs(left.length - right.length) > 1) return false;
    let i = 0;
    let j = 0;
    let edits = 0;
    while (i < left.length && j < right.length) {
        if (left[i] === right[j]) {
            i++;
            j++;
            continue;
        }
        edits++;
        if (edits > 1) return false;
        if (left.length > right.length) i++;
        else if (right.length > left.length) j++;
        else {
            i++;
            j++;
        }
    }
    if (i < left.length || j < right.length) edits++;
    return edits <= 1;
}

function uniquePreserveOrder(values: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
        const key = normalizeArabicTrainingAnswer(value);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        result.push(value);
    }
    return result;
}
