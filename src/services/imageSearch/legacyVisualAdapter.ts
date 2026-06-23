import type { NormalizedImageResult } from './imageSearchTypes';
import type { GameVisual } from '../gameVisualService';

export const LEGACY_VISUAL_SOURCES = [
    'src/services/gameVisualService.ts',
    'word_visual_cache',
    'global_word_visuals',
] as const;

export function legacyVisualToImageResult(
    visual: GameVisual,
    german: string,
    arabic: string
): NormalizedImageResult | null {
    if (visual.source === 'default') return null;
    return {
        provider: 'legacy',
        providerImageId: `legacy:${visual.source}:${visual.value}`,
        title: `${german} — ${arabic}`,
        previewUrl: `legacy:${visual.value}`,
        imageUrl: `legacy:${visual.value}`,
        sourcePageUrl: 'local:gameVisualService',
        photographerName: null,
        photographerUrl: null,
        attributionText: `DeutschDrop legacy visual (${visual.source})`,
        legacyVisual: visual.value,
    };
}
