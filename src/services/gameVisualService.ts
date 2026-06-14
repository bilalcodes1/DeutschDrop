import type { D1Database } from '@cloudflare/workers-types';
import type { Word } from '../models';
import { queryOne, run } from '../db/queries';

export type GameVisualType = 'emoji' | 'emoji_combo' | 'fallback' | 'manual';
type StoredGameVisualType = GameVisualType | 'image_url';

export interface GameVisual {
    type: GameVisualType;
    value: string;
    source: string;
    confidence: number;
}

interface VisualCacheRow {
    word_id: number;
    visual_type: StoredGameVisualType;
    visual_value: string;
    source: string;
    confidence: number;
    updated_at: string;
}

const GERMAN_EMOJI_MAP: Record<string, string> = {
    haus: '🏠',
    wasser: '💧',
    brot: '🍞',
    universität: '🏫📚',
    universitaet: '🏫📚',
    uni: '🏫📚',
    mund: '👄',
    haar: '💇',
    laufen: '🏃',
    gehen: '🚶',
    essen: '🍽️',
    trinken: '🥤',
    auto: '🚗',
    bus: '🚌',
    zug: '🚆',
    schule: '🏫',
    buch: '📘',
    stift: '✏️',
    tisch: '🪑',
    tür: '🚪',
    tuer: '🚪',
    fenster: '🪟',
    katze: '🐱',
    hund: '🐶',
    mann: '👨',
    frau: '👩',
    kind: '🧒',
    stadt: '🏙️',
    land: '🌍',
    sprache: '🗣️',
    deutsch: '🇩🇪',
    deutschland: '🇩🇪',
    arabisch: '🌙🗣️',
    ente: '🦆',
    tiger: '🐯',
    vogel: '🐦',
    fisch: '🐟',
    apfel: '🍎',
    banane: '🍌',
    kaffee: '☕',
    tee: '🍵',
    milch: '🥛',
    ei: '🥚',
    käse: '🧀',
    kaese: '🧀',
    arbeit: '💼',
    lernen: '📚',
    schreiben: '✍️',
    lesen: '📖',
    sprechen: '🗣️',
    hören: '👂',
    hoeren: '👂',
    sehen: '👀',
    schlafen: '😴',
    spielen: '🎮',
    musik: '🎵',
    film: '🎬',
    familie: '👨‍👩‍👧',
    freund: '🤝',
    freundin: '🤝',
    lehrer: '🧑‍🏫',
    lehrerin: '🧑‍🏫',
    arzt: '🧑‍⚕️',
    ärztin: '👩‍⚕️',
    aerztin: '👩‍⚕️',
    krankenhaus: '🏥',
    polizei: '👮',
    feuerwehr: '🚒',
    geld: '💶',
    zeit: '⏰',
    tag: '☀️',
    nacht: '🌙',
    sonne: '☀️',
    mond: '🌙',
    regen: '🌧️',
    schnee: '❄️',
    baum: '🌳',
    blume: '🌸',
    tier: '🐾',
    meer: '🌊',
    berg: '⛰️',
    straße: '🛣️',
    strasse: '🛣️',
    kaufen: '🛒',
    verkaufen: '🏷️',
    reisen: '✈️🧳',
    flugzeug: '✈️',
    fahrrad: '🚲',
    handy: '📱',
    computer: '💻',
    telefon: '☎️',
    brief: '✉️',
    frage: '❓',
    antwort: '💬',
    herz: '❤️',
    liebe: '❤️',
    kopf: '🧠',
    auge: '👁️',
    ohr: '👂',
    hand: '✋',
    fuß: '🦶',
    fuss: '🦶',
    zahn: '🦷',
    kleid: '👗',
    schuh: '👟',
    jacke: '🧥',
    ball: '⚽',
    türkei: '🇹🇷',
    tuerkei: '🇹🇷',
    irak: '🇮🇶',
};

