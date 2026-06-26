import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import Database from 'better-sqlite3';
import {
    createImageAsset,
    excludeWordFromImageMode,
    getActiveWordImage,
    getCollectionImageReadiness,
    listSoftDeletedUnreferencedAssets,
    listMissingImageWords,
    listUserImageLibrary,
    markImageAssetStorageDeleted,
    markOrphanImageAssets,
    selectWordImage,
} from '../dist/repositories/wordImageRepository.js';
import { assertSafeImageUrl, isAllowedImageMime } from '../dist/services/imageSearch/imageValidationService.js';
import { getImageProviderOrder, searchWordImages } from '../dist/services/imageSearch/imageSearchRouter.js';
import { buildWordImageSearchQuery } from '../dist/services/imageSearch/wordImageQueryBuilder.js';

class MockD1 {
    constructor(sqlite) {
        this.sqlite = sqlite;
    }
    prepare(sql) {
        const sqlite = this.sqlite;
        return {
            bind(...params) {
                return {
                    first() {
                        return Promise.resolve(sqlite.prepare(sql).get(...params) ?? null);
                    },
                    all() {
                        return Promise.resolve({ results: sqlite.prepare(sql).all(...params) });
                    },
                    run() {
                        const info = sqlite.prepare(sql).run(...params);
                        return Promise.resolve({ success: true, meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) } });
                    },
                };
            },
        };
    }
    batch(statements) {
        return Promise.all(statements.map(statement => statement.run()));
    }
}

function createWordImageDb() {
    const sqlite = new Database(':memory:');
    sqlite.exec(`
        CREATE TABLE users (user_id INTEGER PRIMARY KEY, name TEXT, display_name TEXT);
        CREATE TABLE words (
            word_id INTEGER PRIMARY KEY,
            german TEXT NOT NULL,
            arabic TEXT NOT NULL,
            example TEXT,
            added_by INTEGER NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT
        );
        CREATE TABLE word_collections (
            id INTEGER PRIMARY KEY,
            owner_user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            description TEXT,
            visibility TEXT DEFAULT 'public',
            is_deleted INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE word_collection_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            collection_id INTEGER NOT NULL,
            word_id INTEGER NOT NULL,
            owner_user_id INTEGER NOT NULL,
            position INTEGER DEFAULT 1
        );
        INSERT INTO users (user_id, name, display_name) VALUES (1, 'Bilal', 'Bilal'), (2, 'Mira', 'Mira');
        INSERT INTO words (word_id, german, arabic, example, added_by) VALUES
            (101, 'der Tiger', 'النمر', NULL, 1),
            (102, 'die Ente', 'البطة', NULL, 1),
            (201, 'das Haus', 'البيت', NULL, 2);
        INSERT INTO word_collections (id, owner_user_id, title, visibility, is_deleted) VALUES
            (10, 1, 'Animals', 'public', 0),
            (20, 2, 'Homes', 'public', 0);
        INSERT INTO word_collection_items (collection_id, word_id, owner_user_id, position) VALUES
            (10, 101, 1, 1),
            (10, 102, 1, 2),
            (20, 201, 2, 1);
    `);
    sqlite.exec(fs.readFileSync(new URL('../src/db/migrations/0046_word_images_adventure.sql', import.meta.url), 'utf8'));
    sqlite.exec(fs.readFileSync(new URL('../src/db/migrations/0048_image_inheritance_and_sharing.sql', import.meta.url), 'utf8'));
    return new MockD1(sqlite);
}

test('word image migration creates asset, mapping, cache tables and indexes', () => {
    const source = fs.readFileSync(new URL('../src/db/migrations/0046_word_images_adventure.sql', import.meta.url), 'utf8');
    assert.match(source, /CREATE TABLE IF NOT EXISTS image_assets/);
    assert.match(source, /CREATE TABLE IF NOT EXISTS user_word_images/);
    assert.match(source, /CREATE TABLE IF NOT EXISTS image_search_cache/);
    assert.match(source, /idx_user_word_images_one_active/);
    assert.match(source, /provider IN \('legacy', 'pexels', 'pixabay', 'unsplash', 'manual_upload', 'user_library'\)/);
});

