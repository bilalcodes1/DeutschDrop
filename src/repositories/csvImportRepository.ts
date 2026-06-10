import type { D1Database } from '@cloudflare/workers-types';
import { queryOne, queryAll, run, runBatch } from '../db/queries';
import type { CsvImportJob, CsvImportItem } from '../models';

export async function createImportJob(
    db: D1Database,
    userId: number,
    collectionId: number | null,
    listId: number | null,
    totalRows: number,
    telegramChatId: number,
    telegramMessageId: number | null,
    telegramFileUniqueId: string | null = null
): Promise<number> {
    const result = await run(
        db,
        `INSERT INTO csv_import_jobs (user_id, collection_id, list_id, total_rows, telegram_chat_id, telegram_message_id, telegram_file_unique_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [userId, collectionId, listId, totalRows, telegramChatId, telegramMessageId, telegramFileUniqueId]
    );
    return (result.meta as { last_row_id?: number })?.last_row_id ?? 0;
}

export async function createImportItemsChunked(
    db: D1Database,
    jobId: number,
    items: { rowNumber: number; german: string; arabic: string; example: string | null; example_ar?: string | null }[]
): Promise<void> {
    const CHUNK_SIZE = 15; // Decreased further because we added one more param (15 * 6 = 90 parameters)
    const statements: { sql: string; params: unknown[] }[] = [];
    
    for (let i = 0; i < items.length; i += CHUNK_SIZE) {
        const chunk = items.slice(i, i + CHUNK_SIZE);
        const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
        const params = chunk.flatMap(item => [jobId, item.rowNumber, item.german, item.arabic, item.example, item.example_ar || null]);
        
        statements.push({
            sql: `INSERT INTO csv_import_items (job_id, row_number, german, arabic, example, example_ar) VALUES ${placeholders}`,
            params
        });
    }

    if (statements.length > 0) {
        for (let i = 0; i < statements.length; i += 100) {
            await runBatch(db, statements.slice(i, i + 100));
        }
    }
}

export async function lockAndGetPendingJob(db: D1Database): Promise<CsvImportJob | null> {
    const sql = `
        SELECT * FROM csv_import_jobs
        WHERE status = 'pending'
           OR (status = 'processing' AND updated_at < datetime('now', '-5 minutes'))
        ORDER BY created_at ASC
        LIMIT 1
    `;
    const job = await queryOne<CsvImportJob>(db, sql);
    if (!job) return null;

    const updateResult = await run(
        db,
        `UPDATE csv_import_jobs 
         SET status = 'processing', updated_at = datetime('now') 
         WHERE job_id = ? AND (status = 'pending' OR updated_at = ?)`,
        [job.job_id, job.updated_at]
    );

    const changes = (updateResult.meta as { changes?: number })?.changes ?? 0;
    if (changes === 0) {
        return null;
    }

    job.status = 'processing';
    return job;
}

export async function lockJobById(db: D1Database, jobId: number): Promise<CsvImportJob | null> {
    const job = await getJobById(db, jobId);
    if (!job) return null;

    if (job.status !== 'pending' && job.status !== 'processing') {
        return null;
    }

    const updateResult = await run(
        db,
        `UPDATE csv_import_jobs 
         SET status = 'processing', updated_at = datetime('now') 
         WHERE job_id = ? AND (status = 'pending' OR status = 'processing')`,
        [job.job_id]
    );

    const changes = (updateResult.meta as { changes?: number })?.changes ?? 0;
    if (changes === 0) return null;

    job.status = 'processing';
    return job;
}

export async function getPendingItemsForJob(
    db: D1Database,
    jobId: number,
    limit: number
): Promise<CsvImportItem[]> {
    return queryAll<CsvImportItem>(
        db,
        `SELECT * FROM csv_import_items WHERE job_id = ? AND status = 'pending' ORDER BY item_id ASC LIMIT ?`,
        [jobId, limit]
    );
}

export async function updateImportItemsStatus(
    db: D1Database,
    updates: { itemId: number; status: 'imported' | 'duplicate' | 'error'; errorMessage?: string | null }[]
): Promise<void> {
    const statements = updates.map(u => ({
        sql: `UPDATE csv_import_items SET status = ?, error_message = ?, processed_at = datetime('now') WHERE item_id = ?`,
        params: [u.status, u.errorMessage || null, u.itemId]
    }));
    
    for (let i = 0; i < statements.length; i += 100) {
        await runBatch(db, statements.slice(i, i + 100));
    }
}

export async function updateJobProgress(
    db: D1Database,
    jobId: number,
    newProcessedCount: number,
    importedCount: number,
    duplicateCount: number,
    errorCount: number,
    linkedCount: number,
    skippedInCollectionCount: number,
    status: 'pending' | 'processing' | 'completed' | 'failed'
): Promise<void> {
    await run(
        db,
        `UPDATE csv_import_jobs 
         SET processed_rows = processed_rows + ?,
             imported_count = imported_count + ?,
             duplicate_count = duplicate_count + ?,
             error_count = error_count + ?,
             linked_count = linked_count + ?,
             skipped_in_collection_count = skipped_in_collection_count + ?,
             status = ?,
             updated_at = datetime('now')
         WHERE job_id = ?`,
        [newProcessedCount, importedCount, duplicateCount, errorCount, linkedCount, skippedInCollectionCount, status, jobId]
    );
}

export async function getJobById(db: D1Database, jobId: number): Promise<CsvImportJob | null> {
    return queryOne<CsvImportJob>(db, `SELECT * FROM csv_import_jobs WHERE job_id = ?`, [jobId]);
}

export async function getDuplicatesForJob(db: D1Database, jobId: number, limit: number): Promise<CsvImportItem[]> {
    return queryAll<CsvImportItem>(
        db,
        `SELECT * FROM csv_import_items WHERE job_id = ? AND status = 'duplicate' ORDER BY item_id ASC LIMIT ?`,
        [jobId, limit]
    );
}

export async function checkJobExistsByFileUniqueId(db: D1Database, userId: number, fileUniqueId: string): Promise<string | null> {
    const job = await queryOne<{ status: string }>(
        db,
        `SELECT status FROM csv_import_jobs WHERE user_id = ? AND telegram_file_unique_id = ? LIMIT 1`,
        [userId, fileUniqueId]
    );
    return job ? job.status : null;
}

export async function markJobAsFailed(db: D1Database, jobId: number): Promise<void> {
    await run(db, `UPDATE csv_import_jobs SET status = 'failed', updated_at = datetime('now') WHERE job_id = ?`, [jobId]);
}
