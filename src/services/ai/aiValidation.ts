export interface AiExampleSuggestion {
    example_de?: string;
    example_ar?: string;
    pronunciation_latin?: string;
    pronunciation_ar?: string;
    level?: string;
}

export interface AiSuggestionValidationInput {
    german: string;
    result: AiExampleSuggestion;
}

const VALID_LEVELS = new Set(['A1', 'A2', 'B1', 'UNKNOWN']);

export function validateExampleSuggestion(input: AiSuggestionValidationInput): boolean {
    const result = input.result;
    if (!result.example_de?.trim()) return false;
    if (!result.example_ar?.trim()) return false;
    if (!result.pronunciation_latin?.trim()) return false;
    if (!result.pronunciation_ar?.trim()) return false;
    if (!VALID_LEVELS.has(result.level?.trim().toUpperCase() ?? '')) return false;
    if (!exampleContainsGerman(input.german, result.example_de)) return false;
    if (!pronunciationLatinMatchesGerman(input.german, result.pronunciation_latin)) return false;
    if (hasSuspiciousPronunciation(input.german, result.pronunciation_ar)) return false;
    if (pronunciationArabicMismatchesLatin(result.pronunciation_latin, result.pronunciation_ar)) return false;
    return true;
}

export function validateAiExplanation(
    input: { german: string; correctAnswer: string },
    result: { short_explanation?: string; correct_answer?: string; extra_example_de?: string; extra_example_ar?: string }
): boolean {
    if (!result.short_explanation?.trim()) return false;
    if (!result.correct_answer?.trim()) return false;
    if (!result.extra_example_de?.trim()) return false;
    if (!result.extra_example_ar?.trim()) return false;
    if (/\bStille\s+Nacht\b/i.test(result.extra_example_de) && !/\bStille\s+Nacht\b/i.test(input.german)) return false;
    return exampleContainsGerman(input.german, result.extra_example_de) ||
        exampleContainsGerman(input.correctAnswer, result.extra_example_de);
}

export function exampleContainsGerman(german: string, exampleDe: string): boolean {
    const normalizedGerman = normalizeGermanText(german);
    const normalizedExample = normalizeGermanText(exampleDe);
    if (!normalizedGerman || !normalizedExample) return false;
    if (normalizedExample.includes(normalizedGerman)) return true;

    const tokens = germanTokens(normalizedGerman);
    if (tokens.length === 0) return false;
    const exampleTokens = new Set(germanTokens(normalizedExample));
    const matched = tokens.filter(token => exampleTokens.has(token)).length;
    if (tokens.length === 1) return matched === 1;
    return matched >= Math.max(2, Math.ceil(tokens.length * 0.6));
}

export function hasSuspiciousPronunciation(german: string, pronunciationAr: string): boolean {
    const normalizedGerman = normalizeGermanText(german);
    const normalizedPron = pronunciationAr.trim().toLocaleLowerCase('ar');
    const suspiciousPairs = [
        { german: 'ich', arabic: ['إخ', 'اخ', 'إيش', 'ايش'] },
        { german: 'bin', arabic: ['بن', 'بين'] },
        { german: 'froh', arabic: ['فروه', 'فرو'] },
    ];

    for (const pair of suspiciousPairs) {
        if (normalizedGerman.includes(pair.german)) continue;
        if (pair.arabic.some(fragment => normalizedPron.includes(fragment.toLocaleLowerCase('ar')))) {
            return true;
        }
    }
    return false;
}

export function pronunciationLatinMatchesGerman(german: string, pronunciationLatin: string): boolean {
    const germanKey = normalizeGermanText(german).replace(/\s+/g, '');
    const latinKey = normalizeGermanText(pronunciationLatin)
        .replace(/sh/g, 'sch')
        .replace(/kh/g, 'ch')
        .replace(/oy/g, 'eu')
        .replace(/ow/g, 'au')
        .replace(/\s+/g, '');
    if (!germanKey || !latinKey) return false;
    const tokens = germanTokens(normalizeGermanText(german));
    if (tokens.length <= 1) return latinKey.length >= Math.min(2, germanKey.length);
    const latinTokens = new Set(germanTokens(normalizeGermanText(pronunciationLatin)));
    const matched = tokens.filter(token => latinTokens.has(token) || latinKey.includes(token.slice(0, 3))).length;
    return matched >= Math.max(1, Math.floor(tokens.length * 0.5)) || latinKey.length >= Math.min(4, germanKey.length);
}

export function pronunciationArabicMismatchesLatin(pronunciationLatin: string, pronunciationAr: string): boolean {
    const latin = pronunciationLatin.toLowerCase();
    const arabic = pronunciationAr;
    if (latin.includes('sh') && !arabic.includes('ش')) return true;
    if ((latin.includes('goot') || latin.includes('gut') || latin.includes('g')) && !/[گكج]/.test(arabic)) return true;
    if (latin.includes('hows') && !arabic.includes('هاوس')) return true;
    if (/\bikh\b/.test(latin) && !/[إا]ِ?خ|اخ/.test(arabic)) return true;
    return false;
}

export function normalizeGermanText(value: string): string {
    return value
        .toLocaleLowerCase('de-DE')
        .replace(/ß/g, 'ss')
        .normalize('NFC')
        .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
        .trim()
        .replace(/\s+/g, ' ');
}

function germanTokens(value: string): string[] {
    return value.split(/\s+/).filter(Boolean);
}
