import type { D1Database } from '@cloudflare/workers-types';
import { queryAll, queryOne, run, runBatch } from '../db/queries';

export type WordImageProvider = 'legacy' | 'pexels' | 'pixabay' | 'unsplash' | 'manual_upload' | 'user_library';
export type WordImageStorageType = 'r2' | 'hotlink' | 'legacy' | 'telegram';
export type UserWordImageState = 'selected' | 'excluded' | 'deleted';

export interface ImageAsset {
    id: number;
    owner_user_id: number | null;
    provider: WordImageProvider;
    provider_image_id: string | null;
    storage_type: WordImageStorageType;
    r2_key: string | null;
    hotlink_url: string | null;
    preview_url: string | null;
    source_page_url: string | null;
    photographer_name: string | null;
    photographer_url: string | null;
    attribution_text: string | null;
    download_tracking_url: string | null;
    search_query: string | null;
    width: number | null;
    height: number | null;
    mime_type: string | null;
    file_size: number | null;
    sha256: string | null;
    telegram_file_id: string | null;
    status: 'active' | 'deleted' | 'orphaned';
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
}

export interface UserWordImage {
    id: number;
    user_id: number;
    collection_id: number;
    word_id: number;
    image_asset_id: number | null;
    state: UserWordImageState;
    excluded_reason: string | null;
    selected_at: string | null;
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
}

export interface ActiveWordImage extends UserWordImage {
    asset_id: number | null;
    provider: WordImageProvider | null;
    storage_type: WordImageStorageType | null;
    r2_key: string | null;
    hotlink_url: string | null;
    preview_url: string | null;
    source_page_url: string | null;
    attribution_text: string | null;
    telegram_file_id: string | null;
    asset_status: string | null;
}

export interface CollectionImageReadiness {
    totalWords: number;
    selectedWords: number;
    excludedWords: number;
    missingWords: number;
    playableImageWords: number;
    isReady: boolean;
}

export interface MissingImageWord {
    word_id: number;
    german: string;
    arabic: string;
    example: string | null;
}

export interface ImageModeWord extends MissingImageWord {
    image_asset_id: number;
    provider: WordImageProvider;
    storage_type: WordImageStorageType;
    attribution_text: string | null;
}

export interface CreateImageAssetInput {
    ownerUserId?: number | null;
    provider: WordImageProvider;
    providerImageId?: string | null;
    storageType: WordImageStorageType;
    r2Key?: string | null;
    hotlinkUrl?: string | null;
    previewUrl?: string | null;
    sourcePageUrl?: string | null;
    photographerName?: string | null;
    photographerUrl?: string | null;
    attributionText?: string | null;
    downloadTrackingUrl?: string | null;
    searchQuery?: string | null;
    width?: number | null;
    height?: number | null;
    mimeType?: string | null;
    fileSize?: number | null;
    sha256?: string | null;
    telegramFileId?: string | null;
}

