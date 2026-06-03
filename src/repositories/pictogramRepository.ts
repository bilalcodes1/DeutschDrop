import type { D1Database } from '@cloudflare/workers-types';
import { queryOne, run } from '../db/queries';
import type { WordPictogram } from '../models';
import type { PictogramSearchResult } from '../services/pictogramSearch';

export async function getPictogramByWordId(
    db: D1Database,
    wordId: number
): Promise<WordPictogram | null> {
    return queryOne<WordPictogram>(
        db,
        'SELECT * FROM word_pictograms WHERE word_id = ?',
        [wordId]
    );
}

export async function upsertPictogramForWord(
    db: D1Database,
    wordId: number,
    pictogram: PictogramSearchResult
): Promise<void> {
    await run(
        db,
        `INSERT INTO word_pictograms (
            word_id, provider, pictogram_id, image_url, thumbnail_url, title, license, attribution, source_url
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(word_id) DO UPDATE SET
            provider = excluded.provider,
            pictogram_id = excluded.pictogram_id,
            image_url = excluded.image_url,
            thumbnail_url = excluded.thumbnail_url,
            title = excluded.title,
            license = excluded.license,
            attribution = excluded.attribution,
            source_url = excluded.source_url,
            created_at = CURRENT_TIMESTAMP`,
        [
            wordId,
            pictogram.provider,
            pictogram.pictogramId,
            pictogram.imageUrl,
            pictogram.thumbnailUrl,
            pictogram.title,
            pictogram.license,
            pictogram.attribution,
            pictogram.sourceUrl,
        ]
    );
}

export async function deletePictogramForWord(
    db: D1Database,
    wordId: number
): Promise<void> {
    await run(db, 'DELETE FROM word_pictograms WHERE word_id = ?', [wordId]);
}

export const getWordPictogram = getPictogramByWordId;
export const saveWordPictogram = upsertPictogramForWord;
