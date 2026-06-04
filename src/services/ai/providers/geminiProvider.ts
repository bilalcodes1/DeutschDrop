import type { Env } from '../../../models';
import type { AiProvider } from '../aiTypes';
import { AiProviderFailure, classifyHttpStatus } from '../aiErrors';

export const geminiProvider: AiProvider = {
    name: 'gemini',
    async run(env: Env, prompt: string) {
        const key = firstKey(env.GEMINI_API_KEYS);
        if (!key) throw new AiProviderFailure('SKIPPED_NO_KEY');
        const model = env.GEMINI_MODEL || 'gemini-1.5-flash';
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.4, responseMimeType: 'application/json' },
            }),
        });
        if (!response.ok) throw new AiProviderFailure(classifyHttpStatus(response.status), response.status);
        const json = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
        const text = json.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('') ?? '';
        if (!text.trim()) throw new AiProviderFailure('BAD_JSON');
        return { text, model };
    },
};

function firstKey(value?: string): string | null {
    return value?.split(',').map(v => v.trim()).find(Boolean) ?? null;
}
