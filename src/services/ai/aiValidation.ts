export interface AiExampleSuggestion {
    example_de?: string;
    example_ar?: string;
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
    if (!result.pronunciation_ar?.trim()) return false;
    if (!VALID_LEVELS.has(result.level?.trim().toUpperCase() ?? '')) return false;
    if (!exampleContainsGerman(input.german, result.example_de)) return false;
    if (hasSuspiciousPronunciation(input.german, result.pronunciation_ar)) return false;
    return true;
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
