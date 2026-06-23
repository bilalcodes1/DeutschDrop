import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '../../models';
import { queryOne, run } from '../../db/queries';
import type { WordImageProvider } from '../../repositories/wordImageRepository';
import { legacyImageProvider } from './legacyImageProvider';
import { pexelsImageProvider } from './pexelsImageProvider';
import { pixabayImageProvider } from './pixabayImageProvider';
import { unsplashImageProvider } from './unsplashImageProvider';
import type { ImageSearchProvider, ImageSearchRequest, ImageSearchResponse, NormalizedImageResult } from './imageSearchTypes';
import { buildWordImageSearchQuery } from './wordImageQueryBuilder';

const PROVIDERS: Record<WordImageProvider, ImageSearchProvider | undefined> = {
    legacy: legacyImageProvider,
    pexels: pexelsImageProvider,
    pixabay: pixabayImageProvider,
    unsplash: unsplashImageProvider,
    manual_upload: undefined,
    user_library: undefined,
};

interface CacheRow {
    results_json: string;
    expires_at: string;
}

export async function searchWordImages(
    db: D1Database,
    env: Env,
    request: ImageSearchRequest,
    preferredProvider?: WordImageProvider
): Promise<ImageSearchResponse> {
    const query = buildWordImageSearchQuery(request.german, request.arabic, request.query);
    const page = Math.max(1, request.page ?? 1);
    const providers = preferredProvider ? [preferredProvider] : getImageProviderOrder(env);
    for (const providerName of providers) {
        const provider = PROVIDERS[providerName];
        if (!provider) continue;
        if (!provider.isConfigured(env)) {
            if (providerName === 'legacy') continue;
            continue;
        }
        const cached = await readImageSearchCache(db, provider.provider, query, page, request.orientation);
        if (cached) {
            return { provider: provider.provider, query, page, configured: true, results: cached };
        }
        const response = await provider.search(env, { ...request, query, page });
        if (response.results.length > 0) {
            await writeImageSearchCache(db, response.provider, response.query, response.page, request.orientation, response.results, env);
            return response;
        }
        if (preferredProvider) return response;
    }
    return { provider: preferredProvider ?? providers[0] ?? 'legacy', query, page, configured: true, results: [] };
}

export function getImageProviderOrder(env: Env): WordImageProvider[] {
    const raw = env.IMAGE_PROVIDER_ORDER || 'pexels,pixabay,unsplash,legacy';
    const allowed = new Set<WordImageProvider>(['legacy', 'pexels', 'pixabay', 'unsplash']);
    const providers = raw.split(',')
        .map(part => part.trim())
        .filter((part): part is WordImageProvider => allowed.has(part as WordImageProvider));
    return providers.length ? Array.from(new Set(providers)) : ['pexels', 'pixabay', 'unsplash', 'legacy'];
}

async function readImageSearchCache(
    db: D1Database,
    provider: WordImageProvider,
    query: string,
    page: number,
    orientation?: string
): Promise<NormalizedImageResult[] | null> {
    const queryHash = await cacheKey(provider, query, page, orientation);
    const row = await queryOne<CacheRow>(
        db,
        `SELECT results_json, expires_at
         FROM image_search_cache
         WHERE provider = ? AND query_hash = ? AND page = ? AND COALESCE(orientation, '') = COALESCE(?, '')
           AND expires_at > datetime('now')
         ORDER BY updated_at DESC
         LIMIT 1`,
        [provider, queryHash, page, orientation ?? null]
    );
    if (!row) return null;
    try {
        const parsed = JSON.parse(row.results_json);
        return Array.isArray(parsed) ? parsed.slice(0, 20) as NormalizedImageResult[] : null;
    } catch {
        return null;
    }
}

async function writeImageSearchCache(
    db: D1Database,
    provider: WordImageProvider,
    query: string,
    page: number,
    orientation: string | undefined,
    results: NormalizedImageResult[],
    env: Env
): Promise<void> {
    const ttl = Math.max(300, Math.min(604800, Number(env.IMAGE_SEARCH_CACHE_TTL_SECONDS || 86400)));
    const queryHash = await cacheKey(provider, query, page, orientation);
    await run(
        db,
        `INSERT INTO image_search_cache (provider, query_hash, search_query, page, orientation, results_json, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+' || ? || ' seconds'))`,
        [provider, queryHash, query, page, orientation ?? null, JSON.stringify(results.slice(0, 20)), ttl]
    );
}

async function cacheKey(provider: WordImageProvider, query: string, page: number, orientation?: string): Promise<string> {
    const text = `${provider}|${query.toLocaleLowerCase()}|${page}|${orientation ?? ''}`;
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
