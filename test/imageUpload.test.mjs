import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { downloadTelegramPhoto, getTelegramImageMaxBytes, selectBestTelegramPhotoSize } from '../dist/services/imageSearch/manualUploadImageService.js';
import { detectSupportedImageMime, extensionForMime } from '../dist/services/imageSearch/imageValidationService.js';

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0xff, 0xd9]);
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const WEBP_BYTES = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x08, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x00]);
const HTML_BYTES = new TextEncoder().encode('<html>not an image</html>');
const SVG_BYTES = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

function withFetch(mock, fn) {
    const original = globalThis.fetch;
    globalThis.fetch = mock;
    return Promise.resolve()
        .then(fn)
        .finally(() => {
            globalThis.fetch = original;
        });
}

test('manual upload downloads Telegram photo through getFile then file URL', async () => {
    const calls = [];
    await withFetch(async (url) => {
        calls.push(String(url));
        if (String(url).includes('/getFile')) {
            return Response.json({ ok: true, result: { file_path: 'photos/file.jpg', file_size: 4 } });
        }
        return new Response(JPEG_BYTES, { status: 200, headers: { 'content-type': 'image/jpeg' } });
    }, async () => {
        const image = await downloadTelegramPhoto({ TELEGRAM_BOT_TOKEN: 'bot-token', IMAGE_MAX_DOWNLOAD_BYTES: '1000' }, 'file-id');
        assert.equal(image.size, JPEG_BYTES.byteLength);
        assert.equal(image.mimeType, 'image/jpeg');
        assert.equal(calls.length, 2);
        assert.match(calls[0], /getFile\?file_id=file-id/);
        assert.match(calls[1], /\/file\/botbot-token\/photos\/file\.jpg/);
    });
});

test('manual upload accepts image/jpg and normalizes it to image/jpeg', async () => {
    await withFetch(async (url) => {
        if (String(url).includes('/getFile')) return Response.json({ ok: true, result: { file_path: 'photos/file.jpg', file_size: JPEG_BYTES.byteLength } });
        return new Response(JPEG_BYTES, { status: 200, headers: { 'content-type': 'image/jpg' } });
    }, async () => {
        const image = await downloadTelegramPhoto({ TELEGRAM_BOT_TOKEN: 'bot-token', IMAGE_MAX_DOWNLOAD_BYTES: '1000' }, 'file-id');
        assert.equal(image.mimeType, 'image/jpeg');
    });
});

test('manual upload accepts octet-stream Telegram JPEG when signature is safe', async () => {
    await withFetch(async (url) => {
        if (String(url).includes('/getFile')) return Response.json({ ok: true, result: { file_path: 'photos/file.jpg', file_size: JPEG_BYTES.byteLength } });
        return new Response(JPEG_BYTES, { status: 200, headers: { 'content-type': 'application/octet-stream' } });
    }, async () => {
        const image = await downloadTelegramPhoto({ TELEGRAM_BOT_TOKEN: 'bot-token', IMAGE_MAX_DOWNLOAD_BYTES: '1000' }, 'file-id');
        assert.equal(image.mimeType, 'image/jpeg');
        assert.equal(extensionForMime(image.mimeType), 'jpg');
    });
});

test('manual upload accepts JPEG without content type using signature and .jpeg path', async () => {
    await withFetch(async (url) => {
        if (String(url).includes('/getFile')) return Response.json({ ok: true, result: { file_path: 'photos/file.jpeg', file_size: JPEG_BYTES.byteLength } });
        return new Response(JPEG_BYTES, { status: 200 });
    }, async () => {
        const image = await downloadTelegramPhoto({ TELEGRAM_BOT_TOKEN: 'bot-token', IMAGE_MAX_DOWNLOAD_BYTES: '1000' }, 'file-id');
        assert.equal(image.mimeType, 'image/jpeg');
    });
});

test('manual upload rejects Telegram file larger than configured max before download', async () => {
    let downloadCalled = false;
    await withFetch(async (url) => {
        if (String(url).includes('/getFile')) return Response.json({ ok: true, result: { file_path: 'photos/file.jpg', file_size: 60000 } });
        downloadCalled = true;
            return new Response(JPEG_BYTES);
    }, async () => {
        await assert.rejects(() => downloadTelegramPhoto({ TELEGRAM_BOT_TOKEN: 'bot-token', IMAGE_MAX_DOWNLOAD_BYTES: '50000' }, 'file-id'), /WORD_IMAGE_UPLOAD_TOO_LARGE/);
        assert.equal(downloadCalled, false);
    });
});