export async function createImageAsset(db: D1Database, input: CreateImageAssetInput): Promise<number> {
    const result = await run(
        db,
        `INSERT INTO image_assets (
            owner_user_id, provider, provider_image_id, storage_type, r2_key, hotlink_url, preview_url,
            source_page_url, photographer_name, photographer_url, attribution_text, download_tracking_url,
            search_query, width, height, mime_type, file_size, sha256, telegram_file_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            input.ownerUserId ?? null,
            input.provider,
            input.providerImageId ?? null,
            input.storageType,
            input.r2Key ?? null,
            input.hotlinkUrl ?? null,
            input.previewUrl ?? null,
            input.sourcePageUrl ?? null,
            input.photographerName ?? null,
            input.photographerUrl ?? null,
            input.attributionText ?? null,
            input.downloadTrackingUrl ?? null,
            input.searchQuery ?? null,
            input.width ?? null,
            input.height ?? null,
            input.mimeType ?? null,
            input.fileSize ?? null,
            input.sha256 ?? null,
            input.telegramFileId ?? null,
        ]
    );
    return (result.meta as { last_row_id?: number })?.last_row_id ?? 0;
}

export async function getImageAssetById(db: D1Database, assetId: number): Promise<ImageAsset | null> {
    return queryOne<ImageAsset>(
        db,
        `SELECT * FROM image_assets WHERE id = ? AND status = 'active' AND deleted_at IS NULL`,
        [assetId]
    );
}

export async function getActiveWordImage(
    db: D1Database,
    userId: number,
    collectionId: number,
    wordId: number
): Promise<ActiveWordImage | null> {
    return queryOne<ActiveWordImage>(
        db,
        `SELECT uwi.*,
                ia.id AS asset_id,
                ia.provider,
                ia.storage_type,
                ia.r2_key,
                ia.hotlink_url,
                ia.preview_url,
                ia.source_page_url,
                ia.attribution_text,
                ia.telegram_file_id,
                ia.status AS asset_status
         FROM user_word_images uwi
         INNER JOIN image_assets ia ON ia.id = uwi.image_asset_id
         INNER JOIN word_collections c ON c.id = uwi.collection_id
         INNER JOIN word_collection_items i ON i.collection_id = uwi.collection_id AND i.word_id = uwi.word_id
         INNER JOIN words w ON w.word_id = uwi.word_id
         WHERE uwi.user_id = ?
           AND uwi.collection_id = ?
           AND uwi.word_id = ?
           AND uwi.state = 'selected'
           AND uwi.deleted_at IS NULL
           AND ia.status = 'active'
           AND ia.deleted_at IS NULL
           AND c.owner_user_id = ?
           AND c.is_deleted = 0
           AND w.added_by = ?
         LIMIT 1`,
        [userId, collectionId, wordId, userId, userId]
    );
}

export async function getWordImageState(
    db: D1Database,
    userId: number,
    collectionId: number,
    wordId: number
): Promise<UserWordImage | null> {
    return queryOne<UserWordImage>(
        db,
        `SELECT uwi.*
         FROM user_word_images uwi
         INNER JOIN word_collections c ON c.id = uwi.collection_id
         INNER JOIN word_collection_items i ON i.collection_id = uwi.collection_id AND i.word_id = uwi.word_id
         INNER JOIN words w ON w.word_id = uwi.word_id
         WHERE uwi.user_id = ?
           AND uwi.collection_id = ?
           AND uwi.word_id = ?
           AND uwi.deleted_at IS NULL
           AND c.owner_user_id = ?
           AND c.is_deleted = 0
           AND w.added_by = ?
         LIMIT 1`,
        [userId, collectionId, wordId, userId, userId]
    );
}

export async function getCollectionImageReadiness(
    db: D1Database,
    userId: number,
    collectionId: number
): Promise<CollectionImageReadiness> {
    const row = await queryOne<{
        total_words: number;
        selected_words: number;
        excluded_words: number;
    }>(
        db,
        `SELECT COUNT(DISTINCT i.word_id) AS total_words,
                COUNT(DISTINCT CASE
                    WHEN uwi.state = 'selected'
                     AND uwi.deleted_at IS NULL
                     AND ia.id IS NOT NULL
                     AND ia.status = 'active'
                     AND ia.deleted_at IS NULL THEN i.word_id END
                ) AS selected_words,
                COUNT(DISTINCT CASE
                    WHEN uwi.state = 'excluded'
                     AND uwi.deleted_at IS NULL THEN i.word_id END
                ) AS excluded_words
         FROM word_collections c
         LEFT JOIN word_collection_items i ON i.collection_id = c.id
         LEFT JOIN user_word_images uwi ON uwi.user_id = c.owner_user_id
            AND uwi.collection_id = c.id
            AND uwi.word_id = i.word_id
            AND uwi.deleted_at IS NULL
         LEFT JOIN image_assets ia ON ia.id = uwi.image_asset_id
         WHERE c.id = ?
           AND c.owner_user_id = ?
           AND c.is_deleted = 0`,
        [collectionId, userId]
    );
    const totalWords = row?.total_words ?? 0;
    const selectedWords = row?.selected_words ?? 0;
    const excludedWords = row?.excluded_words ?? 0;
    const missingWords = Math.max(0, totalWords - selectedWords - excludedWords);
    return {
        totalWords,
        selectedWords,
        excludedWords,
        missingWords,
        playableImageWords: selectedWords,
        isReady: selectedWords > 0 && missingWords === 0,
    };
}

export async function listMissingImageWords(
    db: D1Database,
    userId: number,
    collectionId: number,
    limit = 10,
    offset = 0
): Promise<MissingImageWord[]> {
    return queryAll<MissingImageWord>(
        db,
        `SELECT w.word_id, w.german, w.arabic, w.example
         FROM word_collections c
         INNER JOIN word_collection_items i ON i.collection_id = c.id
         INNER JOIN words w ON w.word_id = i.word_id
         LEFT JOIN user_word_images uwi ON uwi.user_id = c.owner_user_id
            AND uwi.collection_id = c.id
            AND uwi.word_id = w.word_id
            AND uwi.deleted_at IS NULL
            AND uwi.state IN ('selected', 'excluded')
         LEFT JOIN image_assets ia ON ia.id = uwi.image_asset_id
         WHERE c.id = ?
           AND c.owner_user_id = ?
           AND c.is_deleted = 0
           AND w.added_by = ?
           AND (
                uwi.id IS NULL
             OR (uwi.state = 'selected' AND (ia.id IS NULL OR ia.status != 'active' OR ia.deleted_at IS NOT NULL))
           )
         ORDER BY i.position ASC, i.id ASC
         LIMIT ? OFFSET ?`,
        [collectionId, userId, userId, Math.max(1, Math.min(50, limit)), Math.max(0, offset)]
    );
}

export async function listExcludedImageWords(
    db: D1Database,
    userId: number,
    collectionId: number,
    limit = 10,
    offset = 0
): Promise<Array<MissingImageWord & { excluded_reason: string | null }>> {
    return queryAll<MissingImageWord & { excluded_reason: string | null }>(
        db,
        `SELECT w.word_id, w.german, w.arabic, w.example, uwi.excluded_reason
         FROM user_word_images uwi
         INNER JOIN word_collections c ON c.id = uwi.collection_id
         INNER JOIN word_collection_items i ON i.collection_id = uwi.collection_id AND i.word_id = uwi.word_id
         INNER JOIN words w ON w.word_id = uwi.word_id
         WHERE uwi.user_id = ?
           AND uwi.collection_id = ?
           AND uwi.state = 'excluded'
           AND uwi.deleted_at IS NULL
           AND c.owner_user_id = ?
           AND c.is_deleted = 0
           AND w.added_by = ?
         ORDER BY i.position ASC, i.id ASC
         LIMIT ? OFFSET ?`,
        [userId, collectionId, userId, userId, Math.max(1, Math.min(50, limit)), Math.max(0, offset)]
    );
}

export async function getImageModeWordsForCollection(
    db: D1Database,
    userId: number,
    collectionId: number,
    limit = 100
): Promise<ImageModeWord[]> {
    return queryAll<ImageModeWord>(
        db,
        `SELECT w.word_id,
                w.german,
                w.arabic,
                w.example,
                ia.id AS image_asset_id,
                ia.provider,
                ia.storage_type,
                ia.attribution_text
         FROM word_collections c
         INNER JOIN word_collection_items i ON i.collection_id = c.id
         INNER JOIN words w ON w.word_id = i.word_id
         INNER JOIN user_word_images uwi ON uwi.user_id = c.owner_user_id
            AND uwi.collection_id = c.id
            AND uwi.word_id = w.word_id
            AND uwi.state = 'selected'
            AND uwi.deleted_at IS NULL
         INNER JOIN image_assets ia ON ia.id = uwi.image_asset_id
            AND ia.status = 'active'
            AND ia.deleted_at IS NULL
         WHERE c.id = ?
           AND c.owner_user_id = ?
           AND c.is_deleted = 0
           AND w.added_by = ?
         ORDER BY i.position ASC, i.id ASC
         LIMIT ?`,
        [collectionId, userId, userId, Math.max(1, Math.min(100, limit))]
    );
}

export async function selectWordImage(
    db: D1Database,
    userId: number,
    collectionId: number,
    wordId: number,
    imageAssetId: number
): Promise<void> {
    await assertOwnedCollectionWord(db, userId, collectionId, wordId);
    await assertUsableAsset(db, userId, imageAssetId);
    await runBatch(db, [
        {
            sql: `UPDATE user_word_images
                  SET state = 'deleted', deleted_at = datetime('now'), updated_at = datetime('now')
                  WHERE user_id = ? AND collection_id = ? AND word_id = ? AND deleted_at IS NULL`,
            params: [userId, collectionId, wordId],
        },
        {
            sql: `INSERT INTO user_word_images (
                    user_id, collection_id, word_id, image_asset_id, state, selected_at, created_at, updated_at
                  ) VALUES (?, ?, ?, ?, 'selected', datetime('now'), datetime('now'), datetime('now'))`,
            params: [userId, collectionId, wordId, imageAssetId],
        },
    ]);
}

export async function excludeWordFromImageMode(
    db: D1Database,
    userId: number,
    collectionId: number,
    wordId: number,
    reason = 'manual'
): Promise<void> {
    await assertOwnedCollectionWord(db, userId, collectionId, wordId);
    await runBatch(db, [
        {
            sql: `UPDATE user_word_images
                  SET state = 'deleted', deleted_at = datetime('now'), updated_at = datetime('now')
                  WHERE user_id = ? AND collection_id = ? AND word_id = ? AND deleted_at IS NULL`,
            params: [userId, collectionId, wordId],
        },
        {
            sql: `INSERT INTO user_word_images (
                    user_id, collection_id, word_id, image_asset_id, state, excluded_reason, created_at, updated_at
                  ) VALUES (?, ?, ?, NULL, 'excluded', ?, datetime('now'), datetime('now'))`,
            params: [userId, collectionId, wordId, reason.slice(0, 80)],
        },
    ]);
}

export async function restoreExcludedWord(
    db: D1Database,
    userId: number,
    collectionId: number,
    wordId: number
): Promise<void> {
    await assertOwnedCollectionWord(db, userId, collectionId, wordId);
    await run(
        db,
        `UPDATE user_word_images
         SET state = 'deleted', deleted_at = datetime('now'), updated_at = datetime('now')
         WHERE user_id = ? AND collection_id = ? AND word_id = ? AND state = 'excluded' AND deleted_at IS NULL`,
        [userId, collectionId, wordId]
    );
}

export async function removeWordImage(
    db: D1Database,
    userId: number,
    collectionId: number,
    wordId: number
): Promise<void> {
    await assertOwnedCollectionWord(db, userId, collectionId, wordId);
    await run(
        db,
        `UPDATE user_word_images
         SET state = 'deleted', deleted_at = datetime('now'), updated_at = datetime('now')
         WHERE user_id = ? AND collection_id = ? AND word_id = ? AND deleted_at IS NULL`,
        [userId, collectionId, wordId]
    );
}

export async function listUserImageLibrary(db: D1Database, userId: number, limit = 20, offset = 0): Promise<ImageAsset[]> {
    return queryAll<ImageAsset>(
        db,
        `SELECT DISTINCT ia.*
         FROM image_assets ia
         LEFT JOIN user_word_images uwi ON uwi.image_asset_id = ia.id
            AND uwi.user_id = ?
            AND uwi.deleted_at IS NULL
         WHERE ia.status = 'active'
           AND ia.deleted_at IS NULL
           AND (
                ia.owner_user_id = ?
             OR uwi.id IS NOT NULL
           )
         ORDER BY ia.updated_at DESC, ia.id DESC
         LIMIT ? OFFSET ?`,
        [userId, userId, Math.max(1, Math.min(50, limit)), Math.max(0, offset)]
    );
}

export async function countImageAssetReferences(db: D1Database, imageAssetId: number): Promise<number> {
    const row = await queryOne<{ count: number }>(
        db,
        `SELECT COUNT(*) AS count
         FROM user_word_images
         WHERE image_asset_id = ?
           AND deleted_at IS NULL
           AND state = 'selected'`,
        [imageAssetId]
    );
    return row?.count ?? 0;
}

export async function softDeleteImageAsset(db: D1Database, userId: number, imageAssetId: number): Promise<void> {
    const refs = await countImageAssetReferences(db, imageAssetId);
    if (refs > 0) throw new Error('image_asset_in_use');
    await run(
        db,
        `UPDATE image_assets
         SET status = 'deleted', deleted_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ? AND owner_user_id = ?`,
        [imageAssetId, userId]
    );
}

export async function deleteExpiredImageSearchCache(db: D1Database): Promise<number> {
    const result = await run(db, `DELETE FROM image_search_cache WHERE expires_at <= datetime('now')`);
    return (result.meta as { changes?: number } | undefined)?.changes ?? 0;
}

export async function markOrphanImageAssets(db: D1Database, graceHours = 24): Promise<number> {
    const result = await run(
        db,
        `UPDATE image_assets
         SET status = 'orphaned',
             deleted_at = COALESCE(deleted_at, datetime('now')),
             updated_at = datetime('now')
         WHERE status = 'active'
           AND owner_user_id IS NOT NULL
           AND created_at <= datetime('now', '-' || ? || ' hours')
           AND NOT EXISTS (
                SELECT 1 FROM user_word_images uwi
                WHERE uwi.image_asset_id = image_assets.id
                  AND uwi.deleted_at IS NULL
                  AND uwi.state = 'selected'
           )`,
        [Math.max(1, Math.min(720, graceHours))]
    );
    return (result.meta as { changes?: number } | undefined)?.changes ?? 0;
}

export async function listSoftDeletedUnreferencedAssets(
    db: D1Database,
    limit = 25
): Promise<Array<Pick<ImageAsset, 'id' | 'r2_key' | 'storage_type'>>> {
    return queryAll<Pick<ImageAsset, 'id' | 'r2_key' | 'storage_type'>>(
        db,
        `SELECT id, r2_key, storage_type
         FROM image_assets
         WHERE status IN ('deleted', 'orphaned')
           AND deleted_at IS NOT NULL
           AND storage_type = 'r2'
           AND r2_key IS NOT NULL
           AND NOT EXISTS (
                SELECT 1 FROM user_word_images uwi
                WHERE uwi.image_asset_id = image_assets.id
                  AND uwi.deleted_at IS NULL
                  AND uwi.state = 'selected'
           )
         ORDER BY deleted_at ASC, id ASC
         LIMIT ?`,
        [Math.max(1, Math.min(100, limit))]
    );
}

export async function markImageAssetStorageDeleted(db: D1Database, imageAssetId: number): Promise<void> {
    await run(
        db,
        `UPDATE image_assets
         SET r2_key = NULL,
             updated_at = datetime('now')
         WHERE id = ?
           AND status IN ('deleted', 'orphaned')
           AND storage_type = 'r2'
           AND NOT EXISTS (
                SELECT 1 FROM user_word_images uwi
                WHERE uwi.image_asset_id = image_assets.id
                  AND uwi.deleted_at IS NULL
                  AND uwi.state = 'selected'
           )`,
        [imageAssetId]
    );
}

export async function getCollectionWordForImage(
    db: D1Database,
    userId: number,
    collectionId: number,
    wordId: number
): Promise<MissingImageWord | null> {
    return queryOne<MissingImageWord>(
        db,
        `SELECT w.word_id, w.german, w.arabic, w.example
         FROM word_collections c
         INNER JOIN word_collection_items i ON i.collection_id = c.id
         INNER JOIN words w ON w.word_id = i.word_id
         WHERE c.id = ?
           AND c.owner_user_id = ?
           AND c.is_deleted = 0
           AND w.word_id = ?
           AND w.added_by = ?
         LIMIT 1`,
        [collectionId, userId, wordId, userId]
    );
}

async function assertOwnedCollectionWord(
    db: D1Database,
    userId: number,
    collectionId: number,
    wordId: number
): Promise<void> {
    const row = await getCollectionWordForImage(db, userId, collectionId, wordId);
    if (!row) throw new Error('word_image_not_allowed');
}

async function assertUsableAsset(db: D1Database, userId: number, imageAssetId: number): Promise<void> {
    const asset = await getImageAssetById(db, imageAssetId);
    if (!asset) throw new Error('image_asset_not_found');
    if (asset.owner_user_id !== null && asset.owner_user_id !== userId) {
        throw new Error('image_asset_not_allowed');
    }
}
