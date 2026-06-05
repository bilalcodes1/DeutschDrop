import type { Env } from '../../models';
import { contentHash, isGermanLanguage, isGermanVoice, normalizeTtsText, safeTtsMessage, type TtsProvider, type TtsProviderConfig, type TtsProviderResult } from './types';

export const EDGE_TTS_WORKER_PROVIDER = 'edgeTtsWorker';
export const EDGE_TTS_WORKER_MODEL = 'edgeTtsWorker';
const DEFAULT_EDGE_TTS_VOICE = 'de-DE-KatjaNeural';
const DEFAULT_LANGUAGE = 'de-DE';
const DEFAULT_FORMAT = 'mp3';
const ALLOWED_EDGE_WORKER_VOICES = new Set(['de-DE-KatjaNeural', 'de-DE-ConradNeural', 'de-DE-KillianNeural']);

export const edgeTtsWorkerProvider: TtsProvider = {
    name: EDGE_TTS_WORKER_PROVIDER,
    config: getEdgeTtsWorkerConfig,
    synthesize: synthesizeEdgeTtsWorker,
};

export function getEdgeTtsWorkerConfig(env: Env): TtsProviderConfig {
    return {
        provider: EDGE_TTS_WORKER_PROVIDER,
        language: env.TTS_LANGUAGE || DEFAULT_LANGUAGE,
        voice: env.EDGE_TTS_VOICE || DEFAULT_EDGE_TTS_VOICE,
        model: EDGE_TTS_WORKER_MODEL,
        format: env.TTS_AUDIO_FORMAT || DEFAULT_FORMAT,
    };
}

export async function synthesizeEdgeTtsWorker(env: Env, germanText: string): Promise<TtsProviderResult> {
    const config = getEdgeTtsWorkerConfig(env);
    if (!env.EDGE_TTS_WORKER_URL) return failure(config, 'SKIPPED_NO_URL');
    if (!isGermanLanguage(config.language) || !isGermanVoice(config.voice) || !ALLOWED_EDGE_WORKER_VOICES.has(config.voice)) {
        return failure(config, 'BAD_CONFIG');
    }

    const text = normalizeTtsText(germanText);
    const endpoint = `${env.EDGE_TTS_WORKER_URL.replace(/\/+$/, '')}/api/tts`;
    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, voice: config.voice, language: config.language }),
        });
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (!response.ok || bytes.byteLength === 0) {
            return failure(config, 'BAD_RESPONSE', response.status, safeTtsMessage(new TextDecoder().decode(bytes.slice(0, 160))));
        }
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

function failure(config: TtsProviderConfig, errorType: 'SKIPPED_NO_URL' | 'BAD_CONFIG' | 'BAD_RESPONSE' | 'NETWORK', status?: number, message?: string): TtsProviderResult {
    return { ok: false, ...config, errorType, status, message };
}
