import type { D1Database } from '@cloudflare/workers-types';
import { queryAll, queryOne, run, runBatch } from '../db/queries';
import { buildWordImageFingerprint } from '../services/wordImageFingerprint';

export type WordImageProvider = 'legacy' | 'pexels' | 'pixabay' | 'unsplash' | 'manual_upload' | 'user_library';
export type WordImageStorageType = 'r2' | 'hotlink' | 'legacy' | 'telegram';
export type UserWordImageState = 'selected' | 'excluded' | 'deleted';
export type ImageAssetVisibility = 'private' | 'shared' | 'global';
export type WordImageOriginType = 'user_selected' | 'copied_word' | 'copied_collection' | 'admin_default' | 'community_shared' | 'legacy_default';

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
    visibility: ImageAssetVisibility;
    source_asset_id: number | null;
    published_at: string | null;
    reusable: number;
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
    origin_type: WordImageOriginType;
    origin_user_id: number | null;
    origin_share_type: string | null;
    origin_share_id: number | null;
    is_user_override: number;
    inherited_at: string | null;
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

export interface EffectiveWordImage extends ActiveWordImage {
    inherited: boolean;
    canEdit: boolean;
    canRemove: boolean;
    canRevertToInherited: boolean;
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
    visibility?: ImageAssetVisibility;
    sourceAssetId?: number | null;
    publishedAt?: string | null;
    reusable?: boolean;
}

export async function createImageAsset(db: D1Database, input: CreateImageAssetInput): Promise<number> {
    const result = await run(
        db,
        `INSERT INTO image_assets (
            owner_user_id, provider, provider_image_id, storage_type, r2_key, hotlink_url, preview_url,
            source_page_url, photographer_name, photographer_url, attribution_text, download_tracking_url,
            search_query, width, height, mime_type, file_size, sha256, telegram_file_id,
            visibility, source_asset_id, published_at, reusable
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
            input.visibility ?? 'private',
            input.sourceAssetId ?? null,
            input.publishedAt ?? null,
            input.reusable ? 1 : 0,
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
    const words = await queryAll<{ word_id: number }>(
        db,
        `SELECT i.word_id
         FROM word_collections c
         INNER JOIN word_collection_items i ON i.collection_id = c.id
         INNER JOIN words w ON w.word_id = i.word_id
         WHERE c.id = ? AND c.owner_user_id = ? AND c.is_deleted = 0 AND w.added_by = ?
         ORDER BY i.position ASC, i.id ASC`,
        [collectionId, userId, userId]
    );
    let selectedWords = 0;
    let excludedWords = 0;
    for (const word of words) {
        const state = await getWordImageState(db, userId, collectionId, word.word_id);
        if (state?.state === 'excluded') {
            excludedWords++;
            continue;
        }
        if (await resolveEffectiveWordImage(db, userId, word.word_id, collectionId)) selectedWords++;
    }
    const totalWords = words.length;
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
    const rows = await queryAll<MissingImageWord>(
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
    const missing: MissingImageWord[] = [];
    for (const word of rows) {
        if (!(await resolveEffectiveWordImage(db, userId, word.word_id, collectionId))) missing.push(word);
    }
    return missing;
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
    const words = await queryAll<MissingImageWord>(
        db,
        `SELECT w.word_id, w.german, w.arabic, w.example
         FROM word_collections c
         INNER JOIN word_collection_items i ON i.collection_id = c.id
         INNER JOIN words w ON w.word_id = i.word_id
         WHERE c.id = ?
           AND c.owner_user_id = ?
           AND c.is_deleted = 0
           AND w.added_by = ?
         ORDER BY i.position ASC, i.id ASC
         LIMIT ?`,
        [collectionId, userId, userId, Math.max(1, Math.min(100, limit))]
    );
    const out: ImageModeWord[] = [];
    for (const word of words) {
        const image = await resolveEffectiveWordImage(db, userId, word.word_id, collectionId);
        if (!image?.asset_id || !image.provider || !image.storage_type) continue;
        out.push({
            ...word,
            image_asset_id: image.asset_id,
            provider: image.provider,
            storage_type: image.storage_type,
            attribution_text: image.attribution_text,
        });
    }
    return out;
}

export async function selectWordImage(
    db: D1Database,
    userId: number,
    collectionId: number,
    wordId: number,
    imageAssetId: number,
    options: { originType?: WordImageOriginType; isAdminDefault?: boolean } = {}
): Promise<void> {
    await assertOwnedCollectionWord(db, userId, collectionId, wordId);
    await assertUsableAsset(db, userId, imageAssetId);
    const originType = options.originType ?? 'user_selected';
    await runBatch(db, [
        {
            sql: `UPDATE user_word_images
                  SET state = 'deleted', deleted_at = datetime('now'), updated_at = datetime('now')
                  WHERE user_id = ? AND collection_id = ? AND word_id = ? AND deleted_at IS NULL`,
            params: [userId, collectionId, wordId],
        },
        {
            sql: `INSERT INTO user_word_images (
                    user_id, collection_id, word_id, image_asset_id, state, origin_type, origin_user_id,
                    is_user_override, inherited_at, selected_at, created_at, updated_at
                  ) VALUES (?, ?, ?, ?, 'selected', ?, ?, 1, NULL, datetime('now'), datetime('now'), datetime('now'))`,
            params: [userId, collectionId, wordId, imageAssetId, originType, userId],
        },
    ]);
    await setWordDefaultImage(db, userId, wordId, imageAssetId, {
        originType,
        originUserId: userId,
        isUserOverride: true,
    });
    if (options.isAdminDefault) await publishAdminWordImageDefault(db, userId, wordId, collectionId, imageAssetId);
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
                    user_id, collection_id, word_id, image_asset_id, state, excluded_reason, origin_type,
                    is_user_override, created_at, updated_at
                  ) VALUES (?, ?, ?, NULL, 'excluded', ?, 'user_selected', 1, datetime('now'), datetime('now'))`,
            params: [userId, collectionId, wordId, reason.slice(0, 80)],
        },
    ]);
    await setWordDefaultExcluded(db, userId, wordId);
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
    await clearWordDefaultImage(db, userId, wordId);
}

