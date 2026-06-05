const YOUGLISH_DIRECT_BASE = 'https://youglish.com/pronounce';

export function buildYouglishDirectUrl(word: string, lang = 'german'): string {
    return `${YOUGLISH_DIRECT_BASE}/${encodeURIComponent(word)}/${encodeURIComponent(normalizeYouglishLang(lang))}`;
}

export function normalizeYouglishLang(lang: string | null | undefined): string {
    return lang === 'german' ? 'german' : 'german';
}
