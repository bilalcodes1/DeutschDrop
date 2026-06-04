import type { Env } from '../../../models';
import type { AiProvider } from '../aiTypes';

export const cloudflareAiProvider: AiProvider = {
    name: 'cloudflareAi',
    async run(env: Env, prompt: string, options = {}) {
        if (!env.AI?.run) return { ok: false, errorType: 'SKIPPED_NO_KEY', model: getCloudflareAiModel(env) };
        const model = getCloudflareAiModel(env);
        try {
            const json = await runWithTimeout(env.AI.run(model, {
                messages: [
                    { role: 'system', content: 'You are a concise German learning assistant. Follow the user instruction exactly.' },
                    { role: 'user', content: prompt },
                ],
                temperature: 0.2,
                max_tokens: options.maxTokens ?? 300,
            }));
            const text = extractCloudflareAiText(json);
            if (!text.trim()) return { ok: false, errorType: 'BAD_JSON', model };
            return { ok: true, text, json, model };
        } catch {
            return { ok: false, errorType: 'NETWORK', model };
        }
    },
};

export function getCloudflareAiModel(env: Env): string {
    return env.CLOUDFLARE_AI_MODEL || '@cf/meta/llama-3.1-8b-instruct';
}

export function extractCloudflareAiText(value: unknown): string {
    if (typeof value === 'string') return value;
    const result = value as {
        response?: string;
        result?: string | { response?: string; text?: string };
        text?: string;
        output?: string;
    };
    if (typeof result.response === 'string') return result.response;
    if (typeof result.text === 'string') return result.text;
    if (typeof result.output === 'string') return result.output;
    if (typeof result.result === 'string') return result.result;
    if (typeof result.result?.response === 'string') return result.result.response;
    if (typeof result.result?.text === 'string') return result.result.text;
    return '';
}

function runWithTimeout<T>(promise: Promise<T>): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000)),
    ]);
}
