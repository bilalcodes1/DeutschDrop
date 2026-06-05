import type { Env } from '../../models';
import { countGeneratedAudioTodayByKeyHash, getGeneratedAudioUsageTodayByKeyHash } from '../../repositories/wordAudioCacheRepository';
import { contentHash, isGermanLanguage, normalizeTtsText, safeTtsMessage, type TtsProvider, type TtsProviderConfig, type TtsProviderContext, type TtsProviderResult } from './types';

export const VOICE_RSS_GERMAN_PROVIDER = 'voiceRssGerman';
export const VOICE_RSS_GERMAN_MODEL = 'voiceRssGerman';
export const VOICE_RSS_GERMAN_VOICE = 'Jonas';
export const VOICE_RSS_DAILY_LIMIT_PER_KEY = 350;
const VOICE_RSS_ENDPOINT = 'https://api.voicerss.org/';
const DEFAULT_LANGUAGE = 'de-de';
const DEFAULT_FORMAT = 'mp3';
const DEBUG_VISIBLE_KEY_COUNT = 20;

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

export async function synthesizeVoiceRssGerman(env: Env, germanText: string, context?: TtsProviderContext): Promise<TtsProviderResult> {
    const config = getVoiceRssGermanConfig(env);
    if (!context?.db) return failure(config, 'BAD_CONFIG', undefined, 'missing db');
    if (!isGermanLanguage(config.language) || config.format !== 'mp3') return failure(config, 'BAD_CONFIG');

    const selected = await selectVoiceRssKey(env, context);
    if (!selected.ok) return failure(config, selected.errorType, undefined, selected.message);

    const text = normalizeTtsText(germanText);
    const url = buildVoiceRssUrl(selected.key, text, config.language, config.voice);
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
            apiKeyHash: selected.keyHash,
            contentHash: await contentHash(`${config.provider}:${config.language}:${config.voice}:${config.model}:${config.format}:${text}`),
        };
    } catch (error) {
        return failure(config, 'NETWORK', undefined, safeTtsMessage(error instanceof Error ? error.message : 'unknown'));
    }
}

export function buildVoiceRssUrl(apiKey: string, text: string, language = DEFAULT_LANGUAGE, voice = VOICE_RSS_GERMAN_VOICE): string {
    const url = new URL(VOICE_RSS_ENDPOINT);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('hl', language);
    url.searchParams.set('src', text);
    url.searchParams.set('v', voice);
    url.searchParams.set('f', '48khz_16bit_mono');
    url.searchParams.set('c', 'mp3');
    return url.toString();
}

export function parseVoiceRssKeys(env: Env): string[] {
    const raw = env.VOICERSS_API_KEYS || env.VOICERSS_API_KEY || '';
    const seen = new Set<string>();
    return raw
        .split(',')
        .map(key => key.trim())
        .filter(Boolean)
        .filter((key) => {
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

export async function hashVoiceRssKey(apiKey: string): Promise<string> {
    return contentHash(`voiceRssGerman:${apiKey}`);
}

export async function getVoiceRssKeyStates(env: Env, context: TtsProviderContext): Promise<VoiceRssKeyState[]> {
    const keys = parseVoiceRssKeys(env);
    const hashes = await Promise.all(keys.map(key => hashVoiceRssKey(key)));
    const disabled = new Set((env.VOICERSS_DISABLED_KEY_HASHES || '').split(',').map(hash => hash.trim()).filter(Boolean));
    const usage = context.db ? await getGeneratedAudioUsageTodayByKeyHash(context.db, VOICE_RSS_GERMAN_PROVIDER, hashes) : {};
    return keys.map((key, index) => {
        const keyHash = hashes[index];
        const usedToday = usage[keyHash] ?? 0;
        return {
            key,
            keyHash,
            index: index + 1,
            usedToday,
            limit: VOICE_RSS_DAILY_LIMIT_PER_KEY,
            disabled: disabled.has(keyHash),
            status: disabled.has(keyHash) ? 'DISABLED' : usedToday >= VOICE_RSS_DAILY_LIMIT_PER_KEY ? 'LIMIT' : 'OK',
        };
    });
}

export async function selectVoiceRssKey(env: Env, context: TtsProviderContext): Promise<VoiceRssKeySelection> {
    const states = await getVoiceRssKeyStates(env, context);
    if (states.length === 0) return { ok: false, errorType: 'SKIPPED_NO_KEY', message: 'no VoiceRSS keys configured' };
    const available = states
        .filter(state => !state.disabled && state.usedToday < VOICE_RSS_DAILY_LIMIT_PER_KEY)
        .sort((a, b) => a.usedToday - b.usedToday || a.index - b.index);
    const selected = available[0];
    if (!selected) return { ok: false, errorType: 'DAILY_LIMIT', message: 'all VoiceRSS keys reached daily limit' };
    if (context.db) {
        const latestCount = await countGeneratedAudioTodayByKeyHash(context.db, VOICE_RSS_GERMAN_PROVIDER, selected.keyHash);
        if (latestCount >= VOICE_RSS_DAILY_LIMIT_PER_KEY) return selectVoiceRssKey(env, context);
    }
    return { ok: true, key: selected.key, keyHash: selected.keyHash, state: selected };
}

export function debugVoiceRssKeyStates(states: VoiceRssKeyState[]): { visible: VoiceRssKeyState[]; hiddenCount: number } {
    const visible = states.slice(0, DEBUG_VISIBLE_KEY_COUNT);
    return { visible, hiddenCount: Math.max(0, states.length - visible.length) };
}

function isTextResponse(contentType: string, bytes: Uint8Array): boolean {
    if (contentType.includes('text')) return true;
    const prefix = new TextDecoder().decode(bytes.slice(0, 16));
    return prefix.startsWith('ERROR');
}

function failure(config: TtsProviderConfig, errorType: 'SKIPPED_NO_KEY' | 'BAD_CONFIG' | 'BAD_RESPONSE' | 'NETWORK' | 'DAILY_LIMIT', status?: number, message?: string): TtsProviderResult {
    return { ok: false, ...config, errorType, status, message };
}

export interface VoiceRssKeyState {
    key: string;
    keyHash: string;
    index: number;
    usedToday: number;
    limit: number;
    disabled: boolean;
    status: 'OK' | 'LIMIT' | 'DISABLED';
}

type VoiceRssKeySelection =
    | { ok: true; key: string; keyHash: string; state: VoiceRssKeyState }
    | { ok: false; errorType: 'SKIPPED_NO_KEY' | 'DAILY_LIMIT'; message: string };
