import type { Env } from '../../../models';
import type { AiProvider } from '../aiTypes';
import { classifyHttpStatus } from '../aiErrors';

export const kimiProvider: AiProvider = {
    name: 'kimi',
    async run(env: Env, prompt: string, options = {}) {
        const key = firstKey(env.KIMI_API_KEYS);
        if (!key) return { ok: false, errorType: 'SKIPPED_NO_KEY', model: getKimiModel(env) };
        const model = getKimiModel(env);
        try {
            const response = await fetch('https://api.moonshot.ai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${key}`,
                },
                body: JSON.stringify({
                    model,
                    temperature: 0.2,
                    max_tokens: options.maxTokens ?? 256,
                    messages: [{ role: 'user', content: prompt }],
                    ...(options.jsonMode ? { response_format: { type: 'json_object' } } : {}),
                }),
            });
            if (!response.ok) {
                await readSafeError(response);
                return { ok: false, errorType: classifyHttpStatus(response.status), status: response.status, model };
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

async function readSafeError(response: Response): Promise<void> {
    try {
        await response.text();
    } catch {
        // Keep diagnostics classified only.
    }
}
