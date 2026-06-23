import type { Env } from '../../models';
import type { ImageSearchProvider, ImageSearchRequest, ImageSearchResponse } from './imageSearchTypes';
import { resolveEmojiVisual, isClearGameVisual } from '../gameVisualService';
import { legacyVisualToImageResult } from './legacyVisualAdapter';

export const legacyImageProvider: ImageSearchProvider = {
    provider: 'legacy',
    endpointType: 'local_emoji_visuals',
    isConfigured: () => true,
    async search(_env: Env, request: ImageSearchRequest & { query: string }): Promise<ImageSearchResponse> {
        const visual = resolveEmojiVisual(request.german, request.arabic);
        if (!isClearGameVisual(visual)) {
            return { provider: 'legacy', query: request.query, page: request.page ?? 1, configured: true, results: [] };
        }
        const result = legacyVisualToImageResult(visual, request.german, request.arabic);
        return {
            provider: 'legacy',
            query: request.query,
            page: request.page ?? 1,
            configured: true,
            results: result ? [result] : [],
            hasNextPage: false,
        };
    },
};
