import type { Env } from '../../models';
import { edgeTtsWorkerProvider } from './edgeTtsWorker';
import type { TtsProvider, TtsProviderContext, TtsProviderResult } from './types';
import { voiceRssGermanProvider } from './voiceRssGerman';

const PROVIDERS: Record<string, TtsProvider> = {
    voiceRssGerman: voiceRssGermanProvider,
    edgeTtsWorker: edgeTtsWorkerProvider,
};

export const DEFAULT_TTS_PROVIDER_ORDER = ['voiceRssGerman', 'edgeTtsWorker'];

export function orderedTtsProviders(env: Env): TtsProvider[] {
    const names = (env.TTS_PROVIDER_ORDER ?? DEFAULT_TTS_PROVIDER_ORDER.join(','))
        .split(',')
        .map(name => name.trim())
        .filter(Boolean);
    return names.map(name => PROVIDERS[name]).filter(Boolean);
}

export async function synthesizeGermanTts(env: Env, text: string, context?: TtsProviderContext): Promise<{ result: TtsProviderResult; attempts: TtsProviderResult[] }> {
    const attempts: TtsProviderResult[] = [];
    for (const provider of orderedTtsProviders(env)) {
        const result = await provider.synthesize(env, text, context);
        attempts.push(result);
        if (result.ok) return { result, attempts };
    }
    return {
        result: attempts.at(-1) ?? {
            ok: false,
            provider: 'none',
            language: 'de-de',
            voice: '',
            model: 'none',
            format: 'mp3',
            errorType: 'UNKNOWN',
        },
        attempts,
    };
}
