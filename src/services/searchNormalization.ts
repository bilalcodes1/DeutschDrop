export function normalizeGermanSearch(text: string | null | undefined): string {
    if (!text) return '';
    return text.trim().toLocaleLowerCase()
        .replace(/ß/g, 'ss')
        .replace(/ä/g, 'ae')
        .replace(/ö/g, 'oe')
        .replace(/ü/g, 'ue')
        .replace(/[.,!?;:'"()[\]{}،؛؟…/\\|<>@#$%^&*_+=~`-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function normalizeArabicSearch(text: string | null | undefined): string {
    if (!text) return '';
    return text.trim().toLocaleLowerCase()
        .replace(/[\u064B-\u065F\u0670]/g, '') // Remove diacritics
        .replace(/ـ/g, '') // Remove tatweel
        .replace(/[أإآ]/g, 'ا')
        .replace(/ى/g, 'ي')
        .replace(/ة/g, 'ه')
        .replace(/[.,!?;:'"()[\]{}،؛؟…/\\|<>@#$%^&*_+=~`-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

const CYRILLIC_TO_LATIN_MAP: Record<string, string> = {
    'у': 'y', 'о': 'o', 'а': 'a', 'е': 'e', 'с': 'c', 
    'р': 'p', 'х': 'x', 'к': 'k', 'м': 'm', 'т': 't'
};

export function normalizeUserSearchText(text: string | null | undefined): string {
    if (!text) return '';
    
    let clean = text.trim().toLocaleLowerCase();
    
    // Convert common Cyrillic homoglyphs to Latin
    let normalizedChars = '';
    for (let char of clean) {
        normalizedChars += CYRILLIC_TO_LATIN_MAP[char] || char;
    }
    clean = normalizedChars;

    clean = clean
        .replace(/[\u064B-\u065F\u0670]/g, '') // Diacritics
        .replace(/ـ/g, '') // Tatweel
        .replace(/[أإآ]/g, 'ا')
        .replace(/ى/g, 'ي')
        .replace(/ة/g, 'ه')
        // Strip out nasty control chars, allow emoji but maybe strip weird FTS symbols
        .replace(/[*/()\[\]{}'"\\;<>~^]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    return clean;
}

export function expandGermanQuery(term: string): string[] {
    const norm = normalizeGermanSearch(term);
    if (!norm) return [];
    
    const expansions = new Set<string>();
    expansions.add(norm);

    if (norm.includes('a') && !norm.includes('ae')) expansions.add(norm.replace(/a/g, 'ae'));
    if (norm.includes('o') && !norm.includes('oe')) expansions.add(norm.replace(/o/g, 'oe'));
    if (norm.includes('u') && !norm.includes('ue')) expansions.add(norm.replace(/u/g, 'ue'));
    
    if (norm.includes('ss')) expansions.add(norm.replace(/ss/g, 's'));
    
    return Array.from(expansions);
}

export function expandArabicQuery(term: string): string[] {
    const norm = normalizeArabicSearch(term);
    if (!norm) return [];
    
    const expansions = new Set<string>();
    expansions.add(norm);

    if (norm.startsWith('ال') && norm.length > 3) {
        expansions.add(norm.substring(2)); // strip "ال"
    }

    return Array.from(expansions);
}

export function buildFtsQuery(term: string): string {
    if (!term || term.length > 80) return '';
    
    // Safety: only allow basic words, no SQL/FTS syntax injection
    // FTS syntax like *, OR, AND, NEAR should not be directly injected by user.
    // The query expansion does this safely because it uses controlled normalized terms.

    // Let's tokenize by space, expand each token, and combine with AND
    const rawTokens = term.split(/\s+/).filter(t => t.length > 0);
    if (rawTokens.length === 0) return '';

    const tokenQueries = rawTokens.map(token => {
        const germanExpansions = expandGermanQuery(token);
        const arabicExpansions = expandArabicQuery(token);

        const parts: string[] = [];
        if (germanExpansions.length > 0) {
            parts.push(`german_search : (${germanExpansions.map(t => '"' + t + '"*').join(' OR ')})`);
        }
        if (arabicExpansions.length > 0) {
            parts.push(`arabic_search : (${arabicExpansions.map(t => '"' + t + '"*').join(' OR ')})`);
        }

        if (parts.length === 0) return '';
        return `(${parts.join(' OR ')})`;
    }).filter(q => q !== '');

    if (tokenQueries.length === 0) return '';
    
    // Each token must be matched somewhere (AND logic)
    return tokenQueries.join(' AND ');
}
