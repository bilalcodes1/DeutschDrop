import type { Word } from '../models';

export interface WordSearchFields {
    german_search: string;
    arabic_search: string;
    example_search: string;
}

export interface RankedWord extends Word {
    search_score?: number;
}

export function normalizeGermanSearch(text: string | null | undefined): string {
    return normalizeBase(text)
        .replace(/ß/g, 'ss')
        .replace(/ä/g, 'ae')
        .replace(/ö/g, 'oe')
        .replace(/ü/g, 'ue');
}

export function normalizeArabicSearch(text: string | null | undefined): string {
    return normalizeBase(text)
        .replace(/[\u064B-\u065F\u0670]/g, '')
        .replace(/ـ/g, '')
        .replace(/[أإآ]/g, 'ا')
        .replace(/ى/g, 'ي')
        .replace(/ة/g, 'ه');
}

export function buildWordSearchFields(german: string, arabic: string, example: string | null): WordSearchFields {
    return {
        german_search: normalizeGermanSearch(german),
        arabic_search: normalizeArabicSearch(arabic),
        example_search: `${normalizeGermanSearch(example)} ${normalizeArabicSearch(example)}`.trim(),
    };
}

export function normalizeWordSearchQuery(query: string): { german: string; arabic: string; raw: string } {
    const raw = query.trim().replace(/\s+/g, ' ');
    return {
        raw,
        german: normalizeGermanSearch(raw),
        arabic: normalizeArabicSearch(raw),
    };
}

export function rankWordSearchResults(words: Word[], query: string): RankedWord[] {
    const normalized = normalizeWordSearchQuery(query);
    return words
        .map(word => ({ ...word, search_score: scoreWord(word, normalized) }))
        .filter(word => (word.search_score ?? 0) > 0)
        .sort((a, b) =>
            (b.search_score ?? 0) - (a.search_score ?? 0) ||
            new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime() ||
            b.word_id - a.word_id
        );
}

function scoreWord(word: Word, query: { german: string; arabic: string; raw: string }): number {
    const german = normalizeGermanSearch((word as Word & { german_search?: string }).german_search ?? word.german);
    const arabic = normalizeArabicSearch((word as Word & { arabic_search?: string }).arabic_search ?? word.arabic);
    const example = `${normalizeGermanSearch((word as Word & { example_search?: string }).example_search ?? word.example)} ${normalizeArabicSearch(word.example)}`.trim();
    const qGerman = query.german;
    const qArabic = query.arabic;
    let score = 0;

    score = Math.max(score, matchScore(german, qGerman, 100, 90, 80));
    score = Math.max(score, matchScore(arabic, qArabic, 75, 70, 60));
    if (qGerman && example.includes(qGerman)) score = Math.max(score, 40);
    if (qArabic && example.includes(qArabic)) score = Math.max(score, 40);
    if (query.raw.length >= 3 && hasFuzzyTokenMatch(german, qGerman)) score = Math.max(score, 30);
    if (query.raw.length >= 3 && hasFuzzyTokenMatch(arabic, qArabic)) score = Math.max(score, 30);
    return score;
}

function matchScore(value: string, query: string, exact: number, startsWith: number, contains: number): number {
    if (!value || !query) return 0;
    if (value === query) return exact;
    if (value.startsWith(query)) return startsWith;
    if (value.includes(query)) return contains;
    if (value.split(' ').some(token => token.startsWith(query) || token.includes(query))) return Math.max(contains - 5, 1);
    return 0;
}

function hasFuzzyTokenMatch(value: string, query: string): boolean {
    if (!value || !query || query.length < 3 || query.length > 24) return false;
    return value.split(' ').some(token =>
        token.length >= 3 &&
        Math.abs(token.length - query.length) <= 1 &&
        levenshteinDistanceAtMostOne(token, query)
    );
}

function levenshteinDistanceAtMostOne(a: string, b: string): boolean {
    if (a === b) return true;
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0;
    let j = 0;
    let edits = 0;
    while (i < a.length && j < b.length) {
        if (a[i] === b[j]) {
            i++;
            j++;
            continue;
        }
        edits++;
        if (edits > 1) return false;
        if (a.length > b.length) i++;
        else if (b.length > a.length) j++;
        else {
            i++;
            j++;
        }
    }
    if (i < a.length || j < b.length) edits++;
    return edits <= 1;
}

function normalizeBase(text: string | null | undefined): string {
    return (text ?? '')
        .trim()
        .toLocaleLowerCase()
        .replace(/[.,!?;:'"()[\]{}،؛؟…/\\|<>@#$%^&*_+=~`-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
