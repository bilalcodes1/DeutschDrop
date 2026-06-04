import type { D1Database } from '@cloudflare/workers-types';
import type { AiTaskType } from './aiTypes';

export async function buildInputHash(taskType: AiTaskType, input: unknown): Promise<string> {
    const stable = `${taskType}:${stableStringify(input)}`;
    const bytes = new TextEncoder().encode(stable);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function getCachedAiResult<T>(db: D1Database, taskType: AiTaskType, inputHash: string): Promise<T | null> {
    const row = await db.prepare(
        'SELECT result_json FROM ai_cache WHERE task_type = ? AND input_hash = ?'
    ).bind(taskType, inputHash).first<{ result_json: string }>();
    if (!row?.result_json) return null;
    try {
        return JSON.parse(row.result_json) as T;
    } catch {
        return null;
    }
}

export async function setCachedAiResult(
    db: D1Database,
    taskType: AiTaskType,
    inputHash: string,
    provider: string,
    output: unknown
): Promise<void> {
    await db.prepare(
        `INSERT INTO ai_cache (task_type, input_hash, provider, result_json, created_at)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(task_type, input_hash)
         DO UPDATE SET provider = excluded.provider, result_json = excluded.result_json, created_at = datetime('now')`
    ).bind(taskType, inputHash, provider, JSON.stringify(output)).run();
}

export async function deleteCachedAiResult(
    db: D1Database,
    taskType: AiTaskType,
    inputHash: string
): Promise<void> {
    await db.prepare('DELETE FROM ai_cache WHERE task_type = ? AND input_hash = ?')
        .bind(taskType, inputHash)
        .run();
}

function stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort().map(key => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(',')}}`;
}
