import type { Env } from '../../../models';
import type { AiProvider } from '../aiTypes';

export const grokProvider: AiProvider = {
    name: 'grok',
    async run(env: Env, prompt: string) {
        const key = firstKey(env.GROK_API_KEYS);
        if (!key) throw new Error('missing Grok key');
        const model = env.GROK_MODEL || 'grok-2-latest';
        const response = await fetch('https://api.x.ai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${key}`,
            },
            body: JSON.stringify({
                model,
                temperature: 0.4,
                messages: [{ role: 'user', content: prompt }],
            }),
        });
        if (!response.ok) throw new Error('Grok request failed');
        const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
        const text = json.choices?.[0]?.message?.content ?? '';
        if (!text.trim()) throw new Error('Grok empty response');
        return { text, model };
    },
};

function firstKey(value?: string): string | null {
    return value?.split(',').map(v => v.trim()).find(Boolean) ?? null;
}
