import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '../../models';
import { buildPrompt } from './prompts';
import type { AiProvider, AiProviderName, AiTaskInput, AiTaskResult, AiTaskType, RunAiOptions } from './aiTypes';
import { buildInputHash, getCachedAiResult, setCachedAiResult } from './aiCache';
import { canUseAiTask, getAiUsageSummary, incrementAiUsage } from './aiUsage';
import { geminiProvider } from './providers/geminiProvider';
import { kimiProvider } from './providers/kimiProvider';
import { grokProvider } from './providers/grokProvider';
import { safeProviderWarn } from './aiErrors';
import { getGeminiModel } from './providers/geminiProvider';
import { getKimiModel } from './providers/kimiProvider';
import { getGrokModel } from './providers/grokProvider';

export { getAiUsageSummary };

export const AI_ERROR_MESSAGES: Record<Exclude<AiTaskResult['status'], 'ok'>, string> = {
    AI_DISABLED: 'الذكاء الاصطناعي غير مفعل حالياً.',
    RATE_LIMITED: 'وصلت للحد اليومي لاستخدام الذكاء الصناعي. جرّب لاحقاً.',
    AI_PROVIDER_RATE_LIMITED: 'خدمة الذكاء الصناعي وصلت حد الاستخدام حالياً. جرّب لاحقاً.',
    AI_UNAVAILABLE: 'خدمة الذكاء الصناعي غير متاحة حالياً. جرّب لاحقاً.',
};

const PROVIDERS: Record<AiProviderName, AiProvider> = {
    gemini: geminiProvider,
    kimi: kimiProvider,
    grok: grokProvider,
};

export async function runAiTask<T>(
    env: Env,
    db: D1Database,
    taskType: AiTaskType,
    input: AiTaskInput,
    options: RunAiOptions
): Promise<AiTaskResult<T>> {
    if (env.AI_ENABLED !== 'true') return { status: 'AI_DISABLED' };

    const inputHash = await buildInputHash(taskType, input);
    if (!options.bypassCache) {
        const cached = await getCachedAiResult<T>(db, taskType, inputHash);
        if (cached) return { status: 'ok', result: cached, provider: 'cache' };
    }

    if (!await canUseAiTask(db, options.userId, taskType)) return { status: 'RATE_LIMITED' };

    const prompt = buildPrompt(taskType, input);
    let attemptedProviders = 0;
    let rateLimitedProviders = 0;
    for (const provider of orderedProviders(env)) {
        if (!hasProviderKey(env, provider.name)) {
            safeProviderWarn(provider.name, 'SKIPPED_NO_KEY');
            continue;
        }
        attemptedProviders++;
        try {
            const response = await provider.run(env, prompt, { jsonMode: true });
            if (!response.ok) {
                if (response.errorType === 'RATE_LIMIT') rateLimitedProviders++;
                safeProviderWarn(provider.name, response.errorType ?? 'UNKNOWN', response.status, response.safeMessage);
                continue;
            }
            const result = parseJsonResult<T>(response.text ?? '');
            if (!result) {
                safeProviderWarn(provider.name, 'BAD_JSON');
                continue;
            }
            await setCachedAiResult(db, taskType, inputHash, provider.name, result);
            await incrementAiUsage(db, options.userId, taskType);
            return { status: 'ok', result, provider: provider.name, model: response.model };
        } catch (error) {
            safeProviderWarn(provider.name, 'UNKNOWN');
            // Provider fallback is intentional. Do not expose request details or keys.
        }
    }

    if (attemptedProviders > 0 && attemptedProviders === rateLimitedProviders) {
        return { status: 'AI_PROVIDER_RATE_LIMITED' };
    }

    return { status: 'AI_UNAVAILABLE' };
}

export function orderedProviders(env: Env): AiProvider[] {
    const order = (env.AI_PROVIDER_ORDER || 'gemini,kimi,grok')
        .split(',')
        .map(name => name.trim())
        .filter((name): name is AiProviderName => name === 'gemini' || name === 'kimi' || name === 'grok');
    const seen = new Set<AiProviderName>();
    return order.filter(name => {
        if (seen.has(name)) return false;
        seen.add(name);
        return true;
    }).map(name => PROVIDERS[name]);
}

export function parseJsonResult<T>(text: string): T | null {
    const cleaned = text.trim()
        .replace(/^```(?:json)?/i, '')
        .replace(/```$/i, '')
        .trim();
    const jsonStart = cleaned.indexOf('{');
    const jsonEnd = cleaned.lastIndexOf('}');
    const candidate = jsonStart >= 0 && jsonEnd >= jsonStart ? cleaned.slice(jsonStart, jsonEnd + 1) : cleaned;
    try {
        return JSON.parse(candidate) as T;
    } catch {
        return null;
    }
}

export function countProviderKeys(env: Env, providerName: AiProviderName): number {
    return providerKeyString(env, providerName)
        .split(',')
        .map(key => key.trim())
        .filter(Boolean)
        .length;
}

export function hasProviderKey(env: Env, providerName: AiProviderName): boolean {
    return countProviderKeys(env, providerName) > 0;
}

export function getProviderModel(env: Env, providerName: AiProviderName): string {
    if (providerName === 'gemini') return getGeminiModel(env);
    if (providerName === 'kimi') return getKimiModel(env);
    return getGrokModel(env);
}

function providerKeyString(env: Env, providerName: AiProviderName): string {
    if (providerName === 'gemini') return env.GEMINI_API_KEYS ?? '';
    if (providerName === 'kimi') return env.KIMI_API_KEYS ?? '';
    return env.GROK_API_KEYS ?? '';
}
