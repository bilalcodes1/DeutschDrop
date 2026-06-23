import type { Env } from '../../models';
import type { WordImageProvider } from '../../repositories/wordImageRepository';

export interface NormalizedImageResult {
    provider: WordImageProvider;
    providerImageId: string;
    title: string;
    previewUrl: string;
    imageUrl: string;
    sourcePageUrl: string;
    photographerName: string | null;
    photographerUrl: string | null;
    attributionText: string;
    downloadTrackingUrl?: string | null;
    width?: number | null;
    height?: number | null;
    mimeType?: string | null;
    legacyVisual?: string | null;
}

export interface ImageSearchRequest {
    german: string;
    arabic: string;
    query?: string;
    page?: number;
    orientation?: 'landscape' | 'portrait' | 'square';
    perPage?: number;
}

export interface ImageSearchResponse {
    provider: WordImageProvider;
    query: string;
    page: number;
    configured: boolean;
    results: NormalizedImageResult[];
    hasNextPage?: boolean;
    errorType?: 'NO_KEY' | 'NETWORK' | 'BAD_RESPONSE' | 'RATE_LIMIT' | 'AUTH' | 'UNKNOWN';
    status?: number;
}

export interface ImageSearchProvider {
    readonly provider: WordImageProvider;
    readonly endpointType: string;
    isConfigured(env: Env): boolean;
    search(env: Env, request: ImageSearchRequest & { query: string }): Promise<ImageSearchResponse>;
}
