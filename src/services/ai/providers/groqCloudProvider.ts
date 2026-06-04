import type { Env } from '../../../models';
import type { AiProvider } from '../aiTypes';
import { classifyHttpStatus, readSafeErrorMessage } from '../aiErrors';
import { extractOpenAiCompatibleText } from './kimiProvider';

export const groqCloudProvider: AiProvider = {
    name: 'groqCloud',
    async run(env: Env, prompt: string, options = {}) {
        const key = firstKey(env.GROK_API_KEYS);
        if (!key) return { ok: false, errorType: 'SKIPPED_NO_KEY', model: getGroqCloudModel(env) };
        const model = getGroqCloudModel(env);
        try {
            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
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

export function getGroqCloudModel(env: Env): string {
    return env.GROK_MODEL || 'llama-3.1-8b-instant';
}

function firstKey(value?: string): string | null {
    return value?.split(',').map(v => v.trim()).find(Boolean) ?? null;
}
