import type { D1Database } from '@cloudflare/workers-types';
import { queryAll, queryOne, run } from '../db/queries.js';

export type LifeSourceType = 'bot_ai' | 'external_chatgpt' | 'manual';
export type LifeLevel = 'A1' | 'A2' | 'B1';
export type LifeDifficulty = 'easy' | 'medium' | 'hard';
export type LifeVisibility = 'private' | 'public' | 'unlisted';
export type LifeShareNameMode = 'none' | 'bot_name' | 'custom';
export type LifeModerationStatus = 'approved' | 'hidden' | 'under_review' | 'removed';
export type LifeReportReason = 'wrong_translation' | 'bad_german' | 'inappropriate' | 'personal_info' | 'spam' | 'other';

const LIFE_REPORT_REASONS = new Set<LifeReportReason>([
    'wrong_translation',
    'bad_german',
    'inappropriate',
    'personal_info',
    'spam',
    'other',
]);

export interface LifeKeyword {
    id?: number;
    life_sentence_id?: number;
    german_word: string;
    arabic_meaning: string;
}

export interface LifeSentence {
    id: number;
    user_id: number;
    source_type: LifeSourceType;
    original_arabic: string;
    german_text: string;
    arabic_text: string;
    pronunciation_ar: string | null;
    memory_hint: string | null;
    level: LifeLevel;
    tense: string | null;
    status: 'active' | 'archived';
    difficulty: LifeDifficulty;
    review_count: number;
    correct_count: number;
    wrong_count: number;
    ease_factor: number;
    interval: number;
    repetitions: number;
    last_reviewed_at: string | null;
    next_review_at: string | null;
    visibility: LifeVisibility;
    share_code: string | null;
    published_at: string | null;
    view_count: number;
    copied_count: number;
    copied_from_sentence_id: number | null;
    moderation_status: LifeModerationStatus;
    moderation_note: string | null;
    moderated_by: number | null;
    moderated_at: string | null;
    is_pinned: number;
    pinned_at: string | null;
    pinned_by: number | null;
    pin_order: number;
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
}

export interface LifeSentenceWithKeywords extends LifeSentence {
    keywords: LifeKeyword[];
}

export interface LifeSettings {
    user_id: number;
    gate_enabled: number;
    reminders_enabled: number;
    reminder_time: string;
    timezone: string;
    target_level: LifeLevel;
    reminder_days: string;
    onboarding_seen: number;
    share_name_mode: LifeShareNameMode;
    share_display_name: string | null;
    life_sharing_suspended: number;
    sharing_suspended_at: string | null;
    sharing_suspended_by: number | null;
    created_at: string;
    updated_at: string;
}

export interface CreateLifeSentenceInput {
    userId: number;
    sourceType: LifeSourceType;
    originalArabic: string;
    germanText: string;
    arabicText: string;
    pronunciationAr?: string | null;
    memoryHint?: string | null;
    level: LifeLevel;
    tense?: string | null;
    nextReviewAt?: string | null;
    copiedFromSentenceId?: number | null;
    keywords: Array<{ german_word: string; arabic_meaning: string }>;
}

export interface PublicLifeSentence extends LifeSentence {
    author_display_name: string | null;
}

export interface LifeSentenceCopyRow {
    id: number;
    source_sentence_id: number;
    copied_by_user_id: number;
    new_sentence_id: number;
    created_at: string;
    restored_at: string | null;
}

export async function ensureLifeSettings(db: D1Database, userId: number): Promise<LifeSettings> {
    await run(
        db,
        `INSERT OR IGNORE INTO life_user_settings (user_id)
         VALUES (?)`,
        [userId]
    );
    const settings = await queryOne<LifeSettings>(db, 'SELECT * FROM life_user_settings WHERE user_id = ?', [userId]);
    if (!settings) throw new Error('life_settings_missing');
    return settings;
}

export async function updateLifeSettings(
    db: D1Database,
    userId: number,
    patch: Partial<Pick<LifeSettings, 'gate_enabled' | 'reminders_enabled' | 'reminder_time' | 'timezone' | 'target_level' | 'reminder_days' | 'onboarding_seen' | 'share_name_mode' | 'share_display_name' | 'life_sharing_suspended' | 'sharing_suspended_at' | 'sharing_suspended_by'>>
): Promise<void> {
    await ensureLifeSettings(db, userId);
    const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
    if (entries.length === 0) return;
    const setClause = entries.map(([key]) => `${key} = ?`).join(', ');
    await run(
        db,
        `UPDATE life_user_settings SET ${setClause}, updated_at = datetime('now') WHERE user_id = ?`,
        [...entries.map(([, value]) => value), userId]
    );
}

