import type { Env } from '../../../models';
import type { AiProvider } from '../aiTypes';
import { classifyHttpStatus } from '../aiErrors';

export const geminiProvider: AiProvider = {
    name: 'gemini',
    async run(env: Env, prompt: string, options = {}) {
        const key = firstKey(env.GEMINI_API_KEYS);
        if (!key) return { ok: false, errorType: 'SKIPPED_NO_KEY', model: getGeminiModel(env) };
        const model = getGeminiModel(env);
        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ role: 'user', parts: [{ text: prompt }] }],
                    generationConfig: {
                        temperature: 0.2,
                        maxOutputTokens: options.maxTokens ?? 256,
                        ...(options.jsonMode ? { responseMimeType: 'application/json' } : {}),
                    },
                }),
            });
            if (!response.ok) {
                await readSafeError(response);
                return { ok: false, errorType: classifyHttpStatus(response.status), status: response.status, model };
            }
            const json = await response.json() as unknown;
            const text = extractGeminiText(json);
            if (!text.trim()) return { ok: false, errorType: 'BAD_JSON', model };
            return { ok: true, text, json, model };
        } catch {
            return { ok: false, errorType: 'NETWORK', model };
        }
    },
};

export function getGeminiModel(env: Env): string {
    return env.GEMINI_MODEL || 'gemini-2.0-flash';
}

export function extractGeminiText(json: unknown): string {
    const value = json as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    return value.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('') ?? '';
}

function firstKey(value?: string): string | null {
    return value?.split(',').map(v => v.trim()).find(Boolean) ?? null;
}

async function readSafeError(response: Response): Promise<void> {
    try {
        await response.text();
    } catch {
        // Keep diagnostics classified only.
    }
}