test('word image repository selects images only for owned collection words', async () => {
    const db = createWordImageDb();
    const assetId = await createImageAsset(db, {
        ownerUserId: 1,
        provider: 'manual_upload',
        storageType: 'r2',
        r2Key: 'word-images/u1/c10/w101/test.jpg',
        mimeType: 'image/jpeg',
        fileSize: 1234,
        sha256: 'abc',
        attributionText: 'User uploaded image',
    });
    await selectWordImage(db, 1, 10, 101, assetId);

    const image = await getActiveWordImage(db, 1, 10, 101);
    assert.equal(image?.r2_key, 'word-images/u1/c10/w101/test.jpg');
    assert.equal(image?.provider, 'manual_upload');

    await assert.rejects(() => selectWordImage(db, 2, 10, 101, assetId), /word_image_not_allowed|image_asset_not_allowed/);
});

test('collection image readiness counts selected, excluded, and missing words', async () => {
    const db = createWordImageDb();
    const assetId = await createImageAsset(db, {
        ownerUserId: 1,
        provider: 'legacy',
        storageType: 'legacy',
        hotlinkUrl: 'legacy:🐯',
        previewUrl: 'legacy:🐯',
        attributionText: 'DeutschDrop legacy visual (manual)',
    });
    await selectWordImage(db, 1, 10, 101, assetId);
    await excludeWordFromImageMode(db, 1, 10, 102, 'manual');

    const readiness = await getCollectionImageReadiness(db, 1, 10);
    assert.deepEqual(readiness, {
        totalWords: 2,
        selectedWords: 1,
        excludedWords: 1,
        missingWords: 0,
        playableImageWords: 1,
        isReady: true,
    });
    assert.deepEqual(await listMissingImageWords(db, 1, 10), []);
});

test('user image library includes own uploads and previous legacy choices only for that user', async () => {
    const db = createWordImageDb();
    const ownUpload = await createImageAsset(db, {
        ownerUserId: 1,
        provider: 'manual_upload',
        storageType: 'r2',
        r2Key: 'word-images/1/10/101/upload.jpg',
        mimeType: 'image/jpeg',
    });
    const legacyChoice = await createImageAsset(db, {
        ownerUserId: null,
        provider: 'legacy',
        storageType: 'legacy',
        hotlinkUrl: 'legacy:duck',
        previewUrl: 'legacy:duck',
    });
    const otherUpload = await createImageAsset(db, {
        ownerUserId: 2,
        provider: 'manual_upload',
        storageType: 'r2',
        r2Key: 'word-images/2/20/201/private.jpg',
        mimeType: 'image/jpeg',
    });
    await selectWordImage(db, 1, 10, 101, legacyChoice);

    const assets = await listUserImageLibrary(db, 1, 20, 0);
    assert.ok(assets.some(asset => asset.id === ownUpload));
    assert.ok(assets.some(asset => asset.id === legacyChoice));
    assert.equal(assets.some(asset => asset.id === otherUpload), false);
});

test('word image cleanup marks orphaned R2 assets and clears storage key after delete', async () => {
    const db = createWordImageDb();
    const orphan = await createImageAsset(db, {
        ownerUserId: 1,
        provider: 'manual_upload',
        storageType: 'r2',
        r2Key: 'word-images/1/orphan.jpg',
        mimeType: 'image/jpeg',
    });
    const active = await createImageAsset(db, {
        ownerUserId: 1,
        provider: 'manual_upload',
        storageType: 'r2',
        r2Key: 'word-images/1/active.jpg',
        mimeType: 'image/jpeg',
    });
    await selectWordImage(db, 1, 10, 101, active);
    db.sqlite.prepare("UPDATE image_assets SET created_at = datetime('now', '-2 hours') WHERE id IN (?, ?)").run(orphan, active);

    assert.equal(await markOrphanImageAssets(db, 1), 1);
    const pending = await listSoftDeletedUnreferencedAssets(db, 10);
    assert.deepEqual(pending.map(asset => asset.id), [orphan]);

    await markImageAssetStorageDeleted(db, orphan);
    assert.deepEqual(await listSoftDeletedUnreferencedAssets(db, 10), []);
});

