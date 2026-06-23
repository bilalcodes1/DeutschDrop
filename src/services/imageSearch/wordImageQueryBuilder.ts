const GERMAN_TO_SEARCH: Record<string, string> = {
    auto: 'car vehicle',
    haus: 'house home',
    ente: 'duck animal',
    tiger: 'tiger animal',
    baum: 'tree',
    buch: 'book',
    friseur: 'barber haircut',
    krankenschwester: 'nurse hospital',
    arzt: 'doctor',
    apfel: 'apple fruit',
    wasser: 'water glass',
    brot: 'bread food',
    schule: 'school classroom',
    zug: 'train',
    fahrrad: 'bicycle',
    flugzeug: 'airplane',
};

const ARABIC_TO_SEARCH: Array<[RegExp, string]> = [
    [/سيارة/, 'car vehicle'],
    [/بيت|منزل|دار/, 'house home'],
    [/بطة|بط/, 'duck animal'],
    [/نمر|ببر/, 'tiger animal'],
    [/شجرة/, 'tree'],
    [/كتاب/, 'book'],
    [/حلاق|مصفف/, 'barber haircut'],
    [/طبيب|دكتور/, 'doctor'],
    [/ممرضة/, 'nurse hospital'],
    [/تفاح/, 'apple fruit'],
    [/ماء/, 'water glass'],
    [/خبز/, 'bread food'],
    [/مدرسة/, 'school classroom'],
    [/قطار/, 'train'],
    [/دراجة/, 'bicycle'],
    [/طائرة/, 'airplane'],
];

export function buildWordImageSearchQuery(german: string, arabic: string, override?: string): string {
    const manual = normalizeQuery(override ?? '');
    if (manual) return manual;

    const normalizedGerman = normalizeGerman(german);
    const noArticle = normalizedGerman.replace(/^(der|die|das)\s+/, '').trim();
    const direct = GERMAN_TO_SEARCH[noArticle] ?? GERMAN_TO_SEARCH[normalizedGerman];
    if (direct) return direct;

    for (const [pattern, query] of ARABIC_TO_SEARCH) {
        if (pattern.test(arabic)) return query;
    }

    return normalizeQuery(noArticle || normalizedGerman || arabic).slice(0, 80);
}

export function normalizeQuery(value: string): string {
    return value
        .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 100);
}

function normalizeGerman(value: string): string {
    return value
        .trim()
        .replace(/[!?.,;:]/g, ' ')
        .replace(/\s+/g, ' ')
        .toLocaleLowerCase('de-DE')
        .replace(/ä/g, 'ae')
        .replace(/ö/g, 'oe')
        .replace(/ü/g, 'ue')
        .replace(/ß/g, 'ss')
        .trim();
}
