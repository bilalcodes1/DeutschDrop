import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '../../models';
import { buildPrompt } from './prompts';
import type { AiProvider, AiProviderName, AiTaskInput, AiTaskResult, AiTaskType, RunAiOptions } from './aiTypes';
import { buildInputHash, getCachedAiResult, setCachedAiResult } from './aiCache';
import { canUseAiTask, getAiUsageSummary, incrementAiUsage } from './aiUsage';
import { geminiProvider } from './providers/geminiProvider';
import { kimiProvider } from './providers/kimiProvider';
import { grokProvider } from './providers/grokProvider';

export { getAiUsageSummary };

export const AI_ERROR_MESSAGES: Record<Exclude<AiTaskResult['status'], 'ok'>, string> = {
    AI_DISABLED: 'الذكاء الاصطناعي غير مفعل حالياً.',
    RATE_LIMITED: 'وصلت للحد اليومي لاستخدام الذكاء الصناعي. جرّب لاحقاً.',
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
    for (const provider of orderedProviders(env)) {
        try {
            const response = await provider.run(env, prompt);
            const result = parseJsonResult<T>(response.text);
            if (!result) continue;
            await setCachedAiResult(db, taskType, inputHash, provider.name, result);
            await incrementAiUsage(db, options.userId, taskType);
            return { status: 'ok', result, provider: provider.name, model: response.model };
        } catch {
            // Provider fallback is intentional. Do not expose request details or keys.
        }
    }

    return { status: 'AI_UNAVAILABLE' };
}

function orderedProviders(env: Env): AiProvider[] {
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

function parseJsonResult<T>(text: string): T | null {
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
