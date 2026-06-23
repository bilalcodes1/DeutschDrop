import type { Env } from '../../models';
import type { ImageSearchProvider, ImageSearchRequest, ImageSearchResponse, NormalizedImageResult } from './imageSearchTypes';
import { fetchJsonWithTimeout } from './providerFetch';

interface UnsplashPhoto {
    id: string;
    alt_description?: string;
    width?: number;
    height?: number;
    links?: { html?: string; download_location?: string };
    urls?: { thumb?: string; small?: string; regular?: string; full?: string };
    user?: { name?: string; links?: { html?: string } };
}

interface UnsplashSearchResponse {
    results?: UnsplashPhoto[];
    total_pages?: number;
}

export const unsplashImageProvider: ImageSearchProvider = {
    provider: 'unsplash',
    endpointType: 'unsplash_search',
    isConfigured: (env: Env) => Boolean(env.UNSPLASH_ACCESS_KEY?.trim()),
    async search(env: Env, request: ImageSearchRequest & { query: string }): Promise<ImageSearchResponse> {
        const key = env.UNSPLASH_ACCESS_KEY?.trim();
        if (!key) return { provider: 'unsplash', query: request.query, page: request.page ?? 1, configured: false, results: [], errorType: 'NO_KEY' };
        const page = Math.max(1, request.page ?? 1);
        const perPage = Math.max(1, Math.min(12, request.perPage ?? 6));
        const url = new URL('https://api.unsplash.com/search/photos');
        url.searchParams.set('query', request.query);
        url.searchParams.set('page', String(page));
        url.searchParams.set('per_page', String(perPage));
        if (request.orientation) url.searchParams.set('orientation', request.orientation);
        try {
            const { response, data, malformed } = await fetchJsonWithTimeout<UnsplashSearchResponse>(url.toString(), { headers: { Authorization: `Client-ID ${key}` } });
            if (!response.ok) {
                return { provider: 'unsplash', query: request.query, page, configured: true, results: [], status: response.status, errorType: classifyStatus(response.status) };
            }
            if (malformed || !data) {
                return { provider: 'unsplash', query: request.query, page, configured: true, results: [], status: response.status, errorType: 'BAD_RESPONSE' };
            }
            const results = (data.results ?? []).map(normalizeUnsplashPhoto).filter(Boolean) as NormalizedImageResult[];
            return { provider: 'unsplash', query: request.query, page, configured: true, results, hasNextPage: page < (data.total_pages ?? page) };
        } catch {
            return { provider: 'unsplash', query: request.query, page, configured: true, results: [], errorType: 'NETWORK' };
        }
    },
};

function normalizeUnsplashPhoto(photo: UnsplashPhoto): NormalizedImageResult | null {
    const imageUrl = photo.urls?.regular || photo.urls?.full || photo.urls?.small;
    const previewUrl = photo.urls?.small || photo.urls?.thumb || imageUrl;
    if (!imageUrl || !previewUrl || !photo.links?.html) return null;
    const photographer = photo.user?.name || 'Unsplash';
    return {
        provider: 'unsplash',
        providerImageId: photo.id,
        title: photo.alt_description || `Unsplash image ${photo.id}`,
        previewUrl,
        imageUrl,
        sourcePageUrl: photo.links.html,
        photographerName: photographer,
        photographerUrl: photo.user?.links?.html ?? null,
        attributionText: `Photo: ${photographer} / Unsplash`,
        downloadTrackingUrl: photo.links.download_location ?? null,
        width: photo.width ?? null,
        height: photo.height ?? null,
    };
}

function classifyStatus(status: number): ImageSearchResponse['errorType'] {
    if (status === 401 || status === 403) return 'AUTH';
    if (status === 429) return 'RATE_LIMIT';
    return 'BAD_RESPONSE';
}
