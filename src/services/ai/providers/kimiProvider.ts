import type { Env } from '../../../models';
import type { AiProvider } from '../aiTypes';

export const kimiProvider: AiProvider = {
    name: 'kimi',
    async run(env: Env, prompt: string) {
        const key = firstKey(env.KIMI_API_KEYS);
        if (!key) throw new Error('missing Kimi key');
        const model = env.KIMI_MODEL || 'moonshot-v1-8k';
        const response = await fetch('https://api.moonshot.ai/v1/chat/completions', {
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
        if (!response.ok) throw new Error('Kimi request failed');
        const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
        const text = json.choices?.[0]?.message?.content ?? '';
        if (!text.trim()) throw new Error('Kimi empty response');
        return { text, model };
    },
};

function firstKey(value?: string): string | null {
    return value?.split(',').map(v => v.trim()).find(Boolean) ?? null;
}
