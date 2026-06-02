// =====================================================
// Database Query Helper
// Thin wrapper around D1 for type safety
// =====================================================

/// <reference types="@cloudflare/workers-types" />
import type { D1Database } from '@cloudflare/workers-types';

export async function queryOne<T>(
    db: D1Database,
    sql: string,
    params: unknown[] = []
): Promise<T | null> {
    const result = await db.prepare(sql).bind(...params).first<T>();
    return result ?? null;
}

export async function queryAll<T>(
    db: D1Database,
    sql: string,
    params: unknown[] = []
): Promise<T[]> {
    const result = await db.prepare(sql).bind(...params).all<T>();
    return result.results ?? [];
}

export async function run(
    db: D1Database,
    sql: string,
    params: unknown[] = []
): Promise<{ success: boolean; meta?: unknown }> {
    return db.prepare(sql).bind(...params).run();
}

export async function runBatch(
    db: D1Database,
    statements: { sql: string; params: unknown[] }[]
): Promise<{ success: boolean; meta?: unknown }[]> {
    const batch = statements.map(s => db.prepare(s.sql).bind(...s.params));
    return db.batch(batch);
}
