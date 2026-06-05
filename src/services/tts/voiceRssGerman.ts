import type { Env } from '../../models';
import { contentHash, isGermanLanguage, normalizeTtsText, safeTtsMessage, type TtsProvider, type TtsProviderConfig, type TtsProviderResult } from './types';

export const VOICE_RSS_GERMAN_PROVIDER = 'voiceRssGerman';
export const VOICE_RSS_GERMAN_MODEL = 'voiceRssGerman';
export const VOICE_RSS_GERMAN_VOICE = 'voicerss-default';
const VOICE_RSS_ENDPOINT = 'https://api.voicerss.org/';
const DEFAULT_LANGUAGE = 'de-de';
const DEFAULT_FORMAT = 'mp3';

export const voiceRssGermanProvider: TtsProvider = {
    name: VOICE_RSS_GERMAN_PROVIDER,
    config: getVoiceRssGermanConfig,
    synthesize: synthesizeVoiceRssGerman,
};

export function getVoiceRssGermanConfig(env: Env): TtsProviderConfig {
    return {
        provider: VOICE_RSS_GERMAN_PROVIDER,
        language: env.TTS_LANGUAGE || DEFAULT_LANGUAGE,
        voice: VOICE_RSS_GERMAN_VOICE,
        model: VOICE_RSS_GERMAN_MODEL,
        format: env.TTS_AUDIO_FORMAT || DEFAULT_FORMAT,
    };
}

export async function synthesizeVoiceRssGerman(env: Env, germanText: string): Promise<TtsProviderResult> {
    const config = getVoiceRssGermanConfig(env);
    if (!env.VOICERSS_API_KEY) return failure(config, 'SKIPPED_NO_KEY');
    if (!isGermanLanguage(config.language) || config.format !== 'mp3') return failure(config, 'BAD_CONFIG');

    const text = normalizeTtsText(germanText);
    const url = buildVoiceRssUrl(env.VOICERSS_API_KEY, text, config.language);
    try {
        const response = await fetch(url);
        const bytes = new Uint8Array(await response.arrayBuffer());
        const contentType = response.headers.get('content-type') ?? '';
        const errorText = isTextResponse(contentType, bytes) ? new TextDecoder().decode(bytes).slice(0, 160) : undefined;
        if (!response.ok || errorText?.startsWith('ERROR')) {
            return failure(config, response.status === 401 || response.status === 403 ? 'BAD_CONFIG' : 'BAD_RESPONSE', response.status, safeTtsMessage(errorText));
        }
        if (bytes.byteLength === 0) return failure(config, 'BAD_RESPONSE', response.status, 'empty audio');
        return {
            ok: true,
            ...config,
            audioBytes: bytes,
            contentHash: await contentHash(`${config.provider}:${config.language}:${config.voice}:${config.model}:${config.format}:${text}`),
        };
    } catch (error) {
        return failure(config, 'NETWORK', undefined, safeTtsMessage(error instanceof Error ? error.message : 'unknown'));
    }
}

export function buildVoiceRssUrl(apiKey: string, text: string, language = DEFAULT_LANGUAGE): string {
    const url = new URL(VOICE_RSS_ENDPOINT);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('hl', language);
    url.searchParams.set('src', text);
    url.searchParams.set('f', '48khz_16bit_mono');
    url.searchParams.set('c', 'mp3');
    return url.toString();
}

function isTextResponse(contentType: string, bytes: Uint8Array): boolean {
    if (contentType.includes('text')) return true;
    const prefix = new TextDecoder().decode(bytes.slice(0, 16));
    return prefix.startsWith('ERROR');
}

function failure(config: TtsProviderConfig, errorType: 'SKIPPED_NO_KEY' | 'BAD_CONFIG' | 'BAD_RESPONSE' | 'NETWORK', status?: number, message?: string): TtsProviderResult {
    return { ok: false, ...config, errorType, status, message };
}