export async function getLifeGate(db: D1Database, userId: number, gateDate: string): Promise<{
    id: number;
    user_id: number;
    gate_date: string;
    life_sentence_id: number | null;
    completed_at: string | null;
    remind_after_at: string | null;
    reminder_sent_count: number;
    reminder_skipped_at: string | null;
} | null> {
    return queryOne(
        db,
        'SELECT * FROM life_daily_gate WHERE user_id = ? AND gate_date = ?',
        [userId, gateDate]
    );
}

export async function completeLifeGate(db: D1Database, userId: number, gateDate: string, sentenceId: number): Promise<boolean> {
    const result = await run(
        db,
        `INSERT OR IGNORE INTO life_daily_gate (user_id, gate_date, life_sentence_id, completed_at)
         VALUES (?, ?, ?, datetime('now'))`,
        [userId, gateDate, sentenceId]
    );
    const changes = (result.meta as { changes?: number })?.changes ?? 0;
    if (changes === 0) return false;
    return true;
}

export async function setLifeGateReminder(db: D1Database, userId: number, gateDate: string, hours: number): Promise<void> {
    await run(
        db,
        `INSERT INTO life_daily_gate (user_id, gate_date, remind_after_at)
         VALUES (?, ?, datetime('now', ?))
         ON CONFLICT(user_id, gate_date)
         DO UPDATE SET remind_after_at = excluded.remind_after_at`,
        [userId, gateDate, `+${hours} hours`]
    );
}

export async function skipLifeReminderToday(db: D1Database, userId: number, gateDate: string): Promise<void> {
    await run(
        db,
        `INSERT INTO life_daily_gate (user_id, gate_date, reminder_skipped_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(user_id, gate_date)
         DO UPDATE SET reminder_skipped_at = datetime('now')`,
        [userId, gateDate]
    );
}

export async function createLifeSentence(db: D1Database, input: CreateLifeSentenceInput): Promise<number> {
    const result = await run(
        db,
        `INSERT INTO life_sentences (
            user_id, source_type, original_arabic, german_text, arabic_text,
            pronunciation_ar, memory_hint, level, tense, next_review_at, copied_from_sentence_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            input.userId,
            input.sourceType,
            input.originalArabic,
            input.germanText,
            input.arabicText,
            input.pronunciationAr ?? null,
            input.memoryHint ?? null,
            input.level,
            input.tense ?? null,
            input.nextReviewAt ?? null,
            input.copiedFromSentenceId ?? null,
        ]
    );
    const id = (result.meta as { last_row_id?: number })?.last_row_id ?? 0;
    const keywords = input.keywords.slice(0, 5).filter(keyword => keyword.german_word.trim() && keyword.arabic_meaning.trim());
    if (keywords.length > 0) {
        for (const keyword of keywords) {
            await run(
                db,
                'INSERT INTO life_sentence_keywords (life_sentence_id, german_word, arabic_meaning) VALUES (?, ?, ?)',
                [id, keyword.german_word.trim(), keyword.arabic_meaning.trim()]
            );
        }
    }
    return id;
}

export async function getLifeSentenceById(db: D1Database, userId: number, id: number): Promise<LifeSentenceWithKeywords | null> {
    const sentence = await queryOne<LifeSentence>(
        db,
        'SELECT * FROM life_sentences WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
        [id, userId]
    );
    if (!sentence) return null;
    return { ...sentence, keywords: await getLifeKeywords(db, id) };
}

export async function getLifeSentenceOwnedByUser(db: D1Database, userId: number, id: number): Promise<LifeSentenceWithKeywords | null> {
    return getLifeSentenceById(db, userId, id);
}

export async function getTodayLifeSentence(db: D1Database, userId: number, gateDate: string): Promise<LifeSentenceWithKeywords | null> {
    const gate = await getLifeGate(db, userId, gateDate);
    if (!gate?.life_sentence_id) return null;
    return getLifeSentenceById(db, userId, gate.life_sentence_id);
}

export async function listLifeSentences(
    db: D1Database,
    userId: number,
    limit: number,
    offset: number,
    filter: string = 'active',
    query = ''
): Promise<LifeSentence[]> {
    const params: unknown[] = [userId];
    let where = 'user_id = ? AND deleted_at IS NULL';
    if (filter === 'archived') {
        where += " AND status = 'archived'";
    } else if (filter === 'hard') {
        where += " AND status = 'active' AND difficulty = 'hard'";
    } else if (filter === 'due') {
        where += " AND status = 'active' AND next_review_at <= datetime('now')";
    } else if (['A1', 'A2', 'B1'].includes(filter)) {
        where += " AND status = 'active' AND level = ?";
        params.push(filter);
    } else {
        where += " AND status = 'active'";
    }
    const safeQuery = query.trim();
    if (safeQuery) {
        where += ` AND (
            german_text LIKE ? OR arabic_text LIKE ? OR original_arabic LIKE ?
            OR EXISTS (
                SELECT 1 FROM life_sentence_keywords k
                WHERE k.life_sentence_id = life_sentences.id
                  AND (k.german_word LIKE ? OR k.arabic_meaning LIKE ?)
            )
        )`;
        const like = `%${safeQuery}%`;
        params.push(like, like, like, like, like);
    }
    return queryAll<LifeSentence>(
        db,
        `SELECT * FROM life_sentences WHERE ${where}
         ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset]
    );
}

