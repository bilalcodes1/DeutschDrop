import type { Env } from '../../models';
import { assertSafeImageUrl, normalizeImageMime } from './imageValidationService';

export interface DownloadedImage {
    bytes: Uint8Array;
    mimeType: string;
    size: number;
    sha256: string;
}

export interface DownloadImageOptions {
    allowedHosts?: string[];
}

export async function downloadImageBytes(env: Env, imageUrl: string, options: DownloadImageOptions = {}): Promise<DownloadedImage> {
    const maxBytes = Math.max(50_000, Math.min(5_000_000, Number(env.IMAGE_MAX_DOWNLOAD_BYTES || 1_500_000)));
    let current = assertSafeImageUrl(imageUrl, options.allowedHosts);
    for (let redirects = 0; redirects < 3; redirects += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        let response: Response;
        try {
            response = await fetch(current.toString(), { redirect: 'manual', signal: controller.signal });
        } finally {
            clearTimeout(timer);
        }
        if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get('location');
            if (!location) throw new Error('image_redirect_missing');
            current = assertSafeImageUrl(new URL(location, current).toString(), options.allowedHosts);
            continue;
        }
        if (!response.ok) throw new Error(`image_download_failed_${response.status}`);
        const contentLength = Number(response.headers.get('content-length') || 0);
        if (contentLength > maxBytes) throw new Error('image_too_large');
        const mimeType = normalizeImageMime(response.headers.get('content-type'));
        const bytes = await readBodyWithLimit(response, maxBytes);
        const sha256 = await sha256Hex(bytes);
        return { bytes, mimeType, size: bytes.byteLength, sha256 };
    }
    throw new Error('too_many_image_redirects');
}

async function readBodyWithLimit(response: Response, maxBytes: number): Promise<Uint8Array> {
    const reader = response.body?.getReader();
    if (!reader) {
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > maxBytes) throw new Error('image_too_large');
        return new Uint8Array(buffer);
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > maxBytes) {
            await reader.cancel().catch(() => undefined);
            throw new Error('image_too_large');
        }
        chunks.push(value);
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return out;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
