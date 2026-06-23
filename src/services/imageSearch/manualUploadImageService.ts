import type { Env } from '../../models';
import { normalizeImageMime } from './imageValidationService';
import { sha256Hex } from './imageDownloadService';

export interface TelegramPhotoDownload {
    bytes: Uint8Array;
    mimeType: string;
    size: number;
    sha256: string;
}

export async function downloadTelegramPhoto(env: Env, fileId: string): Promise<TelegramPhotoDownload> {
    const info = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`);
    if (!info.ok) throw new Error('telegram_get_file_failed');
    const payload = await info.json<{ ok?: boolean; result?: { file_path?: string; file_size?: number } }>();
    const filePath = payload.result?.file_path;
    if (!payload.ok || !filePath) throw new Error('telegram_file_missing');
    const maxBytes = Math.max(50_000, Math.min(5_000_000, Number(env.IMAGE_MAX_DOWNLOAD_BYTES || 1_500_000)));
    if ((payload.result?.file_size ?? 0) > maxBytes) throw new Error('image_too_large');
    const response = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`);
    if (!response.ok) throw new Error('telegram_download_failed');
    const mimeType = normalizeImageMime(response.headers.get('content-type') || mimeFromTelegramPath(filePath));
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maxBytes) throw new Error('image_too_large');
    const bytes = new Uint8Array(buffer);
    return { bytes, mimeType, size: bytes.byteLength, sha256: await sha256Hex(bytes) };
}

function mimeFromTelegramPath(path: string): string {
    const lower = path.toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.webp')) return 'image/webp';
    return 'image/jpeg';
}
