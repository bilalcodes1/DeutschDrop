import type { Env } from '../../models';
import type { AiProvider, AiProviderName } from './aiTypes';
import { classifyAiError, type AiErrorType } from './aiErrors';
import { countProviderKeys, getProviderModel, hasProviderKey, orderedProviders, parseJsonResult } from './aiRouter';
import { geminiProvider } from './providers/geminiProvider';
import { kimiProvider } from './providers/kimiProvider';
import { grokProvider } from './providers/grokProvider';

interface ProviderDebugResult {
    provider: AiProviderName;
    keys: number;
    model: string;
    status: 'OK' | 'FAILED' | 'SKIPPED_NO_KEY';
    error_type?: AiErrorType;
    status_code?: number;
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
                status: 'SKIPPED_NO_KEY',
                error_type: 'SKIPPED_NO_KEY',
            } satisfies ProviderDebugResult;
        }

        try {
            const response = await provider.run(env, debugPrompt(provider.name));
            const parsed = parseJsonResult<{ ok?: boolean; provider?: string }>(response.text);
            if (!parsed?.ok || parsed.provider !== provider.name) {
                return {
                    provider: provider.name,
                    keys,
                    model: getProviderModel(env, provider.name),
                    status: 'FAILED',
                    error_type: 'BAD_JSON',
                } satisfies ProviderDebugResult;
            }
            return {
                provider: provider.name,
                keys,
                model: response.model || getProviderModel(env, provider.name),
                status: 'OK',
            } satisfies ProviderDebugResult;
        } catch (error) {
            const classified = classifyAiError(error);
            return {
                provider: provider.name,
                keys,
                model: getProviderModel(env, provider.name),
                status: 'FAILED',
                error_type: classified.type,
                status_code: classified.status,
            } satisfies ProviderDebugResult;
        }
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
        `status: ${provider.status}` +
        (provider.error_type ? `\nerror_type: ${provider.error_type}` : '') +
        (provider.status_code ? `\nstatus_code: ${provider.status_code}` : '')
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

function providerLabel(providerName: AiProviderName): string {
    const labels: Record<AiProviderName, string> = {
        gemini: 'Gemini',
        kimi: 'Kimi',
        grok: 'Grok',
    };
    return labels[providerName];
}
