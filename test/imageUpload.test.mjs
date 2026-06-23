import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { downloadTelegramPhoto } from '../dist/services/imageSearch/manualUploadImageService.js';

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
        return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    }, async () => {
        const image = await downloadTelegramPhoto({ TELEGRAM_BOT_TOKEN: 'bot-token', IMAGE_MAX_DOWNLOAD_BYTES: '1000' }, 'file-id');
        assert.equal(image.size, 4);
        assert.equal(image.mimeType, 'image/jpeg');
        assert.equal(calls.length, 2);
        assert.match(calls[0], /getFile\?file_id=file-id/);
        assert.match(calls[1], /\/file\/botbot-token\/photos\/file\.jpg/);
    });
});

test('manual upload rejects Telegram file larger than configured max before download', async () => {
    let downloadCalled = false;
    await withFetch(async (url) => {
        if (String(url).includes('/getFile')) return Response.json({ ok: true, result: { file_path: 'photos/file.jpg', file_size: 60000 } });
        downloadCalled = true;
        return new Response(new Uint8Array([1]));
    }, async () => {
        await assert.rejects(() => downloadTelegramPhoto({ TELEGRAM_BOT_TOKEN: 'bot-token', IMAGE_MAX_DOWNLOAD_BYTES: '50000' }, 'file-id'), /image_too_large/);
        assert.equal(downloadCalled, false);
    });
});

test('manual upload rejects unsupported Telegram mime type', async () => {
    await withFetch(async (url) => {
        if (String(url).includes('/getFile')) return Response.json({ ok: true, result: { file_path: 'docs/file.txt', file_size: 4 } });
        return new Response('text', { status: 200, headers: { 'content-type': 'text/plain' } });
    }, async () => {
        await assert.rejects(() => downloadTelegramPhoto({ TELEGRAM_BOT_TOKEN: 'bot-token', IMAGE_MAX_DOWNLOAD_BYTES: '1000' }, 'file-id'), /unsupported_image_mime/);
    });
});

test('manual upload infers png and webp from Telegram path when content type missing', async () => {
    for (const [path, expected] of [['photos/file.png', 'image/png'], ['photos/file.webp', 'image/webp']]) {
        await withFetch(async (url) => {
            if (String(url).includes('/getFile')) return Response.json({ ok: true, result: { file_path: path, file_size: 2 } });
            return new Response(new Uint8Array([1, 2]), { status: 200 });
        }, async () => {
            const image = await downloadTelegramPhoto({ TELEGRAM_BOT_TOKEN: 'bot-token', IMAGE_MAX_DOWNLOAD_BYTES: '1000' }, 'file-id');
            assert.equal(image.mimeType, expected);
        });
    }
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
