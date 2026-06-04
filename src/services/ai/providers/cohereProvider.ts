import type { Env } from '../../../models';
import type { AiProvider } from '../aiTypes';
import { classifyHttpStatus, readSafeErrorMessage } from '../aiErrors';
import { fetchWithTimeout } from './providerUtils';

export const cohereProvider: AiProvider = {
    name: 'cohere',
    async run(env: Env, prompt: string, options = {}) {
        const key = firstKey(env.COHERE_API_KEYS);
        const model = getCohereModel(env);
        if (!key) return { ok: false, errorType: 'SKIPPED_NO_KEY', model };
        try {
            const response = await fetchWithTimeout('https://api.cohere.com/v2/chat', {
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
            const text = extractCohereText(json);
            if (!text.trim()) return { ok: false, errorType: 'BAD_RESPONSE', model };
            return { ok: true, text, json, model };
        } catch {
            return { ok: false, errorType: 'NETWORK', model };
        }
    },
};

export function getCohereModel(env: Env): string {
    return env.COHERE_MODEL || 'command-r7b-12-2024';
}

export function extractCohereText(json: unknown): string {
    if (typeof json === 'string') return json;
    const value = json as {
        message?: { content?: string | Array<{ text?: string; type?: string }> };
        text?: string;
        response?: string;
    };
    if (typeof value.message?.content === 'string') return value.message.content;
    if (Array.isArray(value.message?.content)) {
        return value.message.content.map(part => part.text ?? '').join('');
    }
    return value.text ?? value.response ?? '';
}

function firstKey(value?: string): string | null {
    return value?.split(',').map(v => v.trim()).find(Boolean) ?? null;
}