const ARABIC_EMOJI_KEYWORDS: Array<[RegExp, string]> = [
    [/بيت|منزل|دار/, '🏠'],
    [/ماء|مياه/, '💧'],
    [/خبز/, '🍞'],
    [/جامعة/, '🏫📚'],
    [/فم/, '👄'],
    [/شعر/, '💇'],
    [/ركض|يجري|جري/, '🏃'],
    [/مشي|يمشي/, '🚶'],
    [/أكل|اكل|طعام|يأكل/, '🍽️'],
    [/شرب|يشرب/, '🥤'],
    [/سيارة/, '🚗'],
    [/باص|حافلة/, '🚌'],
    [/قطار/, '🚆'],
    [/مدرسة/, '🏫'],
    [/كتاب/, '📘'],
    [/قلم/, '✏️'],
    [/طاولة|منضدة/, '🪑'],
    [/باب/, '🚪'],
    [/نافذة|شباك/, '🪟'],
    [/قطة/, '🐱'],
    [/كلب/, '🐶'],
    [/رجل/, '👨'],
    [/امرأة|امراة|نساء/, '👩'],
    [/طفل|ولد|بنت/, '🧒'],
    [/مدينة/, '🏙️'],
    [/بلد|دولة/, '🌍'],
    [/لغة|كلام/, '🗣️'],
    [/ألماني|الماني|المانية|الألمانية/, '🇩🇪'],
    [/عربي|العربية/, '🌙🗣️'],
    [/بطة|بط/, '🦆'],
    [/نمر|ببر/, '🐯'],
    [/طائر|عصفور/, '🐦'],
    [/سمك|سمكة/, '🐟'],
    [/تفاح/, '🍎'],
    [/موز/, '🍌'],
    [/قهوة/, '☕'],
    [/شاي/, '🍵'],
    [/حليب|لبن/, '🥛'],
    [/بيض|بيضة/, '🥚'],
    [/جبن/, '🧀'],
    [/عمل|شغل|وظيفة/, '💼'],
    [/طبيب|دكتور/, '🧑‍⚕️'],
    [/مستشفى/, '🏥'],
    [/شرطة/, '👮'],
    [/إطفاء|اطفاء/, '🚒'],
    [/مال|نقود|فلوس/, '💶'],
    [/وقت|زمن/, '⏰'],
    [/يوم/, '☀️'],
    [/ليل/, '🌙'],
    [/شمس/, '☀️'],
    [/مطر/, '🌧️'],
    [/ثلج/, '❄️'],
    [/بارد/, '🥶'],
    [/حار|دافئ/, '🔥'],
    [/كبير/, '📏⬆️'],
    [/صغير/, '📏⬇️'],
    [/سريع/, '⚡'],
    [/بطيء|بطيئ/, '🐢'],
    [/شراء|يشتري|تسوق/, '🛒💶'],
    [/سفر|رحلة/, '✈️🧳'],
    [/قراءة|يقرأ/, '👀📖'],
    [/كتابة|يكتب/, '✍️📄'],
    [/تعلم|يدرس/, '🧠📘'],
];

export async function getVisualForWord(db: D1Database, word: Word): Promise<GameVisual> {
    const cached = await getCachedVisual(db, word.word_id);
    const cachedVisual = cached ? rowToVisual(cached) : null;
    if (cachedVisual && isClearGameVisual(cachedVisual)) return cachedVisual;

    const resolved = resolveEmojiVisual(word.german, word.arabic);
    await upsertAutoVisual(db, word.word_id, resolved);
    return resolved;
}

export async function getRequiredVisualForWord(db: D1Database, word: Word): Promise<GameVisual | null> {
    const visual = await getVisualForWord(db, word);
    return isClearGameVisual(visual) ? visual : null;
}

export function isClearGameVisual(visual: GameVisual | null | undefined): visual is GameVisual {
    return Boolean(
        visual
        && visual.type !== 'fallback'
        && visual.source !== 'fallback_letter'
        && visual.value.trim()
        && isEmojiOnly(visual.value)
    );
}

export function resolveEmojiVisual(german: string, arabic: string): GameVisual {
    const keys = normalizeGermanKeys(german);
    for (const key of keys) {
        const emoji = GERMAN_EMOJI_MAP[key];
        if (emoji) {
            return { type: emoji.length > 3 ? 'emoji_combo' : 'emoji', value: emoji, source: 'emoji_mapping', confidence: 0.9 };
        }
    }

    for (const [pattern, emoji] of ARABIC_EMOJI_KEYWORDS) {
        if (pattern.test(arabic)) {
            return { type: emoji.length > 3 ? 'emoji_combo' : 'emoji', value: emoji, source: 'emoji_mapping_ar', confidence: 0.8 };
        }
    }

    const combo = resolveEmojiCombo(german, arabic);
    if (combo) return { type: 'emoji_combo', value: combo, source: 'emoji_combo', confidence: 0.68 };

    const first = german.trim().replace(/^(der|die|das)\s+/i, '').charAt(0).toUpperCase() || '؟';
    return { type: 'fallback', value: `🔤 ${first}`, source: 'fallback_letter', confidence: 0.2 };
}

export async function resolveOnlineEmojiProvider(_german: string, _arabic: string): Promise<GameVisual | null> {
    // No-key provider layer reserved for EmojiHub, OpenMoji metadata, or Unicode CLDR annotations.
    // It must run only while resolving/caching a word visual before a session starts, never per active question.
    return null;
}

export function validateManualVisual(input: string): GameVisual | null {
    const value = input.trim();
    if (!value || value.length > 40) return null;
    if (/^(?:https?|javascript|data):/i.test(value)) return null;
    if (/[\p{L}\p{N}]/u.test(value)) return null;
    if (!isEmojiOnly(value)) return null;
    if (countEmojiUnits(value) > 3) return null;

    return { type: 'manual', value, source: 'manual', confidence: 1 };
}

