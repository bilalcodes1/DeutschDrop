import type { Env } from '../../models';
import type { D1Database } from '@cloudflare/workers-types';

export type TtsErrorType = 'SKIPPED_NO_KEY' | 'SKIPPED_NO_URL' | 'BAD_CONFIG' | 'BAD_RESPONSE' | 'NETWORK' | 'DAILY_LIMIT' | 'UNKNOWN';

export interface TtsProviderConfig {
    provider: string;
    language: string;
    voice: string;
    model: string;
    format: string;
}

export interface TtsSuccess extends TtsProviderConfig {
    ok: true;
    audioBytes: Uint8Array;
    contentHash: string;
    apiKeyHash?: string | null;
}

export interface TtsFailure {
    ok: false;
    provider: string;
    language: string;
    voice: string;
    model: string;
    format: string;
    errorType: TtsErrorType;
    status?: number;
    message?: string;
    apiKeyHash?: string | null;
}

export type TtsProviderResult = TtsSuccess | TtsFailure;

export interface TtsProvider {
    name: string;
    config(env: Env): TtsProviderConfig;
    synthesize(env: Env, text: string, context?: TtsProviderContext): Promise<TtsProviderResult>;
}

export interface TtsProviderContext {
    db?: D1Database;
}

export function normalizeTtsText(value: string): string {
    return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
}

export function isGermanLanguage(language: string): boolean {
    const normalized = language.toLocaleLowerCase('de-DE');
    return normalized === 'de' || normalized === 'de-de';
}

export function isGermanVoice(voice: string): boolean {
    return voice === '' || voice.startsWith('de-DE');
}

export async function contentHash(value: string): Promise<string> {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function safeTtsMessage(value: string | undefined): string | undefined {
    return value?.replace(/[A-Za-z0-9_-]{20,}/g, '[redacted]').slice(0, 160);
}