export async function countLifeSentences(db: D1Database, userId: number, filter = 'active', query = ''): Promise<number> {
    const params: unknown[] = [userId];
    let where = 'user_id = ? AND deleted_at IS NULL';
    if (filter === 'archived') where += " AND status = 'archived'";
    else if (filter === 'hard') where += " AND status = 'active' AND difficulty = 'hard'";
    else if (filter === 'due') where += " AND status = 'active' AND next_review_at <= datetime('now')";
    else if (['A1', 'A2', 'B1'].includes(filter)) {
        where += " AND status = 'active' AND level = ?";
        params.push(filter);
    } else where += " AND status = 'active'";
    const safeQuery = query.trim();
    if (safeQuery) {
        where += ` AND (german_text LIKE ? OR arabic_text LIKE ? OR original_arabic LIKE ?)`;
        const like = `%${safeQuery}%`;
        params.push(like, like, like);
    }
    const row = await queryOne<{ count: number }>(db, `SELECT COUNT(*) AS count FROM life_sentences WHERE ${where}`, params);
    return row?.count ?? 0;
}

export async function getDueLifeSentences(db: D1Database, userId: number, limit = 5): Promise<LifeSentence[]> {
    return queryAll(
        db,
        `SELECT * FROM life_sentences
         WHERE user_id = ?
           AND status = 'active'
           AND deleted_at IS NULL
           AND (next_review_at IS NULL OR next_review_at <= datetime('now'))
         ORDER BY COALESCE(next_review_at, created_at) ASC
         LIMIT ?`,
        [userId, limit]
    );
}

export async function updateLifeSentenceReview(
    db: D1Database,
    userId: number,
    id: number,
    patch: {
        isCorrect: boolean;
        difficulty: LifeDifficulty;
        easeFactor: number;
        interval: number;
        repetitions: number;
        nextReviewAt: string;
    }
): Promise<void> {
    await run(
        db,
        `UPDATE life_sentences
         SET review_count = review_count + 1,
             correct_count = correct_count + ?,
             wrong_count = wrong_count + ?,
             difficulty = ?,
             ease_factor = ?,
             interval = ?,
             repetitions = ?,
             last_reviewed_at = datetime('now'),
             next_review_at = ?,
             updated_at = datetime('now')
         WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
        [
            patch.isCorrect ? 1 : 0,
            patch.isCorrect ? 0 : 1,
            patch.difficulty,
            patch.easeFactor,
            patch.interval,
            patch.repetitions,
            patch.nextReviewAt,
            id,
            userId,
        ]
    );
}

export async function updateLifeSentenceTexts(
    db: D1Database,
    userId: number,
    id: number,
    patch: Partial<Pick<CreateLifeSentenceInput, 'germanText' | 'arabicText' | 'pronunciationAr' | 'memoryHint' | 'level' | 'tense'>>
): Promise<void> {
    const pairs: Array<[string, unknown]> = [];
    if (patch.germanText !== undefined) pairs.push(['german_text', patch.germanText]);
    if (patch.arabicText !== undefined) pairs.push(['arabic_text', patch.arabicText]);
    if (patch.pronunciationAr !== undefined) pairs.push(['pronunciation_ar', patch.pronunciationAr]);
    if (patch.memoryHint !== undefined) pairs.push(['memory_hint', patch.memoryHint]);
    if (patch.level !== undefined) pairs.push(['level', patch.level]);
    if (patch.tense !== undefined) pairs.push(['tense', patch.tense]);
    if (!pairs.length) return;
    await run(
        db,
        `UPDATE life_sentences SET ${pairs.map(([key]) => `${key} = ?`).join(', ')}, updated_at = datetime('now')
         WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
        [...pairs.map(([, value]) => value), id, userId]
    );
}