test('manual upload rejects unsupported Telegram mime type', async () => {
    await withFetch(async (url) => {
        if (String(url).includes('/getFile')) return Response.json({ ok: true, result: { file_path: 'docs/file.txt', file_size: 4 } });
        return new Response('text', { status: 200, headers: { 'content-type': 'text/plain' } });
    }, async () => {
        await assert.rejects(() => downloadTelegramPhoto({ TELEGRAM_BOT_TOKEN: 'bot-token', IMAGE_MAX_DOWNLOAD_BYTES: '1000' }, 'file-id'), /unsupported_image_signature/);
    });
});

test('manual upload infers png and webp from Telegram path when content type missing', async () => {
    for (const [path, expected] of [['photos/file.png', 'image/png'], ['photos/file.webp', 'image/webp']]) {
        await withFetch(async (url) => {
            const bytes = expected === 'image/png' ? PNG_BYTES : WEBP_BYTES;
            if (String(url).includes('/getFile')) return Response.json({ ok: true, result: { file_path: path, file_size: bytes.byteLength } });
            return new Response(bytes, { status: 200 });
        }, async () => {
            const image = await downloadTelegramPhoto({ TELEGRAM_BOT_TOKEN: 'bot-token', IMAGE_MAX_DOWNLOAD_BYTES: '1000' }, 'file-id');
            assert.equal(image.mimeType, expected);
        });
    }
});

test('central image detection accepts only JPEG PNG and WebP signatures', () => {
    assert.equal(detectSupportedImageMime(JPEG_BYTES, 'image/jpeg', 'file.jpg'), 'image/jpeg');
    assert.equal(detectSupportedImageMime(PNG_BYTES, 'application/octet-stream', 'file.png'), 'image/png');
    assert.equal(detectSupportedImageMime(WEBP_BYTES, null, 'file.webp'), 'image/webp');
});

test('central image detection rejects HTML SVG empty bodies and suspicious mismatches', () => {
    assert.throws(() => detectSupportedImageMime(HTML_BYTES, 'image/jpeg', 'file.jpg'), /unsupported_image_signature/);
    assert.throws(() => detectSupportedImageMime(SVG_BYTES, 'image/svg+xml', 'file.svg'), /unsupported_image_signature|unsupported_image_mime/);
    assert.throws(() => detectSupportedImageMime(new Uint8Array(), 'image/jpeg', 'file.jpg'), /empty_image_body/);
    assert.throws(() => detectSupportedImageMime(PNG_BYTES, 'image/jpeg', 'file.jpg'), /image_mime_mismatch/);
});

test('manual upload rejects jpg extension with HTML content and JPEG header with HTML content', async () => {
    for (const header of ['application/octet-stream', 'image/jpeg']) {
        await withFetch(async (url) => {
            if (String(url).includes('/getFile')) return Response.json({ ok: true, result: { file_path: 'photos/file.jpg', file_size: HTML_BYTES.byteLength } });
            return new Response(HTML_BYTES, { status: 200, headers: { 'content-type': header } });
        }, async () => {
            await assert.rejects(() => downloadTelegramPhoto({ TELEGRAM_BOT_TOKEN: 'bot-token', IMAGE_MAX_DOWNLOAD_BYTES: '1000' }, 'file-id'), /unsupported_image_signature/);
        });
    }
});

test('manual upload rejects empty Telegram file body and SVG content', async () => {
    for (const [path, body, type] of [['photos/empty.jpg', new Uint8Array(), 'image/jpeg'], ['photos/file.svg', SVG_BYTES, 'image/svg+xml']]) {
        await withFetch(async (url) => {
            if (String(url).includes('/getFile')) return Response.json({ ok: true, result: { file_path: path, file_size: body.byteLength } });
            return new Response(body, { status: 200, headers: { 'content-type': type } });
        }, async () => {
            await assert.rejects(() => downloadTelegramPhoto({ TELEGRAM_BOT_TOKEN: 'bot-token', IMAGE_MAX_DOWNLOAD_BYTES: '1000' }, 'file-id'), /WORD_IMAGE_UPLOAD_UNSUPPORTED_SIGNATURE|unsupported_image_signature|unsupported_image_mime/);
        });
    }
});

test('Telegram photo size picker chooses largest safe size under limit', () => {
    const maxBytes = getTelegramImageMaxBytes({ IMAGE_MAX_DOWNLOAD_BYTES: '1500000' });
    const selected = selectBestTelegramPhotoSize([
        { file_id: 'small', file_size: 80_000, width: 320, height: 320 },
        { file_id: 'huge', file_size: 2_000_000, width: 2000, height: 2000 },
        { file_id: 'medium', file_size: 700_000, width: 1280, height: 960 },
    ], maxBytes);
    assert.equal(selected?.file_id, 'medium');
});

