import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { downloadImageBytes } from '../dist/services/imageSearch/imageDownloadService.js';
import { assertSafeImageUrl, normalizeImageMime } from '../dist/services/imageSearch/imageValidationService.js';

function withFetch(mock, fn) {
    const original = globalThis.fetch;
    globalThis.fetch = mock;
    return Promise.resolve()
        .then(fn)
        .finally(() => {
            globalThis.fetch = original;
        });
}

function imageResponse(bytes, headers = {}) {
    return new Response(new Uint8Array(bytes), {
        status: 200,
        headers: { 'content-type': 'image/jpeg', ...headers },
    });
}

test('safe image URL accepts allowlisted HTTPS provider host', () => {
    const url = assertSafeImageUrl('https://images.pexels.com/photos/1/photo.jpg', ['pexels.com', 'images.pexels.com']);
    assert.equal(url.hostname, 'images.pexels.com');
});

test('safe image URL rejects non-allowlisted host when allowlist is provided', () => {
    assert.throws(() => assertSafeImageUrl('https://example.com/photo.jpg', ['images.pexels.com']), /image_host_not_allowed/);
});

test('safe image URL rejects HTTP', () => {
    assert.throws(() => assertSafeImageUrl('http://images.pexels.com/photo.jpg'), /invalid_image_url_protocol/);
});

test('safe image URL rejects localhost', () => {
    assert.throws(() => assertSafeImageUrl('https://localhost/photo.jpg'), /blocked_image_host/);
});

test('safe image URL rejects private IPv4 ranges', () => {
    for (const host of ['10.0.0.1', '127.0.0.1', '172.16.0.1', '172.31.255.10', '192.168.1.1', '169.254.169.254']) {
        assert.throws(() => assertSafeImageUrl(`https://${host}/image.jpg`), /blocked_image_host|image_host_not_allowed/);
    }
});

test('safe image URL rejects private IPv6 ranges', () => {
    for (const host of ['[::1]', '[fe80::1]', '[fd00::1]']) {
        assert.throws(() => assertSafeImageUrl(`https://${host}/image.jpg`), /blocked_image_host/);
    }
});

test('safe image URL rejects metadata hosts', () => {
    assert.throws(() => assertSafeImageUrl('https://metadata.google.internal/latest'), /blocked_image_host/);
    assert.throws(() => assertSafeImageUrl('https://metadata.azure.com/latest'), /blocked_image_host/);
});

test('image mime normalization accepts jpeg png and webp', () => {
    assert.equal(normalizeImageMime('image/jpg'), 'image/jpeg');
    assert.equal(normalizeImageMime('image/png; charset=binary'), 'image/png');
    assert.equal(normalizeImageMime('image/webp'), 'image/webp');
});

test('image mime normalization rejects html svg and text', () => {
    assert.throws(() => normalizeImageMime('text/html'), /unsupported_image_mime/);
    assert.throws(() => normalizeImageMime('image/svg+xml'), /unsupported_image_mime/);
    assert.throws(() => normalizeImageMime('application/json'), /unsupported_image_mime/);
});

test('download follows safe redirect and revalidates target', async () => {
    await withFetch(async (url) => {
        if (String(url).includes('/start')) {
            return new Response(null, { status: 302, headers: { location: 'https://images.pexels.com/final.jpg' } });
        }
        return imageResponse([1, 2, 3, 4]);
    }, async () => {
        const image = await downloadImageBytes({ IMAGE_MAX_DOWNLOAD_BYTES: '1000' }, 'https://images.pexels.com/start', { allowedHosts: ['images.pexels.com'] });
        assert.equal(image.size, 4);
        assert.equal(image.mimeType, 'image/jpeg');
    });
});

test('download blocks redirect to private host', async () => {
    await withFetch(async () => new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/internal.jpg' } }), async () => {
        await assert.rejects(() => downloadImageBytes({ IMAGE_MAX_DOWNLOAD_BYTES: '1000' }, 'https://images.pexels.com/start'), /blocked_image_host/);
    });
});

test('download rejects oversize by content-length before reading body', async () => {
    await withFetch(async () => imageResponse([1, 2], { 'content-length': '60000' }), async () => {
        await assert.rejects(() => downloadImageBytes({ IMAGE_MAX_DOWNLOAD_BYTES: '50000' }, 'https://images.pexels.com/photo.jpg'), /image_too_large/);
    });
});

test('download enforces stream byte limit without content-length', async () => {
    await withFetch(async () => imageResponse(new Array(60000).fill(7)), async () => {
        await assert.rejects(() => downloadImageBytes({ IMAGE_MAX_DOWNLOAD_BYTES: '50000' }, 'https://images.pexels.com/photo.jpg'), /image_too_large/);
    });
});

test('download rejects HTML response before storing image', async () => {
    await withFetch(async () => new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } }), async () => {
        await assert.rejects(() => downloadImageBytes({ IMAGE_MAX_DOWNLOAD_BYTES: '1000' }, 'https://images.pexels.com/photo.jpg'), /unsupported_image_mime/);
    });
});

test('download rejects unsupported provider host with allowlist', async () => {
    await withFetch(async () => imageResponse([1, 2, 3]), async () => {
        await assert.rejects(() => downloadImageBytes({ IMAGE_MAX_DOWNLOAD_BYTES: '1000' }, 'https://evil.example/photo.jpg', { allowedHosts: ['images.pexels.com'] }), /image_host_not_allowed/);
    });
});

test('game image endpoint source does not accept userId or assetId query trust', () => {
    const source = fs.readFileSync(new URL('../src/game/routes.ts', import.meta.url), 'utf8');
    const imageBlock = source.slice(source.indexOf("url.pathname === '/game/api/image'"), source.indexOf("url.pathname === '/game/api/answer'"));
    assert.match(imageBlock, /token/);
    assert.match(imageBlock, /wordId/);
    assert.doesNotMatch(imageBlock, /assetId|userId/);
});