export async function setLifeSentenceDifficulty(db: D1Database, userId: number, id: number, difficulty: LifeDifficulty): Promise<void> {
    await run(
        db,
        `UPDATE life_sentences SET difficulty = ?, updated_at = datetime('now')
         WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
        [difficulty, id, userId]
    );
}

export async function archiveLifeSentence(db: D1Database, userId: number, id: number): Promise<void> {
    await run(
        db,
        `UPDATE life_sentences SET status = 'archived', updated_at = datetime('now')
         WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
        [id, userId]
    );
}

export async function softDeleteLifeSentence(db: D1Database, userId: number, id: number): Promise<void> {
    await run(
        db,
        `UPDATE life_sentences SET deleted_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ? AND user_id = ?`,
        [id, userId]
    );
}

export async function getLifeKeywords(db: D1Database, sentenceId: number): Promise<LifeKeyword[]> {
    return queryAll(
        db,
        `SELECT id, life_sentence_id, german_word, arabic_meaning, created_at
         FROM life_sentence_keywords WHERE life_sentence_id = ? ORDER BY id ASC`,
        [sentenceId]
    );
}

export async function getLifeStats(db: D1Database, userId: number): Promise<{
    total: number;
    active: number;
    hard: number;
    due: number;
    correct: number;
    wrong: number;
    week: number;
}> {
    const row = await queryOne<{
        total: number;
        active: number;
        hard: number;
        due: number;
        correct: number;
        wrong: number;
        week: number;
    }>(
        db,
        `SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN status = 'active' AND deleted_at IS NULL THEN 1 ELSE 0 END) AS active,
            SUM(CASE WHEN difficulty = 'hard' AND status = 'active' AND deleted_at IS NULL THEN 1 ELSE 0 END) AS hard,
            SUM(CASE WHEN status = 'active' AND deleted_at IS NULL AND next_review_at <= datetime('now') THEN 1 ELSE 0 END) AS due,
            COALESCE(SUM(correct_count), 0) AS correct,
            COALESCE(SUM(wrong_count), 0) AS wrong,
            SUM(CASE WHEN created_at >= datetime('now', '-7 days') AND deleted_at IS NULL THEN 1 ELSE 0 END) AS week
         FROM life_sentences WHERE user_id = ?`,
        [userId]
    );
    return {
        total: row?.total ?? 0,
        active: row?.active ?? 0,
        hard: row?.hard ?? 0,
        due: row?.due ?? 0,
        correct: row?.correct ?? 0,
        wrong: row?.wrong ?? 0,
        week: row?.week ?? 0,
    };
}

export async function getCompletedLifeGateDates(db: D1Database, userId: number): Promise<string[]> {
    const rows = await queryAll<{ gate_date: string }>(
        db,
        `SELECT gate_date FROM life_daily_gate
         WHERE user_id = ? AND completed_at IS NOT NULL
         ORDER BY gate_date DESC LIMIT 400`,
        [userId]
    );
    return rows.map(row => row.gate_date);
}

export async function getLifeSentenceWithAuthorById(
    db: D1Database,
    sentenceId: number,
    includeUnlisted = false
): Promise<(PublicLifeSentence & { keywords: LifeKeyword[] }) | null> {
    const visibilityClause = includeUnlisted ? "ls.visibility IN ('public', 'unlisted')" : "ls.visibility = 'public'";
    const row = await queryOne<PublicLifeSentence>(
        db,
        `SELECT ls.*,
                CASE
                    WHEN COALESCE(lus.share_name_mode, 'none') = 'bot_name' THEN COALESCE(u.display_name, u.name)
                    WHEN COALESCE(lus.share_name_mode, 'none') = 'custom' THEN lus.share_display_name
                    ELSE NULL
                END AS author_display_name
         FROM life_sentences ls
         JOIN users u ON u.user_id = ls.user_id
         LEFT JOIN life_user_settings lus ON lus.user_id = ls.user_id
         WHERE ls.id = ?
           AND ${visibilityClause}
           AND ls.status = 'active'
           AND COALESCE(ls.moderation_status, 'approved') = 'approved'
           AND ls.deleted_at IS NULL`,
        [sentenceId]
    );
    if (!row) return null;
    return { ...row, keywords: await getLifeKeywords(db, row.id) };
}

