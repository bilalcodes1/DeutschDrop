import type { D1Database } from '@cloudflare/workers-types';
import { queryAll, queryOne, run } from '../db/queries';
import type { LearningSource } from '../models';

export async function getAllLearningSources(db: D1Database): Promise<LearningSource[]> {
    return queryAll<LearningSource>(
        db,
        'SELECT * FROM learning_sources ORDER BY is_active DESC, level, created_at DESC'
    );
}

export async function getLearningSourcesByLevel(
    db: D1Database,
    level: 'A1' | 'A2' | 'B1'
): Promise<LearningSource[]> {
    return queryAll<LearningSource>(
        db,
        'SELECT * FROM learning_sources WHERE level = ? AND is_active = 1 ORDER BY created_at DESC',
        [level]
    );
}

export async function createLearningSource(
    db: D1Database,
    adminUserId: number,
    source: { title: string; url: string; level: 'A1' | 'A2' | 'B1'; description: string | null }
): Promise<number> {
    const result = await run(
        db,
        `INSERT INTO learning_sources (title, url, level, description, created_by_admin_id)
         VALUES (?, ?, ?, ?, ?)`,
        [source.title, source.url, source.level, source.description, adminUserId]
    );
    return (result.meta as { last_row_id?: number })?.last_row_id ?? 0;
}

export async function disableLearningSource(db: D1Database, sourceId: number): Promise<boolean> {
    const result = await run(
        db,
        'UPDATE learning_sources SET is_active = 0, updated_at = datetime("now") WHERE id = ?',
        [sourceId]
    );
    return ((result.meta as { changes?: number })?.changes ?? 0) > 0;
}

export async function updateLearningSource(
    db: D1Database,
    sourceId: number,
    source: { title: string; url: string; level: 'A1' | 'A2' | 'B1'; description: string | null }
): Promise<boolean> {
    const result = await run(
        db,
        `UPDATE learning_sources
         SET title = ?, url = ?, level = ?, description = ?, updated_at = datetime("now")
         WHERE id = ?`,
        [source.title, source.url, source.level, source.description, sourceId]
    );
    return ((result.meta as { changes?: number })?.changes ?? 0) > 0;
}

export async function getLearningSourceById(db: D1Database, sourceId: number): Promise<LearningSource | null> {
    return queryOne<LearningSource>(db, 'SELECT * FROM learning_sources WHERE id = ?', [sourceId]);
}
