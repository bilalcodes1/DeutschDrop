import type { Env } from '../../../models';
import type { AiProvider } from '../aiTypes';
import { classifyHttpStatus, readSafeErrorMessage } from '../aiErrors';
import { extractOpenAiCompatibleText } from './kimiProvider';
import { fetchWithTimeout } from './providerUtils';

export const zaiProvider: AiProvider = {
    name: 'zai',
    async run(env: Env, prompt: string, options = {}) {
        const key = firstKey(env.ZAI_API_KEYS);
        const model = getZaiModel(env);
        if (!key) return { ok: false, errorType: 'SKIPPED_NO_KEY', model };
        try {
            const response = await fetchWithTimeout(env.ZAI_BASE_URL || 'https://api.z.ai/api/paas/v4/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${key}`,
                },
                body: JSON.stringify({
                    model,
                    messages: [
                        { role: 'system', content: 'You are a concise German learning assistant. Follow the user instruction exactly.' },
                        { role: 'user', content: prompt },
                    ],
                    temperature: 0.2,
                    max_tokens: options.maxTokens ?? 300,
                }),
            });
            if (!response.ok) {
                const safeMessage = await readSafeErrorMessage(response);
                return { ok: false, errorType: classifyHttpStatus(response.status), status: response.status, safeMessage, model };
            }
            const json = await response.json() as unknown;
            const text = extractOpenAiCompatibleText(json);
            if (!text.trim()) return { ok: false, errorType: 'BAD_JSON', model };
            return { ok: true, text, json, model };
        } catch {
            return { ok: false, errorType: 'NETWORK', model };
        }
    },
};

export function getZaiModel(env: Env): string {
    return env.ZAI_MODEL || 'glm-4.5-air';
}

function firstKey(value?: string): string | null {
    return value?.split(',').map(v => v.trim()).find(Boolean) ?? null;
}