export async function getLifeSentenceByShareCode(
    db: D1Database,
    shareCode: string
): Promise<(PublicLifeSentence & { keywords: LifeKeyword[] }) | null> {
    const row = await queryOne<PublicLifeSentence>(
        db,
        `SELECT ls.*,
                CASE
                    WHEN COALESCE(lus.share_name_mode, 'none') = 'bot_name' THEN COALESCE(u.display_name, u.name)
                    WHEN COALESCE(lus.share_name_mode, 'none') = 'custom' THEN lus.share_display_name
                    ELSE NULL
                END AS author_display_name
         FROM life_sentences ls
         JOIN users u ON u.user_id = ls.user_id
         LEFT JOIN life_user_settings lus ON lus.user_id = ls.user_id
         WHERE ls.share_code = ?
           AND ls.visibility IN ('public', 'unlisted')
           AND ls.status = 'active'
           AND COALESCE(ls.moderation_status, 'approved') = 'approved'
           AND ls.deleted_at IS NULL`,
        [shareCode]
    );
    if (!row) return null;
    return { ...row, keywords: await getLifeKeywords(db, row.id) };
}

export async function getLifeSentenceByShareCodeAnyVisibility(db: D1Database, shareCode: string): Promise<LifeSentence | null> {
    return queryOne<LifeSentence>(db, 'SELECT * FROM life_sentences WHERE share_code = ? AND deleted_at IS NULL', [shareCode]);
}

export async function incrementLifeSentenceView(db: D1Database, sentenceId: number): Promise<void> {
    await run(db, 'UPDATE life_sentences SET view_count = view_count + 1 WHERE id = ?', [sentenceId]);
}

export async function setLifeSentenceVisibility(
    db: D1Database,
    userId: number,
    sentenceId: number,
    visibility: LifeVisibility,
    shareCode: string | null
): Promise<boolean> {
    const result = await run(
        db,
        `UPDATE life_sentences
         SET visibility = ?,
             share_code = COALESCE(share_code, ?),
             published_at = CASE
                WHEN ? IN ('public', 'unlisted') AND published_at IS NULL THEN datetime('now')
                WHEN ? = 'private' THEN NULL
                ELSE published_at
             END,
             updated_at = datetime('now')
         WHERE id = ?
           AND user_id = ?
           AND deleted_at IS NULL`,
        [visibility, shareCode, visibility, visibility, sentenceId, userId]
    );
    return ((result.meta as { changes?: number })?.changes ?? 0) > 0;
}

export async function getLifeShareCodeExists(db: D1Database, shareCode: string): Promise<boolean> {
    const row = await queryOne<{ id: number }>(db, 'SELECT id FROM life_sentences WHERE share_code = ?', [shareCode]);
    return Boolean(row);
}

export async function countPublicLifeSentences(db: D1Database, options: { query?: string; level?: LifeLevel | null } = {}): Promise<number> {
    const params: unknown[] = [];
    let where = publicLifeWhere(options, params);
    const row = await queryOne<{ count: number }>(
        db,
        `SELECT COUNT(*) AS count FROM life_sentences ls WHERE ${where}`,
        params
    );
    return row?.count ?? 0;
}

export async function listPublicLifeSentences(
    db: D1Database,
    limit: number,
    offset: number,
    options: { sort?: 'latest' | 'popular'; query?: string; level?: LifeLevel | null } = {}
): Promise<PublicLifeSentence[]> {
    const params: unknown[] = [];
    const where = publicLifeWhere(options, params);
    const order = options.sort === 'popular'
        ? 'ls.copied_count DESC, ls.published_at DESC, ls.id DESC'
        : lifeSearchOrder(options.query, params);
    return queryAll<PublicLifeSentence>(
        db,
        `SELECT ls.*,
                CASE
                    WHEN COALESCE(lus.share_name_mode, 'none') = 'bot_name' THEN COALESCE(u.display_name, u.name)
                    WHEN COALESCE(lus.share_name_mode, 'none') = 'custom' THEN lus.share_display_name
                    ELSE NULL
                END AS author_display_name
         FROM life_sentences ls
         JOIN users u ON u.user_id = ls.user_id
         LEFT JOIN life_user_settings lus ON lus.user_id = ls.user_id
         WHERE ${where}
         ORDER BY ${order}
         LIMIT ? OFFSET ?`,
        [...params, limit, offset]
    );
}

