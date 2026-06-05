import type { Env } from '../../models';

export const CLOUDFLARE_TTS_PROVIDER = 'cloudflareTts';
const DEFAULT_CLOUDFLARE_TTS_MODEL = '@cf/myshell-ai/melotts';

export interface TtsResult {
    provider: typeof CLOUDFLARE_TTS_PROVIDER;
    audioBytes: Uint8Array;
    contentHash: string;
}

export async function generateCloudflareTts(env: Env, germanText: string): Promise<TtsResult> {
    if (!env.AI) throw new Error('CLOUDFLARE_AI_UNAVAILABLE');
    const text = normalizeTtsText(germanText);
    const model = env.CLOUDFLARE_TTS_MODEL || DEFAULT_CLOUDFLARE_TTS_MODEL;
    const result = await env.AI.run(model, {
        prompt: text,
        lang: 'de',
    });
    const audioBytes = extractAudioBytes(result);
    if (audioBytes.byteLength === 0) throw new Error('TTS_EMPTY_AUDIO');
    return {
        provider: CLOUDFLARE_TTS_PROVIDER,
        audioBytes,
        contentHash: await contentHash(`${CLOUDFLARE_TTS_PROVIDER}:${text}`),
    };
}

export function normalizeTtsText(value: string): string {
    return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
}

async function contentHash(value: string): Promise<string> {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function extractAudioBytes(result: unknown): Uint8Array {
    if (result instanceof ArrayBuffer) return new Uint8Array(result);
    if (result instanceof Uint8Array) return result;
    if (typeof result === 'string') return base64ToBytes(result);
    if (result && typeof result === 'object' && 'audio' in result) {
        const audio = (result as { audio?: unknown }).audio;
        if (typeof audio === 'string') return base64ToBytes(audio);
        if (audio instanceof Uint8Array) return audio;
        if (audio instanceof ArrayBuffer) return new Uint8Array(audio);
    }
    throw new Error('TTS_BAD_RESPONSE');
}

function base64ToBytes(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}
