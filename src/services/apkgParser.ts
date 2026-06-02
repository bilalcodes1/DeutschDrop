import type { ParsedWordRow } from './csvParser';

const APKG_UNSUPPORTED_MESSAGE =
    'حالياً APKG يحتاج تحويل إلى CSV. استخدم: node scripts/apkg-to-csv.mjs input.apkg output.csv ثم ارفع CSV.';

export type ApkgParseResult =
    | { supported: true; words: ParsedWordRow[]; errors: number }
    | { supported: false; message: string; hasCollection: boolean };

export function parseApkgPackage(content: ArrayBuffer): ApkgParseResult {
    return {
        supported: false,
        message: APKG_UNSUPPORTED_MESSAGE,
        hasCollection: containsAnkiCollection(content),
    };
}

export function getApkgUnsupportedMessage(): string {
    return APKG_UNSUPPORTED_MESSAGE;
}

export function cleanApkgField(value: string): string {
    return String(value)
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/<[^>]*>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function containsAnkiCollection(content: ArrayBuffer): boolean {
    const bytes = new Uint8Array(content);
    if (!isZip(bytes)) return false;

    const text = new TextDecoder().decode(bytes);
    return text.includes('collection.anki2') || text.includes('collection.anki21');
}

function isZip(bytes: Uint8Array): boolean {
    return bytes.length >= 4 &&
        bytes[0] === 0x50 &&
        bytes[1] === 0x4b &&
        (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07) &&
        (bytes[3] === 0x04 || bytes[3] === 0x06 || bytes[3] === 0x08);
}
