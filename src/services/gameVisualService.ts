import type { D1Database } from '@cloudflare/workers-types';
import type { Word } from '../models';
import { queryOne, run } from '../db/queries';
import { getPictogramByWordId } from '../repositories/pictogramRepository';

export type GameVisualType = 'emoji' | 'emoji_combo' | 'image_url' | 'fallback' | 'manual';

export interface GameVisual {
    type: GameVisualType;
    value: string;
    source: string;
    confidence: number;
}

interface VisualCacheRow {
    word_id: number;
    visual_type: GameVisualType;
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
    arabisch: '🌙🗣️',
    apfel: '🍎',
    banane: '🍌',
    milch: '🥛',
    kaffee: '☕',
    tee: '🍵',
    essenzeit: '🍽️',
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
    krankenhaus: '🏥',
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
    vogel: '🐦',
    fisch: '🐟',
    meer: '🌊',
    berg: '⛰️',
    straße: '🛣️',
    strasse: '🛣️',
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
    [/أكل|طعام|يأكل/, '🍽️'],
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
    [/امرأة|نساء/, '👩'],
    [/طفل|ولد|بنت/, '🧒'],
    [/مدينة/, '🏙️'],
    [/بلد|دولة/, '🌍'],
    [/لغة|كلام/, '🗣️'],
    [/ألماني|المانية|الألمانية/, '🇩🇪'],
    [/عربي|العربية/, '🌙🗣️'],
];

export async function getVisualForWord(db: D1Database, word: Word): Promise<GameVisual> {
    const cached = await getCachedVisual(db, word.word_id);
    if (cached?.source === 'manual') {
        return rowToVisual(cached);
    }

    const pictogram = await getPictogramByWordId(db, word.word_id);
    if (pictogram?.thumbnail_url || pictogram?.image_url) {
        return {
            type: 'image_url',
            value: pictogram.thumbnail_url || pictogram.image_url,
            source: 'word_pictograms',
            confidence: 0.95,
        };
    }

    if (cached) return rowToVisual(cached);

    const resolved = resolveEmojiVisual(word.german, word.arabic);
    await upsertAutoVisual(db, word.word_id, resolved);
    return resolved;
}

export async function getRequiredVisualForWord(db: D1Database, word: Word): Promise<GameVisual | null> {
    const visual = await getVisualForWord(db, word);
    return isClearGameVisual(visual) ? visual : null;
}

export function isClearGameVisual(visual: GameVisual | null | undefined): visual is GameVisual {
    return Boolean(visual && visual.type !== 'fallback' && visual.source !== 'fallback_letter' && visual.value.trim());
}

export function resolveEmojiVisual(german: string, arabic: string): GameVisual {
    const keys = normalizeGermanKeys(german);
    for (const key of keys) {
        const emoji = GERMAN_EMOJI_MAP[key];
        if (emoji) {
            return { type: emoji.length > 3 ? 'emoji_combo' : 'emoji', value: emoji, source: 'emoji_mapping', confidence: 0.85 };
        }
    }

    for (const [pattern, emoji] of ARABIC_EMOJI_KEYWORDS) {
        if (pattern.test(arabic)) {
            return { type: emoji.length > 3 ? 'emoji_combo' : 'emoji', value: emoji, source: 'emoji_mapping_ar', confidence: 0.75 };
        }
    }

    const combo = resolveEmojiCombo(german, arabic);
    if (combo) return { type: 'emoji_combo', value: combo, source: 'emoji_combo', confidence: 0.55 };

    const first = german.trim().replace(/^(der|die|das)\s+/i, '').charAt(0).toUpperCase() || '؟';
    return { type: 'fallback', value: `🔤 ${first}`, source: 'fallback_letter', confidence: 0.2 };
}

export async function resolveOnlineEmojiProvider(_german: string, _arabic: string): Promise<GameVisual | null> {
    // Provider layer placeholder for no-key sources such as EmojiHub/OpenMoji/CLDR.
    // It is intentionally not called during active gameplay; visuals are resolved before session creation and cached.
    return null;
}

export function validateManualVisual(input: string): GameVisual | null {
    const value = input.trim();
    if (!value || value.length > 300) return null;

    if (/^https:\/\//i.test(value)) {
        try {
            const url = new URL(value);
            if (url.protocol !== 'https:' || value.length > 300) return null;
            return { type: 'image_url', value, source: 'manual', confidence: 1 };
        } catch {
            return null;
        }
    }

    if (/^(?:javascript|data|http):/i.test(value)) return null;
    if (/[\p{L}\p{N}]/u.test(value)) return null;
    if (Array.from(value.replace(/\s+/g, '')).length > 8) return null;

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

function rowToVisual(row: VisualCacheRow): GameVisual {
    return {
        type: row.visual_type,
        value: row.visual_value,
        source: row.source,
        confidence: row.confidence,
    };
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
    if (/gut|جيد|تمام|حالة/.test(text)) return '✅✨';
    if (/krank|مرض|مريض/.test(text)) return '🤒🏥';
    if (/schnell|سريع/.test(text)) return '⚡🏃';
    if (/langsam|بطيء/.test(text)) return '🐢⏳';
    if (/groß|gross|كبير/.test(text)) return '📏⬆️';
    if (/klein|صغير/.test(text)) return '📏⬇️';
    if (/kalt|بارد/.test(text)) return '❄️🥶';
    if (/warm|heiß|heiss|حار|دافئ/.test(text)) return '🔥☀️';
    return null;
}
