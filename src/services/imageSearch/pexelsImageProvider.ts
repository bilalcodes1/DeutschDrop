import type { Env } from '../../models';
import type { ImageSearchProvider, ImageSearchRequest, ImageSearchResponse, NormalizedImageResult } from './imageSearchTypes';
import { fetchJsonWithTimeout } from './providerFetch';

interface PexelsPhoto {
    id: number;
    url: string;
    width: number;
    height: number;
    photographer: string;
    photographer_url: string;
    src: { tiny?: string; medium?: string; large?: string; original?: string };
    alt?: string;
}

interface PexelsSearchResponse {
    photos?: PexelsPhoto[];
    total_results?: number;
    next_page?: string;
}

export const pexelsImageProvider: ImageSearchProvider = {
    provider: 'pexels',
    endpointType: 'pexels_search',
    isConfigured: (env: Env) => Boolean(env.PEXELS_API_KEY?.trim()),
    async search(env: Env, request: ImageSearchRequest & { query: string }): Promise<ImageSearchResponse> {
        const key = env.PEXELS_API_KEY?.trim();
        if (!key) return { provider: 'pexels', query: request.query, page: request.page ?? 1, configured: false, results: [], errorType: 'NO_KEY' };
        const page = Math.max(1, request.page ?? 1);
        const perPage = Math.max(1, Math.min(12, request.perPage ?? 6));
        const url = new URL('https://api.pexels.com/v1/search');
        url.searchParams.set('query', request.query);
        url.searchParams.set('page', String(page));
        url.searchParams.set('per_page', String(perPage));
        if (request.orientation) url.searchParams.set('orientation', request.orientation);
        try {
            const { response, data, malformed } = await fetchJsonWithTimeout<PexelsSearchResponse>(url.toString(), { headers: { Authorization: key } });
            if (!response.ok) {
                return { provider: 'pexels', query: request.query, page, configured: true, results: [], status: response.status, errorType: classifyStatus(response.status) };
            }
            if (malformed || !data) {
                return { provider: 'pexels', query: request.query, page, configured: true, results: [], status: response.status, errorType: 'BAD_RESPONSE' };
            }
            const results = (data.photos ?? []).map(normalizePexelsPhoto).filter(Boolean) as NormalizedImageResult[];
            return { provider: 'pexels', query: request.query, page, configured: true, results, hasNextPage: Boolean(data.next_page) };
        } catch {
            return { provider: 'pexels', query: request.query, page, configured: true, results: [], errorType: 'NETWORK' };
        }
    },
};

function normalizePexelsPhoto(photo: PexelsPhoto): NormalizedImageResult | null {
    const imageUrl = photo.src.large || photo.src.original || photo.src.medium;
    const previewUrl = photo.src.medium || photo.src.tiny || imageUrl;
    if (!imageUrl || !previewUrl) return null;
    return {
        provider: 'pexels',
        providerImageId: String(photo.id),
        title: photo.alt || `Pexels image ${photo.id}`,
        previewUrl,
        imageUrl,
        sourcePageUrl: photo.url,
        photographerName: photo.photographer || null,
        photographerUrl: photo.photographer_url || null,
        attributionText: `Photo: ${photo.photographer || 'Pexels'} / Pexels`,
        width: photo.width,
        height: photo.height,
    };
}

function classifyStatus(status: number): ImageSearchResponse['errorType'] {
    if (status === 401 || status === 403) return 'AUTH';
    if (status === 429) return 'RATE_LIMIT';
    return 'BAD_RESPONSE';
}
