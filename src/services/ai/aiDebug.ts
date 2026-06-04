import type { Env } from '../../models';
import type { AiProvider, AiProviderName } from './aiTypes';
import type { AiErrorType } from './aiErrors';
import { countProviderKeys, getProviderModel, hasProviderKey, orderedProviders, parseJsonResult } from './aiRouter';
import { geminiProvider } from './providers/geminiProvider';
import { kimiProvider } from './providers/kimiProvider';
import { grokProvider } from './providers/grokProvider';

interface ProviderDebugResult {
    provider: AiProviderName;
    keys: number;
    model: string;
    endpoint_type: 'gemini_generateContent' | 'openai_chat_completions';
    raw_text_test_status: 'OK' | 'FAILED' | 'SKIPPED_NO_KEY';
    json_test_status: 'OK' | 'FAILED' | 'SKIPPED_NO_KEY';
    error_type?: AiErrorType;
    status_code?: number;
    safe_message?: string;
}

export interface AiDebugReport {
    aiEnabled: boolean;
    providerOrder: string;
    providers: ProviderDebugResult[];
}

export async function buildAiDebugReport(env: Env): Promise<AiDebugReport> {
    const providers = await Promise.all(orderedDebugProviders(env).map(async (provider) => {
        const keys = countProviderKeys(env, provider.name);
        if (!hasProviderKey(env, provider.name)) {
            return {
                provider: provider.name,
                keys,
                model: getProviderModel(env, provider.name),
                endpoint_type: endpointType(provider.name),
                raw_text_test_status: 'SKIPPED_NO_KEY',
                json_test_status: 'SKIPPED_NO_KEY',
                error_type: 'SKIPPED_NO_KEY',
            } satisfies ProviderDebugResult;
        }

        const raw = await provider.run(env, 'Reply with OK', { jsonMode: false, maxTokens: 32 });
        const json = raw.ok
            ? await provider.run(env, debugPrompt(provider.name), { jsonMode: true, maxTokens: 128 })
            : null;

        const jsonParsed = json?.ok ? parseJsonResult<{ ok?: boolean; provider?: string }>(json.text ?? '') : null;
        const jsonOk = Boolean(json?.ok && jsonParsed?.ok && jsonParsed.provider === provider.name);
        const error = firstError(raw, json, jsonOk);
        return {
            provider: provider.name,
            keys,
            model: raw.model || json?.model || getProviderModel(env, provider.name),
            endpoint_type: endpointType(provider.name),
            raw_text_test_status: raw.ok && (raw.text ?? '').trim().includes('OK') ? 'OK' : 'FAILED',
            json_test_status: jsonOk ? 'OK' : 'FAILED',
            ...(error.error_type ? { error_type: error.error_type } : {}),
            ...(error.status_code ? { status_code: error.status_code } : {}),
            ...(error.safe_message ? { safe_message: error.safe_message } : {}),
        } satisfies ProviderDebugResult;
    }));

    return {
        aiEnabled: env.AI_ENABLED === 'true',
        providerOrder: env.AI_PROVIDER_ORDER || 'gemini,kimi,grok',
        providers,
    };
}

export function formatAiDebugReport(report: AiDebugReport): string {
    const title = `🤖 AI Debug\n\n` +
        `AI_ENABLED: ${report.aiEnabled ? 'true' : 'false'}\n` +
        `Provider order: ${report.providerOrder}`;
    const body = report.providers.map(provider =>
        `\n\n${providerLabel(provider.provider)}:\n` +
        `keys: ${provider.keys}\n` +
        `model: ${provider.model}\n` +
        `endpoint_type: ${provider.endpoint_type}\n` +
        `raw_text_test_status: ${provider.raw_text_test_status}\n` +
        `json_test_status: ${provider.json_test_status}` +
        (provider.error_type ? `\nerror_type: ${provider.error_type}` : '') +
        (provider.status_code ? `\nstatus_code: ${provider.status_code}` : '') +
        (provider.safe_message ? `\nsafe_message: ${provider.safe_message}` : '')
    ).join('');
    return title + body;
}

function orderedDebugProviders(env: Env): AiProvider[] {
    const byName: Record<AiProviderName, AiProvider> = {
        gemini: geminiProvider,
        kimi: kimiProvider,
        grok: grokProvider,
    };
    const names = orderedProviders(env).map(provider => provider.name);
    for (const name of ['gemini', 'kimi', 'grok'] as AiProviderName[]) {
        if (!names.includes(name)) names.push(name);
    }
    return names.map(name => byName[name]);
}

function debugPrompt(providerName: AiProviderName): string {
    return `Return this exact JSON only:\n{"ok":true,"provider":"${providerName}"}`;
}

function firstError(
    raw: Awaited<ReturnType<AiProvider['run']>>,
    json: Awaited<ReturnType<AiProvider['run']>> | null,
    jsonOk: boolean
): { error_type?: AiErrorType; status_code?: number; safe_message?: string } {
    if (!raw.ok) return { error_type: raw.errorType ?? 'UNKNOWN', status_code: raw.status, safe_message: raw.safeMessage };
    if (!json) return {};
    if (!json.ok) return { error_type: json.errorType ?? 'UNKNOWN', status_code: json.status, safe_message: json.safeMessage };
    if (!jsonOk) return { error_type: 'BAD_JSON' };
    return {};
}

function endpointType(providerName: AiProviderName): ProviderDebugResult['endpoint_type'] {
    return providerName === 'gemini' ? 'gemini_generateContent' : 'openai_chat_completions';
}

function providerLabel(providerName: AiProviderName): string {
    const labels: Record<AiProviderName, string> = {
        gemini: 'Gemini',
        kimi: 'Kimi',
        grok: 'Grok',
    };
    return labels[providerName];
}
