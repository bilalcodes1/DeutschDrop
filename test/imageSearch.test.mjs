import assert from 'node:assert/strict';
import test from 'node:test';
import { pexelsImageProvider } from '../dist/services/imageSearch/pexelsImageProvider.js';
import { pixabayImageProvider } from '../dist/services/imageSearch/pixabayImageProvider.js';
import { unsplashImageProvider } from '../dist/services/imageSearch/unsplashImageProvider.js';
import { getImageProviderOrder } from '../dist/services/imageSearch/imageSearchRouter.js';

function withFetch(mock, fn) {
    const original = globalThis.fetch;
    globalThis.fetch = mock;
    return Promise.resolve()
        .then(fn)
        .finally(() => {
            globalThis.fetch = original;
        });
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

test('Pexels provider builds real search request and normalizes photo', async () => {
    await withFetch(async (url, init) => {
        const parsed = new URL(String(url));
        assert.equal(parsed.hostname, 'api.pexels.com');
        assert.equal(parsed.searchParams.get('query'), 'duck animal');
        assert.equal(init.headers.Authorization, 'px-key');
        return json({ photos: [{ id: 1, url: 'https://pexels.com/photo/1', width: 800, height: 600, photographer: 'A', photographer_url: 'https://pexels.com/a', src: { medium: 'https://images.pexels.com/medium.jpg', large: 'https://images.pexels.com/large.jpg' }, alt: 'duck' }], next_page: 'https://api.pexels.com/v1/search?page=2' });
    }, async () => {
        const res = await pexelsImageProvider.search({ PEXELS_API_KEY: 'px-key' }, { german: 'Ente', arabic: 'بطة', query: 'duck animal', page: 1, perPage: 5 });
        assert.equal(res.results[0].providerImageId, '1');
        assert.equal(res.results[0].provider, 'pexels');
        assert.equal(res.results[0].attributionText, 'Photo: A / Pexels');
        assert.equal(res.hasNextPage, true);
    });
});

test('Pexels provider maps auth and rate limit statuses safely', async () => {
    await withFetch(async () => json({}, 401), async () => {
        const res = await pexelsImageProvider.search({ PEXELS_API_KEY: 'px-key' }, { german: 'Auto', arabic: 'سيارة', query: 'car', page: 1 });
        assert.equal(res.errorType, 'AUTH');
        assert.equal(res.status, 401);
    });
    await withFetch(async () => json({}, 429), async () => {
        const res = await pexelsImageProvider.search({ PEXELS_API_KEY: 'px-key' }, { german: 'Auto', arabic: 'سيارة', query: 'car', page: 1 });
        assert.equal(res.errorType, 'RATE_LIMIT');
    });
});

test('Pexels provider handles malformed JSON as bad response', async () => {
    await withFetch(async () => new Response('{bad', { status: 200, headers: { 'content-type': 'application/json' } }), async () => {
        const res = await pexelsImageProvider.search({ PEXELS_API_KEY: 'px-key' }, { german: 'Auto', arabic: 'سيارة', query: 'car', page: 1 });
        assert.equal(res.errorType, 'BAD_RESPONSE');
    });
});

test('Pixabay provider builds request and detects next page', async () => {
    await withFetch(async (url) => {
        const parsed = new URL(String(url));
        assert.equal(parsed.hostname, 'pixabay.com');
        assert.equal(parsed.searchParams.get('key'), 'pb-key');
        assert.equal(parsed.searchParams.get('q'), 'car vehicle');
        return json({ totalHits: 20, hits: [{ id: 3, pageURL: 'https://pixabay.com/photos/3', previewURL: 'https://cdn.pixabay.com/preview.jpg', webformatURL: 'https://cdn.pixabay.com/web.jpg', largeImageURL: 'https://cdn.pixabay.com/large.jpg', imageWidth: 640, imageHeight: 480, user: 'B' }] });
    }, async () => {
        const res = await pixabayImageProvider.search({ PIXABAY_API_KEY: 'pb-key' }, { german: 'Auto', arabic: 'سيارة', query: 'car vehicle', page: 1, perPage: 5 });
        assert.equal(res.results[0].provider, 'pixabay');
        assert.equal(res.results[0].attributionText, 'Image: B / Pixabay');
        assert.equal(res.hasNextPage, true);
    });
});

test('Pixabay provider maps 403 auth and malformed response', async () => {
    await withFetch(async () => json({}, 403), async () => {
        const res = await pixabayImageProvider.search({ PIXABAY_API_KEY: 'pb-key' }, { german: 'Haus', arabic: 'بيت', query: 'home', page: 1 });
        assert.equal(res.errorType, 'AUTH');
    });
    await withFetch(async () => new Response('not-json', { status: 200 }), async () => {
        const res = await pixabayImageProvider.search({ PIXABAY_API_KEY: 'pb-key' }, { german: 'Haus', arabic: 'بيت', query: 'home', page: 1 });
        assert.equal(res.errorType, 'BAD_RESPONSE');
    });
});

test('Unsplash provider builds request and stores tracking URL without calling it during search', async () => {
    let calls = 0;
    await withFetch(async (url, init) => {
        calls += 1;
        const parsed = new URL(String(url));
        assert.equal(parsed.hostname, 'api.unsplash.com');
        assert.equal(init.headers.Authorization, 'Client-ID us-key');
        return json({ total_pages: 2, results: [{ id: 'u1', alt_description: 'duck', width: 800, height: 600, links: { html: 'https://unsplash.com/photos/u1', download_location: 'https://api.unsplash.com/photos/u1/download' }, urls: { small: 'https://images.unsplash.com/small.jpg', regular: 'https://images.unsplash.com/reg.jpg' }, user: { name: 'C', links: { html: 'https://unsplash.com/@c' } } }] });
    }, async () => {
        const res = await unsplashImageProvider.search({ UNSPLASH_ACCESS_KEY: 'us-key' }, { german: 'Ente', arabic: 'بطة', query: 'duck', page: 1 });
        assert.equal(res.results[0].downloadTrackingUrl, 'https://api.unsplash.com/photos/u1/download');
        assert.equal(res.hasNextPage, true);
        assert.equal(calls, 1);
    });
});

test('Unsplash provider handles 429 and malformed JSON', async () => {
    await withFetch(async () => json({}, 429), async () => {
        const res = await unsplashImageProvider.search({ UNSPLASH_ACCESS_KEY: 'us-key' }, { german: 'Baum', arabic: 'شجرة', query: 'tree', page: 1 });
        assert.equal(res.errorType, 'RATE_LIMIT');
    });
    await withFetch(async () => new Response('<html>', { status: 200 }), async () => {
        const res = await unsplashImageProvider.search({ UNSPLASH_ACCESS_KEY: 'us-key' }, { german: 'Baum', arabic: 'شجرة', query: 'tree', page: 1 });
        assert.equal(res.errorType, 'BAD_RESPONSE');
    });
});

test('providers report missing keys without network calls', async () => {
    let called = false;
    await withFetch(async () => {
        called = true;
        return json({});
    }, async () => {
        assert.equal((await pexelsImageProvider.search({}, { german: 'x', arabic: 'x', query: 'x', page: 1 })).errorType, 'NO_KEY');
        assert.equal((await pixabayImageProvider.search({}, { german: 'x', arabic: 'x', query: 'x', page: 1 })).errorType, 'NO_KEY');
        assert.equal((await unsplashImageProvider.search({}, { german: 'x', arabic: 'x', query: 'x', page: 1 })).errorType, 'NO_KEY');
        assert.equal(called, false);
    });
});

test('provider order removes duplicates and unsupported providers', () => {
    assert.deepEqual(getImageProviderOrder({ IMAGE_PROVIDER_ORDER: 'unsplash,pexels,unsplash,zai,manual_upload,pixabay' }), ['unsplash', 'pexels', 'pixabay']);
});

test('provider source files never include API keys in logs', () => {
    const sources = [pexelsImageProvider, pixabayImageProvider, unsplashImageProvider].map(provider => provider.endpointType).join('\n');
    assert.doesNotMatch(sources, /API_KEY|ACCESS_KEY|secret/i);
});
