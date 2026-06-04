import type { Env } from '../../../models';
import type { AiProvider } from '../aiTypes';
import { AiProviderFailure, classifyHttpStatus } from '../aiErrors';

export const grokProvider: AiProvider = {
    name: 'grok',
    async run(env: Env, prompt: string) {
        const key = firstKey(env.GROK_API_KEYS);
        if (!key) throw new AiProviderFailure('SKIPPED_NO_KEY');
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
        if (!response.ok) throw new AiProviderFailure(classifyHttpStatus(response.status), response.status);
        const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
        const text = json.choices?.[0]?.message?.content ?? '';
        if (!text.trim()) throw new AiProviderFailure('BAD_JSON');
        return { text, model };
    },
};

function firstKey(value?: string): string | null {
    return value?.split(',').map(v => v.trim()).find(Boolean) ?? null;
}