test('sharing and copy flows use image inheritance without exposing R2 keys in public payloads', () => {
    const wordRepoSource = fs.readFileSync(new URL('../src/repositories/wordRepository.ts', import.meta.url), 'utf8');
    const sharingSource = fs.readFileSync(new URL('../src/commands/sharingCollections.ts', import.meta.url), 'utf8');
    const copyBlock = wordRepoSource.slice(
        wordRepoSource.indexOf('export async function copyWordToUser'),
        wordRepoSource.indexOf('export async function deleteWord')
    );

    assert.match(copyBlock, /copyWordImageFromSource/);
    assert.doesNotMatch(copyBlock, /r2_key|WORD_IMAGES/);
    assert.doesNotMatch(sharingSource, /r2_key|WORD_IMAGES|image_asset_id/);
    assert.match(sharingSource, /copyWordsToUser\(ctx\.db/);
});

test('word image search query builder normalizes German and Arabic words', () => {
    assert.equal(buildWordImageSearchQuery('das Auto', 'سيارة'), 'car vehicle');
    assert.equal(buildWordImageSearchQuery('der Friseur', 'الحلاق'), 'barber haircut');
    assert.equal(buildWordImageSearchQuery('Unbekanntes Wort', 'تفاح'), 'apple fruit');
    assert.equal(buildWordImageSearchQuery('Haus', 'بيت', 'small home interior'), 'small home interior');
});

test('image provider order is configurable and excludes inactive upload providers', () => {
    assert.deepEqual(getImageProviderOrder({ IMAGE_PROVIDER_ORDER: 'pexels,pixabay,unsplash,legacy' }), ['pexels', 'pixabay', 'unsplash', 'legacy']);
    assert.deepEqual(getImageProviderOrder({ IMAGE_PROVIDER_ORDER: 'manual_upload,legacy,unknown,pexels,legacy' }), ['legacy', 'pexels']);
});

test('legacy image search works without external keys or network', async () => {
    const db = createWordImageDb();
    const response = await searchWordImages(db, { IMAGE_PROVIDER_ORDER: 'legacy' }, { german: 'Tiger', arabic: 'نمر', page: 1 });
    assert.equal(response.provider, 'legacy');
    assert.equal(response.results.length, 1);
    assert.equal(response.results[0].legacyVisual, '🐯');
});

test('image URL validation blocks unsafe hosts and accepts safe HTTPS image URLs', () => {
    assert.equal(assertSafeImageUrl('https://images.pexels.com/photos/1/cat.jpeg').hostname, 'images.pexels.com');
    assert.throws(() => assertSafeImageUrl('http://images.pexels.com/photos/1/cat.jpeg'), /invalid_image_url_protocol/);
    assert.throws(() => assertSafeImageUrl('https://localhost/image.jpg'), /blocked_image_host/);
    assert.throws(() => assertSafeImageUrl('https://169.254.169.254/latest/meta-data'), /blocked_image_host/);
    assert.equal(isAllowedImageMime('image/jpeg; charset=binary'), true);
    assert.equal(isAllowedImageMime('image/svg+xml'), false);
});

test('game route exposes token-protected image endpoint without R2 key leakage in public state', () => {
    const routeSource = fs.readFileSync(new URL('../src/game/routes.ts', import.meta.url), 'utf8');
    const serviceSource = fs.readFileSync(new URL('../src/services/gameSessionService.ts', import.meta.url), 'utf8');
    assert.match(routeSource, /\/game\/api\/image/);
    assert.match(serviceSource, /getGameQuestionImageResponse/);
    assert.match(serviceSource, /imageUrlForQuestion/);
    assert.doesNotMatch(serviceSource.slice(serviceSource.indexOf('export interface PublicGameQuestion'), serviceSource.indexOf('export interface PublicGameState')), /r2_key|r2Key/);
});

test('Telegram game UI exposes word image dashboard and manual upload flow', () => {
    const gameSource = fs.readFileSync(new URL('../src/commands/game.ts', import.meta.url), 'utf8');
    const collectionsSource = fs.readFileSync(new URL('../src/commands/sharingCollections.ts', import.meta.url), 'utf8');
    assert.match(collectionsSource, /🖼 صور الكلمات/);
    assert.match(gameSource, /wi:dash/);
    assert.match(gameSource, /word_image_search/);
    assert.match(gameSource, /awaiting_manual_word_image_upload/);
    assert.match(gameSource, /downloadTelegramPhoto/);
    assert.doesNotMatch(gameSource, /غير مناسبة للصور/);
});

test('game HTML renders image questions inside the bubble and keeps win celebration', () => {
    const htmlSource = fs.readFileSync(new URL('../src/game/html.ts', import.meta.url), 'utf8');
    assert.match(htmlSource, /question\.visualType === 'image'/);
    assert.match(htmlSource, /class="question-image"/);
    assert.match(htmlSource, /image-attribution/);
    assert.match(htmlSource, /win-celebration/);
    assert.match(htmlSource, /ممتاز! أكملت المجموعة/);
});