export async function listPinnedPublicLifeSentences(db: D1Database, limit = 3): Promise<PublicLifeSentence[]> {
    return queryAll<PublicLifeSentence>(
        db,
        `SELECT ls.*,
                CASE
                    WHEN COALESCE(lus.share_name_mode, 'none') = 'bot_name' THEN COALESCE(u.display_name, u.name)
                    WHEN COALESCE(lus.share_name_mode, 'none') = 'custom' THEN lus.share_display_name
                    ELSE NULL
                END AS author_display_name
         FROM life_sentences ls
         JOIN users u ON u.user_id = ls.user_id
         LEFT JOIN life_user_settings lus ON lus.user_id = ls.user_id
         WHERE ls.visibility = 'public'
           AND ls.status = 'active'
           AND COALESCE(ls.moderation_status, 'approved') = 'approved'
           AND COALESCE(ls.is_pinned, 0) = 1
           AND ls.deleted_at IS NULL
         ORDER BY ls.pin_order DESC, ls.pinned_at DESC, ls.id DESC
         LIMIT ?`,
        [limit]
    );
}

export async function listPublishedLifeSentencesByUser(db: D1Database, userId: number, limit: number, offset: number): Promise<LifeSentence[]> {
    return queryAll<LifeSentence>(
        db,
        `SELECT * FROM life_sentences
         WHERE user_id = ?
           AND visibility IN ('public', 'unlisted')
           AND status = 'active'
           AND deleted_at IS NULL
         ORDER BY published_at DESC, id DESC
         LIMIT ? OFFSET ?`,
        [userId, limit, offset]
    );
}

export async function countPublishedLifeSentencesByUser(db: D1Database, userId: number): Promise<number> {
    const row = await queryOne<{ count: number }>(
        db,
        `SELECT COUNT(*) AS count FROM life_sentences
         WHERE user_id = ?
           AND visibility IN ('public', 'unlisted')
           AND status = 'active'
           AND deleted_at IS NULL`,
        [userId]
    );
    return row?.count ?? 0;
}

export async function getLifeCopyRecord(db: D1Database, sourceSentenceId: number, userId: number): Promise<LifeSentenceCopyRow | null> {
    return queryOne<LifeSentenceCopyRow>(
        db,
        'SELECT * FROM life_sentence_copies WHERE source_sentence_id = ? AND copied_by_user_id = ?',
        [sourceSentenceId, userId]
    );
}

export async function listCopiedLifeSentencesByUser(db: D1Database, userId: number, limit: number, offset: number): Promise<Array<LifeSentence & { copied_at: string; source_sentence_id: number }>> {
    return queryAll(
        db,
        `SELECT ls.*, c.created_at AS copied_at, c.source_sentence_id
         FROM life_sentence_copies c
         JOIN life_sentences ls ON ls.id = c.new_sentence_id
         WHERE c.copied_by_user_id = ?
           AND ls.user_id = ?
           AND ls.deleted_at IS NULL
         ORDER BY c.created_at DESC
         LIMIT ? OFFSET ?`,
        [userId, userId, limit, offset]
    );
}

export async function countCopiedLifeSentencesByUser(db: D1Database, userId: number): Promise<number> {
    const row = await queryOne<{ count: number }>(
        db,
        `SELECT COUNT(*) AS count
         FROM life_sentence_copies c
         JOIN life_sentences ls ON ls.id = c.new_sentence_id
         WHERE c.copied_by_user_id = ?
           AND ls.user_id = ?
           AND ls.deleted_at IS NULL`,
        [userId, userId]
    );
    return row?.count ?? 0;
}

export async function restoreLifeSentenceCopy(db: D1Database, userId: number, copy: LifeSentenceCopyRow): Promise<void> {
    await run(
        db,
        `UPDATE life_sentences
         SET deleted_at = NULL,
             status = 'active',
             updated_at = datetime('now')
         WHERE id = ?
           AND user_id = ?`,
        [copy.new_sentence_id, userId]
    );
    await run(db, 'UPDATE life_sentence_copies SET restored_at = datetime(\'now\') WHERE id = ?', [copy.id]);
}

