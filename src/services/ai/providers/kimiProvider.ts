import type { Env } from '../../../models';
import type { AiProvider } from '../aiTypes';
import { classifyHttpStatus, readSafeErrorMessage } from '../aiErrors';
import { delay, fetchWithTimeout, retryDelayMs } from './providerUtils';

export const kimiProvider: AiProvider = {
    name: 'kimi',
    async run(env: Env, prompt: string, options = {}) {
        const key = firstKey(env.KIMI_API_KEYS);
        if (!key) return { ok: false, errorType: 'SKIPPED_NO_KEY', model: getKimiModel(env) };
        const model = getKimiModel(env);
        try {
            let response = await requestKimi(key, model, prompt, options.maxTokens);
            if (response.status === 429) {
                await delay(retryDelayMs());
                response = await requestKimi(key, model, prompt, options.maxTokens);
            }
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

function requestKimi(key: string, model: string, prompt: string, maxTokens?: number): Promise<Response> {
    return fetchWithTimeout('https://api.moonshot.ai/v1/chat/completions', {
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
            max_tokens: maxTokens ?? 300,
        }),
    });
}

export function getKimiModel(env: Env): string {
    return env.KIMI_MODEL || 'moonshot-v1-8k';
}

function firstKey(value?: string): string | null {
    return value?.split(',').map(v => v.trim()).find(Boolean) ?? null;
}

export function extractOpenAiCompatibleText(json: unknown): string {
    const value = json as { choices?: Array<{ message?: { content?: string } }> };
    return value.choices?.[0]?.message?.content ?? '';
}