test('Telegram photo size picker skips oversized known variants and can use unknown size with stream limit', () => {
    assert.equal(selectBestTelegramPhotoSize([
        { file_id: 'too-big', file_size: 2_000_000, width: 2000, height: 2000 },
        { file_id: 'unknown', width: 900, height: 700 },
    ], 1_500_000)?.file_id, 'unknown');
    assert.equal(selectBestTelegramPhotoSize([{ file_id: 'too-big', file_size: 2_000_000 }], 1_500_000), null);
});

test('manual upload session uses awaiting_manual_word_image_upload type', () => {
    const gameSource = fs.readFileSync(new URL('../src/commands/game.ts', import.meta.url), 'utf8');
    const sessionSource = fs.readFileSync(new URL('../src/repositories/sessionRepository.ts', import.meta.url), 'utf8');
    assert.match(gameSource, /awaiting_manual_word_image_upload/);
    assert.match(sessionSource, /awaiting_manual_word_image_upload/);
    assert.doesNotMatch(gameSource, /saveBotSession<WordImageUploadSession>\(ctx\.db, user\.user_id, 'word_image_upload'/);
});

test('manual upload rejects text and document messages while waiting for photo', () => {
    const gameSource = fs.readFileSync(new URL('../src/commands/game.ts', import.meta.url), 'utf8');
    assert.match(gameSource, /message:text/);
    assert.match(gameSource, /أرسل صورة فقط/);
    assert.match(gameSource, /message:document/);
    assert.match(gameSource, /هذا الملف غير مدعوم/);
});

test('manual upload rolls back R2 object if later persistence fails', () => {
    const gameSource = fs.readFileSync(new URL('../src/commands/game.ts', import.meta.url), 'utf8');
    assert.match(gameSource, /let r2Key: string \| null = null/);
    assert.match(gameSource, /WORD_IMAGES\.delete\(r2Key\)/);
});

test('search result selection rolls back downloaded R2 object on selection failure', () => {
    const gameSource = fs.readFileSync(new URL('../src/commands/game.ts', import.meta.url), 'utf8');
    assert.match(gameSource, /CreatedImageAsset/);
    assert.match(gameSource, /created\?\.r2Key/);
    assert.match(gameSource, /WORD_IMAGES\.delete\(created\.r2Key\)/);
});

test('R2 keys are scoped under user collection and word', () => {
    const gameSource = fs.readFileSync(new URL('../src/commands/game.ts', import.meta.url), 'utf8');
    assert.match(gameSource, /word-images\/u\$\{userId\}\/c\$\{collectionId\}\/w\$\{wordId\}/);
});

test('word image upload logs safe stage details without Telegram secrets or URLs', () => {
    const gameSource = fs.readFileSync(new URL('../src/commands/game.ts', import.meta.url), 'utf8');
    const loggingBlock = gameSource.slice(
        gameSource.indexOf('async function replyImageUploadError'),
        gameSource.indexOf('function imageUploadErrorCode')
    );
    assert.match(loggingBlock, /word_image_upload_failed/);
    assert.match(loggingBlock, /stage/);
    assert.match(loggingBlock, /mimeType/);
    assert.match(loggingBlock, /byteCount/);
    assert.doesNotMatch(loggingBlock, /TELEGRAM_BOT_TOKEN|api\.telegram\.org|fileId|file_path|fileUrl/);
});

test('word image upload shows specific unsupported oversized and technical messages', () => {
    const gameSource = fs.readFileSync(new URL('../src/commands/game.ts', import.meta.url), 'utf8');
    assert.match(gameSource, /الصورة ليست بصيغة مدعومة/);
    assert.match(gameSource, /حجم الصورة أكبر من الحد المسموح/);
    assert.match(gameSource, /تعذر حفظ الصورة حالياً/);
    assert.doesNotMatch(gameSource, /تعذر حفظ الصورة\. تأكد أنها JPEG \/ PNG \/ WebP وبحجم مناسب/);
});

test('word image word menu renders the exclude-from-image-mode button once', () => {
    const gameSource = fs.readFileSync(new URL('../src/commands/game.ts', import.meta.url), 'utf8');
    const menuBlock = gameSource.slice(
        gameSource.indexOf('async function showWordImageWordMenu'),
        gameSource.indexOf('async function showWordImageResults')
    );
    const matches = menuBlock.match(/⏭ استبعادها من مود الصور/g) ?? [];
    assert.equal(matches.length, 1);
    assert.doesNotMatch(menuBlock, /⏭ استبعاد من مود الصور/);
});

test('word image flow keeps the unified exclude label and removes the old unsuitable phrase', () => {
    const gameSource = fs.readFileSync(new URL('../src/commands/game.ts', import.meta.url), 'utf8');
    assert.match(gameSource, /⏭ استبعادها من مود الصور/);
    assert.doesNotMatch(gameSource, /🚫 هذه الكلمة غير مناسبة للصور/);
});