export async function upsertManualVisual(db: D1Database, wordId: number, visual: GameVisual): Promise<void> {
    await run(
        db,
        `INSERT INTO word_visual_cache (word_id, visual_type, visual_value, source, confidence, updated_at)
         VALUES (?, ?, ?, 'manual', ?, datetime('now'))
         ON CONFLICT(word_id) DO UPDATE SET
            visual_type = excluded.visual_type,
            visual_value = excluded.visual_value,
            source = excluded.source,
            confidence = excluded.confidence,
            updated_at = datetime('now')`,
        [wordId, visual.type, visual.value, visual.confidence]
    );
}

async function getCachedVisual(db: D1Database, wordId: number): Promise<VisualCacheRow | null> {
    return queryOne<VisualCacheRow>(
        db,
        'SELECT * FROM word_visual_cache WHERE word_id = ?',
        [wordId]
    );
}

async function upsertAutoVisual(db: D1Database, wordId: number, visual: GameVisual): Promise<void> {
    await run(
        db,
        `INSERT INTO word_visual_cache (word_id, visual_type, visual_value, source, confidence, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(word_id) DO UPDATE SET
            visual_type = CASE WHEN word_visual_cache.source = 'manual' THEN word_visual_cache.visual_type ELSE excluded.visual_type END,
            visual_value = CASE WHEN word_visual_cache.source = 'manual' THEN word_visual_cache.visual_value ELSE excluded.visual_value END,
            source = CASE WHEN word_visual_cache.source = 'manual' THEN word_visual_cache.source ELSE excluded.source END,
            confidence = CASE WHEN word_visual_cache.source = 'manual' THEN word_visual_cache.confidence ELSE excluded.confidence END,
            updated_at = datetime('now')`,
        [wordId, visual.type, visual.value, visual.source, visual.confidence]
    );
}

function rowToVisual(row: VisualCacheRow): GameVisual | null {
    if (row.visual_type === 'image_url') return null;
    const visual: GameVisual = {
        type: row.visual_type,
        value: row.visual_value,
        source: row.source,
        confidence: row.confidence,
    };
    return isEmojiOnly(visual.value) ? visual : null;
}

function normalizeGermanKeys(value: string): string[] {
    const stripped = value
        .trim()
        .replace(/^(der|die|das)\s+/i, '')
        .replace(/[!?.,;:]/g, ' ')
        .replace(/\s+/g, ' ')
        .toLocaleLowerCase('de-DE');
    const ascii = stripped
        .replace(/ä/g, 'ae')
        .replace(/ö/g, 'oe')
        .replace(/ü/g, 'ue')
        .replace(/ß/g, 'ss');
    return [stripped, ascii, ...stripped.split(' '), ...ascii.split(' ')].filter(Boolean);
}

function resolveEmojiCombo(german: string, arabic: string): string | null {
    const text = `${german} ${arabic}`.toLocaleLowerCase('de-DE');
    if (/universität|universitaet|جامعة/.test(text)) return '🏫📚';
    if (/sprache|لغة|كلام/.test(text)) return '🗣️💬';
    if (/schreiben|كتابة|يكتب/.test(text)) return '✍️📄';
    if (/lesen|قراءة|يقرأ/.test(text)) return '👀📖';
    if (/lernen|تعلم|يدرس/.test(text)) return '🧠📘';
    if (/arbeiten|arbeit|عمل|شغل|وظيفة/.test(text)) return '💼⚙️';
    if (/reisen|سفر|رحلة/.test(text)) return '✈️🧳';
    if (/krank|مرض|مريض/.test(text)) return '🤒🏥';
    if (/kaufen|شراء|يشتري|تسوق/.test(text)) return '🛒💶';
    if (/gut|جيد|تمام|حالة/.test(text)) return '✅✨';
    if (/schnell|سريع/.test(text)) return '⚡🏃';
    if (/langsam|بطيء|بطيئ/.test(text)) return '🐢⏳';
    if (/groß|gross|كبير/.test(text)) return '📏⬆️';
    if (/klein|صغير/.test(text)) return '📏⬇️';
    if (/kalt|بارد/.test(text)) return '❄️🥶';
    if (/warm|heiß|heiss|حار|دافئ/.test(text)) return '🔥☀️';
    return null;
}

function isEmojiOnly(value: string): boolean {
    const compact = value.replace(/\s+/g, '');
    if (!compact) return false;
    if (/[\p{L}\p{N}]/u.test(compact)) return false;
    return /[\p{Extended_Pictographic}\p{Regional_Indicator}]/u.test(compact);
}

function countEmojiUnits(value: string): number {
    const compact = value.replace(/\s+/g, '');
    const flags = compact.match(/\p{Regional_Indicator}\p{Regional_Indicator}/gu) ?? [];
    const withoutFlags = compact.replace(/\p{Regional_Indicator}\p{Regional_Indicator}/gu, '');
    const pictographs = withoutFlags.match(/\p{Extended_Pictographic}/gu) ?? [];
    return flags.length + pictographs.length;
}