export async function createLifeSentenceCopy(
    db: D1Database,
    source: LifeSentenceWithKeywords,
    userId: number
): Promise<{ newSentenceId: number; copiedNow: boolean }> {
    const existing = await getLifeCopyRecord(db, source.id, userId);
    if (existing) {
        const existingSentence = await getLifeSentenceById(db, userId, existing.new_sentence_id);
        if (!existingSentence) await restoreLifeSentenceCopy(db, userId, existing);
        return { newSentenceId: existing.new_sentence_id, copiedNow: false };
    }

    const newSentenceId = await createLifeSentence(db, {
        userId,
        sourceType: source.source_type,
        originalArabic: source.arabic_text,
        germanText: source.german_text,
        arabicText: source.arabic_text,
        pronunciationAr: source.pronunciation_ar,
        memoryHint: null,
        level: source.level,
        tense: source.tense,
        nextReviewAt: new Date().toISOString(),
        copiedFromSentenceId: source.id,
        keywords: source.keywords.map(keyword => ({
            german_word: keyword.german_word,
            arabic_meaning: keyword.arabic_meaning,
        })),
    });
    await run(
        db,
        `INSERT INTO life_sentence_copies (source_sentence_id, copied_by_user_id, new_sentence_id)
         VALUES (?, ?, ?)`,
        [source.id, userId, newSentenceId]
    );
    await run(db, 'UPDATE life_sentences SET copied_count = copied_count + 1 WHERE id = ?', [source.id]);
    return { newSentenceId, copiedNow: true };
}

export async function createLifeSentenceReport(
    db: D1Database,
    sentenceId: number,
    reporterUserId: number,
    reason: string,
    details: string | null = null
): Promise<boolean> {
    if (!LIFE_REPORT_REASONS.has(reason as LifeReportReason)) {
        throw new Error('invalid_life_report_reason');
    }
    const result = await run(
        db,
        `INSERT OR IGNORE INTO life_sentence_reports (sentence_id, reporter_user_id, reason, details)
         VALUES (?, ?, ?, ?)`,
        [sentenceId, reporterUserId, reason, details]
    );
    return ((result.meta as { changes?: number })?.changes ?? 0) > 0;
}

function publicLifeWhere(options: { query?: string; level?: LifeLevel | null }, params: unknown[]): string {
    let where = "ls.visibility = 'public' AND ls.status = 'active' AND COALESCE(ls.moderation_status, 'approved') = 'approved' AND ls.deleted_at IS NULL";
    if (options.level) {
        where += ' AND ls.level = ?';
        params.push(options.level);
    }
    const query = options.query?.trim();
    if (query) {
        const like = `%${escapeLike(query)}%`;
        where += ` AND (
            ls.german_text LIKE ? ESCAPE '\\'
         OR ls.arabic_text LIKE ? ESCAPE '\\'
         OR EXISTS (
                SELECT 1 FROM life_sentence_keywords k
                WHERE k.life_sentence_id = ls.id
                  AND (k.german_word LIKE ? ESCAPE '\\' OR k.arabic_meaning LIKE ? ESCAPE '\\')
            )
        )`;
        params.push(like, like, like, like);
    }
    return where;
}

function lifeSearchOrder(query: string | undefined, params: unknown[]): string {
    const value = query?.trim();
    if (!value) return 'ls.published_at DESC, ls.id DESC';
    const exact = escapeLike(value);
    const starts = `${escapeLike(value)}%`;
    const contains = `%${escapeLike(value)}%`;
    params.push(exact, exact, starts, starts, contains, contains);
    return `CASE
            WHEN ls.german_text = ? OR ls.arabic_text = ? THEN 1
            WHEN ls.german_text LIKE ? ESCAPE '\\' OR ls.arabic_text LIKE ? ESCAPE '\\' THEN 2
            WHEN EXISTS (
                SELECT 1 FROM life_sentence_keywords k
                WHERE k.life_sentence_id = ls.id
                  AND (k.german_word LIKE ? ESCAPE '\\' OR k.arabic_meaning LIKE ? ESCAPE '\\')
            ) THEN 3
            ELSE 4
        END ASC,
        ls.published_at DESC,
        ls.id DESC`;
}

export function escapeLike(value: string): string {
    return value.replace(/[\\%_]/g, match => `\\${match}`);
}
