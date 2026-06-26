export interface WordImageFingerprintInput {
    german: string | null | undefined;
    arabic: string | null | undefined;
    partOfSpeech?: string | null;
    article?: string | null;
    acceptedGermanAnswers?: string[] | null;
    acceptedArabicAnswers?: string[] | null;
}

export function buildWordImageFingerprint(input: WordImageFingerprintInput): string | null {
    const german = normalizeGermanPrimary(input.german ?? '');
    const arabic = normalizeArabicPrimary(input.arabic ?? '');
    if (!german || !arabic) return null;

    const parsedArticle = normalizeGermanArticle(input.article);
    const germanAnswers = canonicalList(input.acceptedGermanAnswers ?? [], normalizeGermanPrimary);
    const arabicAnswers = canonicalList(input.acceptedArabicAnswers ?? [], normalizeArabicPrimary);
    const partOfSpeech = normalizeToken(input.partOfSpeech ?? '');

    return [
        'v1',
        `g=${german}`,
        `a=${arabic}`,
        `art=${parsedArticle ?? ''}`,
        `pos=${partOfSpeech}`,
        `ga=${germanAnswers.join(',')}`,
        `aa=${arabicAnswers.join(',')}`,
    ].join('|');
}

export function normalizeGermanPrimary(value: string): string {
    return value
        .replace(/^\uFEFF/, '')
        .trim()
        .replace(/[!?.,;:()[\]{}"“”„]/g, ' ')
        .replace(/\s+/g, ' ')
        .toLocaleLowerCase('de-DE')
        .replace(/ä/g, 'ae')
        .replace(/ö/g, 'oe')
        .replace(/ü/g, 'ue')
        .replace(/ß/g, 'ss')
        .replace(/^(der|die|das)\s+/i, '')
        .trim();
}

export function normalizeArabicPrimary(value: string): string {
    return value
        .replace(/^\uFEFF/, '')
        .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
        .replace(/[!?.,;:()[\]{}"“”„،؟]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^ال(?=\S)/, '')
        .trim();
}

function canonicalList(values: string[], normalizer: (value: string) => string): string[] {
    return Array.from(new Set(values.map(normalizer).filter(Boolean))).sort();
}

function normalizeToken(value: string): string {
    return value.trim().replace(/\s+/g, '_').toLocaleLowerCase('en-US').slice(0, 40);
}

function normalizeGermanArticle(value: string | null | undefined): string | null {
    const article = value?.trim().toLocaleLowerCase('de-DE');
    return article === 'der' || article === 'die' || article === 'das' ? article : null;
}
