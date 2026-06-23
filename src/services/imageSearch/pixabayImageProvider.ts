import type { Env } from '../../models';
import type { ImageSearchProvider, ImageSearchRequest, ImageSearchResponse, NormalizedImageResult } from './imageSearchTypes';
import { fetchJsonWithTimeout } from './providerFetch';

interface PixabayHit {
    id: number;
    pageURL: string;
    previewURL: string;
    webformatURL: string;
    largeImageURL?: string;
    imageWidth?: number;
    imageHeight?: number;
    user?: string;
    userImageURL?: string;
}

interface PixabaySearchResponse {
    hits?: PixabayHit[];
    totalHits?: number;
}

export const pixabayImageProvider: ImageSearchProvider = {
    provider: 'pixabay',
    endpointType: 'pixabay_search',
    isConfigured: (env: Env) => Boolean(env.PIXABAY_API_KEY?.trim()),
    async search(env: Env, request: ImageSearchRequest & { query: string }): Promise<ImageSearchResponse> {
        const key = env.PIXABAY_API_KEY?.trim();
        if (!key) return { provider: 'pixabay', query: request.query, page: request.page ?? 1, configured: false, results: [], errorType: 'NO_KEY' };
        const page = Math.max(1, request.page ?? 1);
        const perPage = Math.max(3, Math.min(12, request.perPage ?? 6));
        const url = new URL('https://pixabay.com/api/');
        url.searchParams.set('key', key);
        url.searchParams.set('q', request.query);
        url.searchParams.set('image_type', 'photo');
        url.searchParams.set('safesearch', 'true');
        url.searchParams.set('page', String(page));
        url.searchParams.set('per_page', String(perPage));
        if (request.orientation) url.searchParams.set('orientation', request.orientation);
        try {
            const { response, data, malformed } = await fetchJsonWithTimeout<PixabaySearchResponse>(url.toString());
            if (!response.ok) {
                return { provider: 'pixabay', query: request.query, page, configured: true, results: [], status: response.status, errorType: classifyStatus(response.status) };
            }
            if (malformed || !data) {
                return { provider: 'pixabay', query: request.query, page, configured: true, results: [], status: response.status, errorType: 'BAD_RESPONSE' };
            }
            const results = (data.hits ?? []).map(normalizePixabayHit);
            return { provider: 'pixabay', query: request.query, page, configured: true, results, hasNextPage: page * perPage < (data.totalHits ?? results.length) };
        } catch {
            return { provider: 'pixabay', query: request.query, page, configured: true, results: [], errorType: 'NETWORK' };
        }
    },
};

function normalizePixabayHit(hit: PixabayHit): NormalizedImageResult {
    return {
        provider: 'pixabay',
        providerImageId: String(hit.id),
        title: `Pixabay image ${hit.id}`,
        previewUrl: hit.webformatURL || hit.previewURL,
        imageUrl: hit.largeImageURL || hit.webformatURL,
        sourcePageUrl: hit.pageURL,
        photographerName: hit.user || null,
        photographerUrl: null,
        attributionText: `Image: ${hit.user || 'Pixabay'} / Pixabay`,
        width: hit.imageWidth ?? null,
        height: hit.imageHeight ?? null,
    };
}

function classifyStatus(status: number): ImageSearchResponse['errorType'] {
    if (status === 401 || status === 403) return 'AUTH';
    if (status === 429) return 'RATE_LIMIT';
    return 'BAD_RESPONSE';
}
