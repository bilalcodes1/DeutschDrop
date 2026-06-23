import type { Env } from '../../models';
import { detectSupportedImageMime } from './imageValidationService';
import { sha256Hex } from './imageDownloadService';

export interface TelegramPhotoDownload {
    bytes: Uint8Array;
    mimeType: string;
    size: number;
    sha256: string;
}

export interface TelegramPhotoCandidate {
    file_id: string;
    file_size?: number;
    width?: number;
    height?: number;
}

export interface ImageUploadErrorDetails {
    mimeType?: string | null;
    byteCount?: number | null;
}

export async function downloadTelegramPhoto(env: Env, fileId: string): Promise<TelegramPhotoDownload> {
    const info = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`);
    if (!info.ok) throw imageUploadError('WORD_IMAGE_UPLOAD_GET_FILE_FAILED');
    const payload = await info.json<{ ok?: boolean; result?: { file_path?: string; file_size?: number } }>();
    const filePath = payload.result?.file_path;
    if (!payload.ok || !filePath) throw imageUploadError('WORD_IMAGE_UPLOAD_GET_FILE_FAILED');
    const maxBytes = getTelegramImageMaxBytes(env);
    if ((payload.result?.file_size ?? 0) > maxBytes) throw imageUploadError('WORD_IMAGE_UPLOAD_TOO_LARGE', { byteCount: payload.result?.file_size ?? null });
    const response = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`);
    if (!response.ok) throw imageUploadError('WORD_IMAGE_UPLOAD_DOWNLOAD_FAILED');
    const bytes = await readResponseBytesWithLimit(response, maxBytes);
    const headerMime = response.headers.get('content-type');
    let mimeType: string;
    try {
        mimeType = detectSupportedImageMime(bytes, headerMime, filePath);
    } catch (error) {
        throw imageUploadError(error instanceof Error ? error.message : 'unsupported_image_signature', {
            mimeType: headerMime,
            byteCount: bytes.byteLength,
        });
    }
    return { bytes, mimeType, size: bytes.byteLength, sha256: await sha256Hex(bytes) };
}

export function getTelegramImageMaxBytes(env: Pick<Env, 'IMAGE_MAX_DOWNLOAD_BYTES'>): number {
    return Math.max(50_000, Math.min(5_000_000, Number(env.IMAGE_MAX_DOWNLOAD_BYTES || 1_500_000)));
}

export function selectBestTelegramPhotoSize(photos: TelegramPhotoCandidate[], maxBytes: number): TelegramPhotoCandidate | null {
    if (photos.length === 0) return null;
    const knownUnderLimit = photos
        .filter(photo => typeof photo.file_size === 'number' && photo.file_size > 0 && photo.file_size <= maxBytes)
        .sort(compareTelegramPhotoQuality);
    if (knownUnderLimit.length > 0) return knownUnderLimit[knownUnderLimit.length - 1];

    const unknownSize = photos
        .filter(photo => typeof photo.file_size !== 'number' || photo.file_size <= 0)
        .sort(compareTelegramPhotoQuality);
    if (unknownSize.length > 0) return unknownSize[unknownSize.length - 1];
    return null;
}

function compareTelegramPhotoQuality(a: TelegramPhotoCandidate, b: TelegramPhotoCandidate): number {
    const aSize = a.file_size ?? 0;
    const bSize = b.file_size ?? 0;
    if (aSize !== bSize) return aSize - bSize;
    return ((a.width ?? 0) * (a.height ?? 0)) - ((b.width ?? 0) * (b.height ?? 0));
}

async function readResponseBytesWithLimit(response: Response, maxBytes: number): Promise<Uint8Array> {
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > maxBytes) throw imageUploadError('WORD_IMAGE_UPLOAD_TOO_LARGE', { byteCount: contentLength });

    if (!response.body) {
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength === 0) throw imageUploadError('WORD_IMAGE_UPLOAD_UNSUPPORTED_SIGNATURE', { byteCount: 0 });
        if (buffer.byteLength > maxBytes) throw imageUploadError('WORD_IMAGE_UPLOAD_TOO_LARGE', { byteCount: buffer.byteLength });
        return new Uint8Array(buffer);
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > maxBytes) {
            await reader.cancel().catch(() => undefined);
            throw imageUploadError('WORD_IMAGE_UPLOAD_TOO_LARGE', { byteCount: total });
        }
        chunks.push(value);
    }
    if (total === 0) throw imageUploadError('WORD_IMAGE_UPLOAD_UNSUPPORTED_SIGNATURE', { byteCount: 0 });
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return bytes;
}

function imageUploadError(message: string, details: ImageUploadErrorDetails = {}): Error {
    const error = new Error(message) as Error & ImageUploadErrorDetails;
    error.mimeType = details.mimeType ?? null;
    error.byteCount = details.byteCount ?? null;
    return error;
}

export function imageUploadErrorDetails(error: unknown): ImageUploadErrorDetails {
    if (!error || typeof error !== 'object') return {};
    const details = error as Partial<ImageUploadErrorDetails>;
    return {
        mimeType: typeof details.mimeType === 'string' ? details.mimeType : details.mimeType ?? null,
        byteCount: typeof details.byteCount === 'number' ? details.byteCount : details.byteCount ?? null,
    };
}
