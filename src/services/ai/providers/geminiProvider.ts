import type { Env } from '../../../models';
import type { AiProvider } from '../aiTypes';

export const geminiProvider: AiProvider = {
    name: 'gemini',
    async run(env: Env, prompt: string) {
        const key = firstKey(env.GEMINI_API_KEYS);
        if (!key) throw new Error('missing Gemini key');
        const model = env.GEMINI_MODEL || 'gemini-1.5-flash';
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.4, responseMimeType: 'application/json' },
            }),
        });
        if (!response.ok) throw new Error('Gemini request failed');
        const json = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
        const text = json.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('') ?? '';
        if (!text.trim()) throw new Error('Gemini empty response');
        return { text, model };
    },
};

function firstKey(value?: string): string | null {
    return value?.split(',').map(v => v.trim()).find(Boolean) ?? null;
}