export async function setWordDefaultImage(
    db: D1Database,
    userId: number,
    wordId: number,
    imageAssetId: number,
    options: {
        originType: WordImageOriginType;
        originUserId?: number | null;
        originShareType?: string | null;
        originShareId?: number | null;
        isUserOverride?: boolean;
    }
): Promise<void> {
    await runBatch(db, [
        {
            sql: `UPDATE user_word_default_images
                  SET state = 'deleted', deleted_at = datetime('now'), updated_at = datetime('now')
                  WHERE user_id = ? AND word_id = ? AND deleted_at IS NULL`,
            params: [userId, wordId],
        },
        {
            sql: `INSERT INTO user_word_default_images (
                    user_id, word_id, image_asset_id, state, origin_type, origin_user_id,
                    origin_share_type, origin_share_id, is_user_override, inherited_at, created_at, updated_at
                  ) VALUES (?, ?, ?, 'selected', ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
            params: [
                userId,
                wordId,
                imageAssetId,
                options.originType,
                options.originUserId ?? null,
                options.originShareType ?? null,
                options.originShareId ?? null,
                options.isUserOverride === false ? 0 : 1,
                options.isUserOverride === false ? new Date().toISOString() : null,
            ],
        },
    ]);
}

export async function setWordDefaultExcluded(db: D1Database, userId: number, wordId: number): Promise<void> {
    await runBatch(db, [
        {
            sql: `UPDATE user_word_default_images
                  SET state = 'deleted', deleted_at = datetime('now'), updated_at = datetime('now')
                  WHERE user_id = ? AND word_id = ? AND deleted_at IS NULL`,
            params: [userId, wordId],
        },
        {
            sql: `INSERT INTO user_word_default_images (
                    user_id, word_id, image_asset_id, state, origin_type, is_user_override, created_at, updated_at
                  ) VALUES (?, ?, NULL, 'excluded', 'user_selected', 1, datetime('now'), datetime('now'))`,
            params: [userId, wordId],
        },
    ]);
}

export async function clearWordDefaultImage(db: D1Database, userId: number, wordId: number): Promise<void> {
    await run(
        db,
        `UPDATE user_word_default_images
         SET state = 'deleted', deleted_at = datetime('now'), updated_at = datetime('now')
         WHERE user_id = ? AND word_id = ? AND deleted_at IS NULL`,
        [userId, wordId]
    );
}

export async function resolveEffectiveWordImage(
    db: D1Database,
    userId: number,
    wordId: number,
    collectionId?: number | null
): Promise<EffectiveWordImage | null> {
    if (collectionId) {
        const explicit = await getActiveWordImage(db, userId, collectionId, wordId);
        if (explicit) return { ...explicit, inherited: false, canEdit: true, canRemove: true, canRevertToInherited: false };
        const state = await getWordImageState(db, userId, collectionId, wordId);
        if (state?.state === 'excluded') return null;
    }

    const defaultImage = await queryOne<ActiveWordImage>(
        db,
        `SELECT uwdi.id,
                uwdi.user_id,
                0 AS collection_id,
                uwdi.word_id,
                uwdi.image_asset_id,
                uwdi.state,
                NULL AS excluded_reason,
                uwdi.origin_type,
                uwdi.origin_user_id,
                uwdi.origin_share_type,
                uwdi.origin_share_id,
                uwdi.is_user_override,
                uwdi.inherited_at,
                uwdi.created_at,
                uwdi.updated_at,
                uwdi.deleted_at,
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
         FROM user_word_default_images uwdi
         INNER JOIN image_assets ia ON ia.id = uwdi.image_asset_id
         INNER JOIN words w ON w.word_id = uwdi.word_id
         WHERE uwdi.user_id = ?
           AND uwdi.word_id = ?
           AND uwdi.state = 'selected'
           AND uwdi.deleted_at IS NULL
           AND ia.status = 'active'
           AND ia.deleted_at IS NULL
           AND w.added_by = ?
         LIMIT 1`,
        [userId, wordId, userId]
    );
    if (defaultImage) {
        return {
            ...defaultImage,
            inherited: defaultImage.is_user_override === 0,
            canEdit: true,
            canRemove: true,
            canRevertToInherited: defaultImage.is_user_override === 1,
        };
    }

    const excludedDefault = await queryOne<{ id: number }>(
        db,
        `SELECT id FROM user_word_default_images
         WHERE user_id = ? AND word_id = ? AND state = 'excluded' AND deleted_at IS NULL
         LIMIT 1`,
        [userId, wordId]
    );
    if (excludedDefault) return null;

    const catalog = await findBestCatalogImageForWord(db, wordId);
    if (!catalog) return null;
    return catalogToEffective(userId, wordId, catalog);
}

export async function inheritBestImageForWord(
    db: D1Database,
    userId: number,
    wordId: number,
    originType?: WordImageOriginType
): Promise<boolean> {
    if (await hasActiveDefaultImageOrExclusion(db, userId, wordId)) return false;
    const catalog = await findBestCatalogImageForWord(db, wordId);
    if (!catalog) return false;
    await setWordDefaultImage(db, userId, wordId, catalog.image_asset_id, {
        originType: originType ?? originTypeForCatalog(catalog.source_type),
        originUserId: catalog.source_user_id,
        originShareType: catalog.source_share_type,
        originShareId: catalog.source_share_id,
        isUserOverride: false,
    });
    await run(db, `UPDATE word_image_catalog SET usage_count = usage_count + 1, updated_at = datetime('now') WHERE id = ?`, [catalog.id]);
    return true;
}

export async function copyWordImageFromSource(
    db: D1Database,
    sourceWordId: number,
    targetUserId: number,
    targetWordId: number,
    options: { sourceCollectionId?: number | null; originType?: 'copied_word' | 'copied_collection'; shareType?: string | null; shareId?: number | null } = {}
): Promise<boolean> {
    if (await hasActiveDefaultImageOrExclusion(db, targetUserId, targetWordId)) return false;
    const source = await queryOne<{ added_by: number }>(db, `SELECT added_by FROM words WHERE word_id = ?`, [sourceWordId]);
    if (!source) return false;
    const explicit = await resolveEffectiveWordImage(db, source.added_by, sourceWordId, options.sourceCollectionId ?? null);
    if (explicit?.asset_id) {
        await setWordDefaultImage(db, targetUserId, targetWordId, explicit.asset_id, {
            originType: options.originType ?? 'copied_word',
            originUserId: source.added_by,
            originShareType: options.shareType ?? null,
            originShareId: options.shareId ?? null,
            isUserOverride: false,
        });
        await markAssetShared(db, explicit.asset_id);
        return true;
    }
    return inheritBestImageForWord(db, targetUserId, targetWordId);
}

export async function publishAdminWordImageDefault(
    db: D1Database,
    adminUserId: number,
    wordId: number,
    collectionId: number | null,
    imageAssetId: number
): Promise<void> {
    const fingerprint = await ensureWordImageFingerprint(db, wordId);
    if (!fingerprint) return;
    await markAssetGlobal(db, imageAssetId);
    await run(
        db,
        `INSERT INTO word_image_catalog (
            fingerprint, image_asset_id, source_type, source_user_id, source_word_id,
            source_collection_id, priority, status, created_at, updated_at
         ) VALUES (?, ?, 'admin', ?, ?, ?, 100, 'active', datetime('now'), datetime('now'))
         ON CONFLICT(fingerprint) WHERE source_type = 'admin' AND status = 'active' AND deleted_at IS NULL
         DO UPDATE SET
            image_asset_id = excluded.image_asset_id,
            source_user_id = excluded.source_user_id,
            source_word_id = excluded.source_word_id,
            source_collection_id = excluded.source_collection_id,
            priority = excluded.priority,
            updated_at = datetime('now')`,
        [fingerprint, imageAssetId, adminUserId, wordId, collectionId]
    );
}

export async function createShareImageSnapshotsForWords(
    db: D1Database,
    shareType: 'word' | 'collection' | 'offer',
    shareId: number,
    sourceUserId: number,
    wordIds: number[],
    sourceCollectionId?: number | null
): Promise<number> {
    let created = 0;
    for (const wordId of Array.from(new Set(wordIds)).slice(0, 200)) {
        const image = await resolveEffectiveWordImage(db, sourceUserId, wordId, sourceCollectionId ?? null);
        const fingerprint = await ensureWordImageFingerprint(db, wordId);
        await run(
            db,
            `INSERT OR REPLACE INTO shared_word_image_snapshots (
                share_type, share_id, source_user_id, source_collection_id, source_word_id,
                fingerprint, image_asset_id, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
            [shareType, shareId, sourceUserId, sourceCollectionId ?? null, wordId, fingerprint, image?.asset_id ?? null]
        );
        if (image?.asset_id && fingerprint) {
            await markAssetShared(db, image.asset_id);
            await upsertCommunityCatalog(db, fingerprint, image.asset_id, sourceUserId, wordId, sourceCollectionId ?? null, shareType, shareId);
        }
        created++;
    }
    return created;
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
        `SELECT
            (SELECT COUNT(*) FROM user_word_images WHERE image_asset_id = ? AND deleted_at IS NULL AND state = 'selected')
          + (SELECT COUNT(*) FROM user_word_default_images WHERE image_asset_id = ? AND deleted_at IS NULL AND state = 'selected')
          + (SELECT COUNT(*) FROM shared_word_image_snapshots WHERE image_asset_id = ?)
          + (SELECT COUNT(*) FROM word_image_catalog WHERE image_asset_id = ? AND status = 'active' AND deleted_at IS NULL)
          AS count`,
        [imageAssetId, imageAssetId, imageAssetId, imageAssetId]
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
           )
           AND NOT EXISTS (
                SELECT 1 FROM user_word_default_images uwdi
                WHERE uwdi.image_asset_id = image_assets.id
                  AND uwdi.deleted_at IS NULL
                  AND uwdi.state = 'selected'
           )
           AND NOT EXISTS (
                SELECT 1 FROM shared_word_image_snapshots s
                WHERE s.image_asset_id = image_assets.id
           )
           AND NOT EXISTS (
                SELECT 1 FROM word_image_catalog c
                WHERE c.image_asset_id = image_assets.id
                  AND c.status = 'active'
                  AND c.deleted_at IS NULL
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
           AND NOT EXISTS (
                SELECT 1 FROM user_word_default_images uwdi
                WHERE uwdi.image_asset_id = image_assets.id
                  AND uwdi.deleted_at IS NULL
                  AND uwdi.state = 'selected'
           )
           AND NOT EXISTS (
                SELECT 1 FROM shared_word_image_snapshots s
                WHERE s.image_asset_id = image_assets.id
           )
           AND NOT EXISTS (
                SELECT 1 FROM word_image_catalog c
                WHERE c.image_asset_id = image_assets.id
                  AND c.status = 'active'
                  AND c.deleted_at IS NULL
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
           )
           AND NOT EXISTS (
                SELECT 1 FROM user_word_default_images uwdi
                WHERE uwdi.image_asset_id = image_assets.id
                  AND uwdi.deleted_at IS NULL
                  AND uwdi.state = 'selected'
           )
           AND NOT EXISTS (
                SELECT 1 FROM shared_word_image_snapshots s
                WHERE s.image_asset_id = image_assets.id
           )
           AND NOT EXISTS (
                SELECT 1 FROM word_image_catalog c
                WHERE c.image_asset_id = image_assets.id
                  AND c.status = 'active'
                  AND c.deleted_at IS NULL
           )`,
        [imageAssetId]
    );
}

interface CatalogImageRow {
    id: number;
    fingerprint: string;
    image_asset_id: number;
    source_type: 'admin' | 'community_shared' | 'legacy';
    source_user_id: number | null;
    source_word_id: number | null;
    source_collection_id: number | null;
    source_share_type: string | null;
    source_share_id: number | null;
    priority: number;
    provider: WordImageProvider;
    storage_type: WordImageStorageType;
    r2_key: string | null;
    hotlink_url: string | null;
    preview_url: string | null;
    source_page_url: string | null;
    attribution_text: string | null;
    telegram_file_id: string | null;
    asset_status: string;
}

async function findBestCatalogImageForWord(db: D1Database, wordId: number): Promise<CatalogImageRow | null> {
    const fingerprint = await ensureWordImageFingerprint(db, wordId);
    if (!fingerprint) return null;
    return queryOne<CatalogImageRow>(
        db,
        `SELECT c.*,
                ia.provider,
                ia.storage_type,
                ia.r2_key,
                ia.hotlink_url,
                ia.preview_url,
                ia.source_page_url,
                ia.attribution_text,
                ia.telegram_file_id,
                ia.status AS asset_status
         FROM word_image_catalog c
         INNER JOIN image_assets ia ON ia.id = c.image_asset_id
         WHERE c.fingerprint = ?
           AND c.status = 'active'
           AND c.deleted_at IS NULL
           AND ia.status = 'active'
           AND ia.deleted_at IS NULL
           AND ia.visibility IN ('shared', 'global')
         ORDER BY
            CASE c.source_type WHEN 'admin' THEN 0 WHEN 'community_shared' THEN 1 ELSE 2 END,
            c.priority DESC,
            c.usage_count DESC,
            c.updated_at DESC,
            c.id DESC
         LIMIT 1`,
        [fingerprint]
    );
}

async function hasActiveDefaultImageOrExclusion(db: D1Database, userId: number, wordId: number): Promise<boolean> {
    const row = await queryOne<{ id: number }>(
        db,
        `SELECT id FROM user_word_default_images
         WHERE user_id = ? AND word_id = ? AND deleted_at IS NULL AND state IN ('selected', 'excluded')
         LIMIT 1`,
        [userId, wordId]
    );
    return Boolean(row);
}

async function ensureWordImageFingerprint(db: D1Database, wordId: number): Promise<string | null> {
    const word = await queryOne<{ word_id: number; german: string; arabic: string; image_fingerprint: string | null }>(
        db,
        `SELECT word_id, german, arabic, image_fingerprint FROM words WHERE word_id = ?`,
        [wordId]
    );
    if (!word) return null;
    const fingerprint = buildWordImageFingerprint({ german: word.german, arabic: word.arabic });
    if (!fingerprint) return null;
    if (word.image_fingerprint !== fingerprint) {
        await run(db, `UPDATE words SET image_fingerprint = ?, updated_at = COALESCE(updated_at, datetime('now')) WHERE word_id = ?`, [fingerprint, wordId]);
    }
    return fingerprint;
}

function catalogToEffective(userId: number, wordId: number, row: CatalogImageRow): EffectiveWordImage {
    return {
        id: 0,
        user_id: userId,
        collection_id: 0,
        word_id: wordId,
        image_asset_id: row.image_asset_id,
        state: 'selected',
        excluded_reason: null,
        origin_type: originTypeForCatalog(row.source_type),
        origin_user_id: row.source_user_id,
        origin_share_type: row.source_share_type,
        origin_share_id: row.source_share_id,
        is_user_override: 0,
        inherited_at: null,
        selected_at: null,
        created_at: '',
        updated_at: '',
        deleted_at: null,
        asset_id: row.image_asset_id,
        provider: row.provider,
        storage_type: row.storage_type,
        r2_key: row.r2_key,
        hotlink_url: row.hotlink_url,
        preview_url: row.preview_url,
        source_page_url: row.source_page_url,
        attribution_text: row.attribution_text,
        telegram_file_id: row.telegram_file_id,
        asset_status: row.asset_status,
        inherited: true,
        canEdit: true,
        canRemove: false,
        canRevertToInherited: false,
    };
}

function originTypeForCatalog(sourceType: CatalogImageRow['source_type']): WordImageOriginType {
    if (sourceType === 'admin') return 'admin_default';
    if (sourceType === 'community_shared') return 'community_shared';
    return 'legacy_default';
}

async function markAssetShared(db: D1Database, imageAssetId: number): Promise<void> {
    await run(
        db,
        `UPDATE image_assets
         SET visibility = CASE WHEN visibility = 'global' THEN 'global' ELSE 'shared' END,
             reusable = 1,
             published_at = COALESCE(published_at, datetime('now')),
             updated_at = datetime('now')
         WHERE id = ? AND status = 'active' AND deleted_at IS NULL`,
        [imageAssetId]
    );
}

async function markAssetGlobal(db: D1Database, imageAssetId: number): Promise<void> {
    await run(
        db,
        `UPDATE image_assets
         SET visibility = 'global',
             reusable = 1,
             published_at = COALESCE(published_at, datetime('now')),
             updated_at = datetime('now')
         WHERE id = ? AND status = 'active' AND deleted_at IS NULL`,
        [imageAssetId]
    );
}

async function upsertCommunityCatalog(
    db: D1Database,
    fingerprint: string,
    imageAssetId: number,
    sourceUserId: number,
    sourceWordId: number,
    sourceCollectionId: number | null,
    shareType: string,
    shareId: number
): Promise<void> {
    await run(
        db,
        `INSERT INTO word_image_catalog (
            fingerprint, image_asset_id, source_type, source_user_id, source_word_id,
            source_collection_id, source_share_type, source_share_id, priority, status, created_at, updated_at
         ) VALUES (?, ?, 'community_shared', ?, ?, ?, ?, ?, 50, 'active', datetime('now'), datetime('now'))`,
        [fingerprint, imageAssetId, sourceUserId, sourceWordId, sourceCollectionId, shareType, shareId]
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
    if (asset.owner_user_id !== null && asset.owner_user_id !== userId && asset.visibility !== 'shared' && asset.visibility !== 'global') {
        throw new Error('image_asset_not_allowed');
    }
}
