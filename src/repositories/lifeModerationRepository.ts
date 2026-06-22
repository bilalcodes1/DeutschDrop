import type { D1Database } from '@cloudflare/workers-types';
import { queryAll, queryOne, run } from '../db/queries.js';
import type { LifeLevel, LifeModerationStatus, LifeVisibility } from './lifeSentenceRepository.js';

export type ModerationReportStatus = 'pending' | 'reviewed' | 'dismissed' | 'removed';
export type ModerationActionType =
    | 'report_reviewed'
    | 'report_dismissed'
    | 'sentence_hidden'
    | 'sentence_restored'
    | 'sentence_deleted'
    | 'sentence_edited'
    | 'sentence_pinned'
    | 'sentence_unpinned'
    | 'visibility_changed'
    | 'user_warned'
    | 'sharing_suspended'
    | 'sharing_restored';

export interface ModerationSentenceRow {
    id: number;
    user_id: number;
    german_text: string;
    arabic_text: string;
    pronunciation_ar: string | null;
    level: LifeLevel;
    tense: string | null;
    visibility: LifeVisibility;
    moderation_status: LifeModerationStatus;
    moderation_note: string | null;
    deleted_at: string | null;
    is_pinned: number;
    pinned_at: string | null;
    pinned_by: number | null;
    pin_order: number;
    share_code: string | null;
    view_count: number;
    copied_count: number;
    created_at: string;
    updated_at: string;
    author_name: string | null;
    author_telegram_id: number | null;
    report_count: number;
}

export interface ModerationReportRow {
    id: number;
    sentence_id: number;
    reporter_user_id: number;
    reason: string;
    details: string | null;
    status: ModerationReportStatus;
    created_at: string;
    reviewed_by_admin_id: number | null;
    reviewed_at: string | null;
    german_text: string;
    arabic_text: string;
    visibility: LifeVisibility;
    moderation_status: LifeModerationStatus;
    is_pinned: number;
    deleted_at: string | null;
    publisher_user_id: number;
    publisher_name: string | null;
    reporter_name: string | null;
    report_count: number;
}

export interface ReportedUserRow {
    user_id: number;
    display_name: string | null;
    telegram_user_id: number | null;
    sentence_count: number;
    public_sentence_count: number;
    received_reports: number;
    accepted_reports: number;
    life_sharing_suspended: number;
    created_at: string;
}

export interface ModerationStats {
    pendingReports: number;
    handledReports: number;
    deletedSentences: number;
    hiddenSentences: number;
    pinnedSentences: number;
    publicSentences: number;
    suspendedUsers: number;
    actionsToday: number;
    actionsThisWeek: number;
}

const REPORT_SELECT = `
    SELECT r.*,
           ls.german_text,
           ls.arabic_text,
           ls.visibility,
           COALESCE(ls.moderation_status, 'approved') AS moderation_status,
           COALESCE(ls.is_pinned, 0) AS is_pinned,
           ls.deleted_at,
           ls.user_id AS publisher_user_id,
           COALESCE(pub.display_name, pub.name) AS publisher_name,
           COALESCE(rep.display_name, rep.name) AS reporter_name,
           (SELECT COUNT(*) FROM life_sentence_reports rr WHERE rr.sentence_id = r.sentence_id) AS report_count
      FROM life_sentence_reports r
      JOIN life_sentences ls ON ls.id = r.sentence_id
      LEFT JOIN users pub ON pub.user_id = ls.user_id
      LEFT JOIN users rep ON rep.user_id = r.reporter_user_id
`;

const SENTENCE_SELECT = `
    SELECT ls.*,
           COALESCE(u.display_name, u.name) AS author_name,
           COALESCE(u.telegram_user_id, u.telegram_id) AS author_telegram_id,
           (SELECT COUNT(*) FROM life_sentence_reports r WHERE r.sentence_id = ls.id) AS report_count
      FROM life_sentences ls
      LEFT JOIN users u ON u.user_id = ls.user_id
`;

export async function listModerationReports(
    db: D1Database,
    status: ModerationReportStatus | 'all',
    limit: number,
    offset: number,
    pinnedOnly = false
): Promise<ModerationReportRow[]> {
    const params: unknown[] = [];
    let where = '1 = 1';
    if (status !== 'all') {
        where += ' AND r.status = ?';
        params.push(status);
    }
    if (pinnedOnly) where += ' AND COALESCE(ls.is_pinned, 0) = 1';
    return queryAll<ModerationReportRow>(
        db,
        `${REPORT_SELECT}
         WHERE ${where}
         ORDER BY r.created_at DESC, r.id DESC
         LIMIT ? OFFSET ?`,
        [...params, limit, offset]
    );
}

export async function countModerationReports(
    db: D1Database,
    status: ModerationReportStatus | 'all',
    pinnedOnly = false
): Promise<number> {
    const params: unknown[] = [];
    let where = '1 = 1';
    if (status !== 'all') {
        where += ' AND r.status = ?';
        params.push(status);
    }
    if (pinnedOnly) where += ' AND COALESCE(ls.is_pinned, 0) = 1';
    const row = await queryOne<{ count: number }>(
        db,
        `SELECT COUNT(*) AS count
           FROM life_sentence_reports r
           JOIN life_sentences ls ON ls.id = r.sentence_id
          WHERE ${where}`,
        params
    );
    return row?.count ?? 0;
}

export async function getModerationReportById(db: D1Database, reportId: number): Promise<ModerationReportRow | null> {
    return queryOne<ModerationReportRow>(
        db,
        `${REPORT_SELECT} WHERE r.id = ?`,
        [reportId]
    );
}

export async function updateModerationReportStatus(
    db: D1Database,
    reportId: number,
    status: ModerationReportStatus,
    adminUserId: number
): Promise<boolean> {
    const result = await run(
        db,
        `UPDATE life_sentence_reports
            SET status = ?,
                reviewed_by_admin_id = ?,
                reviewed_at = datetime('now'),
                resolved_at = CASE WHEN ? IN ('reviewed', 'dismissed', 'removed') THEN datetime('now') ELSE resolved_at END
          WHERE id = ?`,
        [status, adminUserId, status, reportId]
    );
    return ((result.meta as { changes?: number })?.changes ?? 0) > 0;
}

export async function getModerationSentenceById(db: D1Database, sentenceId: number): Promise<ModerationSentenceRow | null> {
    return queryOne<ModerationSentenceRow>(
        db,
        `${SENTENCE_SELECT} WHERE ls.id = ?`,
        [sentenceId]
    );
}

export async function listModerationSentences(
    db: D1Database,
    kind: 'public' | 'hidden' | 'deleted' | 'pinned',
    limit: number,
    offset: number,
    sort: 'latest' | 'popular' | 'reported' = 'latest'
): Promise<ModerationSentenceRow[]> {
    let where = '1 = 1';
    if (kind === 'public') where = "ls.visibility = 'public' AND ls.deleted_at IS NULL";
    if (kind === 'hidden') where = "COALESCE(ls.moderation_status, 'approved') = 'hidden' AND ls.deleted_at IS NULL";
    if (kind === 'deleted') where = "ls.deleted_at IS NOT NULL OR COALESCE(ls.moderation_status, 'approved') = 'removed'";
    if (kind === 'pinned') where = "COALESCE(ls.is_pinned, 0) = 1 AND COALESCE(ls.moderation_status, 'approved') = 'approved' AND ls.deleted_at IS NULL";
    const order = kind === 'pinned'
        ? 'ls.pin_order DESC, ls.pinned_at DESC, ls.id DESC'
        : sort === 'popular'
            ? 'ls.copied_count DESC, ls.id DESC'
            : sort === 'reported'
                ? 'report_count DESC, ls.id DESC'
                : 'ls.created_at DESC, ls.id DESC';
    return queryAll<ModerationSentenceRow>(
        db,
        `${SENTENCE_SELECT}
         WHERE ${where}
         ORDER BY ${order}
         LIMIT ? OFFSET ?`,
        [limit, offset]
    );
}

export async function countModerationSentences(db: D1Database, kind: 'public' | 'hidden' | 'deleted' | 'pinned'): Promise<number> {
    let where = '1 = 1';
    if (kind === 'public') where = "visibility = 'public' AND deleted_at IS NULL";
    if (kind === 'hidden') where = "COALESCE(moderation_status, 'approved') = 'hidden' AND deleted_at IS NULL";
    if (kind === 'deleted') where = "deleted_at IS NOT NULL OR COALESCE(moderation_status, 'approved') = 'removed'";
    if (kind === 'pinned') where = "COALESCE(is_pinned, 0) = 1 AND COALESCE(moderation_status, 'approved') = 'approved' AND deleted_at IS NULL";
    const row = await queryOne<{ count: number }>(db, `SELECT COUNT(*) AS count FROM life_sentences WHERE ${where}`);
    return row?.count ?? 0;
}

export async function pinModerationSentence(db: D1Database, sentenceId: number, adminUserId: number): Promise<boolean> {
    const row = await queryOne<{ next_order: number }>(db, 'SELECT COALESCE(MAX(pin_order), 0) + 1 AS next_order FROM life_sentences');
    const result = await run(
        db,
        `UPDATE life_sentences
            SET is_pinned = 1,
                pinned_at = datetime('now'),
                pinned_by = ?,
                pin_order = ?,
                moderation_status = 'approved',
                moderated_by = ?,
                moderated_at = datetime('now'),
                updated_at = datetime('now')
          WHERE id = ?
            AND deleted_at IS NULL
            AND visibility IN ('public', 'unlisted')`,
        [adminUserId, row?.next_order ?? 1, adminUserId, sentenceId]
    );
    return ((result.meta as { changes?: number })?.changes ?? 0) > 0;
}

export async function unpinModerationSentence(db: D1Database, sentenceId: number, adminUserId: number): Promise<boolean> {
    const result = await run(
        db,
        `UPDATE life_sentences
            SET is_pinned = 0,
                pinned_at = NULL,
                pinned_by = NULL,
                pin_order = 0,
                moderated_by = ?,
                moderated_at = datetime('now'),
                updated_at = datetime('now')
          WHERE id = ?`,
        [adminUserId, sentenceId]
    );
    return ((result.meta as { changes?: number })?.changes ?? 0) > 0;
}

export async function hideModerationSentence(db: D1Database, sentenceId: number, adminUserId: number, note: string | null = null): Promise<boolean> {
    const result = await run(
        db,
        `UPDATE life_sentences
            SET moderation_status = 'hidden',
                moderation_note = ?,
                moderated_by = ?,
                moderated_at = datetime('now'),
                is_pinned = 0,
                pinned_at = NULL,
                pinned_by = NULL,
                pin_order = 0,
                updated_at = datetime('now')
          WHERE id = ?
            AND deleted_at IS NULL`,
        [note, adminUserId, sentenceId]
    );
    return ((result.meta as { changes?: number })?.changes ?? 0) > 0;
}

export async function softDeleteModerationSentence(db: D1Database, sentenceId: number, adminUserId: number, note: string | null = null): Promise<boolean> {
    const result = await run(
        db,
        `UPDATE life_sentences
            SET deleted_at = COALESCE(deleted_at, datetime('now')),
                moderation_status = 'removed',
                moderation_note = ?,
                moderated_by = ?,
                moderated_at = datetime('now'),
                is_pinned = 0,
                pinned_at = NULL,
                pinned_by = NULL,
                pin_order = 0,
                updated_at = datetime('now')
          WHERE id = ?`,
        [note, adminUserId, sentenceId]
    );
    return ((result.meta as { changes?: number })?.changes ?? 0) > 0;
}

export async function restoreModerationSentence(db: D1Database, sentenceId: number, adminUserId: number, visibility: LifeVisibility = 'private'): Promise<boolean> {
    const result = await run(
        db,
        `UPDATE life_sentences
            SET deleted_at = NULL,
                moderation_status = 'approved',
                visibility = ?,
                is_pinned = 0,
                pinned_at = NULL,
                pinned_by = NULL,
                pin_order = 0,
                moderated_by = ?,
                moderated_at = datetime('now'),
                updated_at = datetime('now')
          WHERE id = ?`,
        [visibility, adminUserId, sentenceId]
    );
    return ((result.meta as { changes?: number })?.changes ?? 0) > 0;
}

export async function changeModerationSentenceVisibility(db: D1Database, sentenceId: number, visibility: LifeVisibility, adminUserId: number): Promise<boolean> {
    const result = await run(
        db,
        `UPDATE life_sentences
            SET visibility = ?,
                moderated_by = ?,
                moderated_at = datetime('now'),
                updated_at = datetime('now')
          WHERE id = ?
            AND deleted_at IS NULL`,
        [visibility, adminUserId, sentenceId]
    );
    return ((result.meta as { changes?: number })?.changes ?? 0) > 0;
}

export async function updateModerationSentenceText(
    db: D1Database,
    sentenceId: number,
    patch: {
        germanText?: string;
        arabicText?: string;
        pronunciationAr?: string | null;
        level?: LifeLevel;
        tense?: string | null;
        moderationNote?: string | null;
    },
    adminUserId: number
): Promise<boolean> {
    const pairs: Array<[string, unknown]> = [];
    if (patch.germanText !== undefined) pairs.push(['german_text', patch.germanText]);
    if (patch.arabicText !== undefined) pairs.push(['arabic_text', patch.arabicText]);
    if (patch.pronunciationAr !== undefined) pairs.push(['pronunciation_ar', patch.pronunciationAr]);
    if (patch.level !== undefined) pairs.push(['level', patch.level]);
    if (patch.tense !== undefined) pairs.push(['tense', patch.tense]);
    if (patch.moderationNote !== undefined) pairs.push(['moderation_note', patch.moderationNote]);
    if (pairs.length === 0) return false;
    const result = await run(
        db,
        `UPDATE life_sentences
            SET ${pairs.map(([field]) => `${field} = ?`).join(', ')},
                moderated_by = ?,
                moderated_at = datetime('now'),
                updated_at = datetime('now')
          WHERE id = ?`,
        [...pairs.map(([, value]) => value), adminUserId, sentenceId]
    );
    return ((result.meta as { changes?: number })?.changes ?? 0) > 0;
}

export async function replaceModerationSentenceKeywords(
    db: D1Database,
    sentenceId: number,
    keywords: Array<{ german_word: string; arabic_meaning: string }>,
    adminUserId: number
): Promise<void> {
    await run(db, 'DELETE FROM life_sentence_keywords WHERE life_sentence_id = ?', [sentenceId]);
    for (const keyword of keywords.slice(0, 5)) {
        const german = keyword.german_word.trim();
        const arabic = keyword.arabic_meaning.trim();
        if (!german || !arabic) continue;
        await run(
            db,
            'INSERT INTO life_sentence_keywords (life_sentence_id, german_word, arabic_meaning) VALUES (?, ?, ?)',
            [sentenceId, german, arabic]
        );
    }
    await run(
        db,
		"UPDATE life_sentences SET moderated_by = ?, moderated_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
        [adminUserId, sentenceId]
    );
}

export async function searchModerationSentences(db: D1Database, query: string, limit: number, offset: number): Promise<ModerationSentenceRow[]> {
    const trimmed = query.trim();
    if (/^\d+$/.test(trimmed)) {
        return queryAll<ModerationSentenceRow>(db, `${SENTENCE_SELECT} WHERE ls.id = ? LIMIT ? OFFSET ?`, [Number(trimmed), limit, offset]);
    }
    const like = `%${escapeAdminLike(trimmed)}%`;
    return queryAll<ModerationSentenceRow>(
        db,
        `${SENTENCE_SELECT}
         WHERE ls.share_code = ?
            OR ls.german_text LIKE ? ESCAPE '\\'
            OR ls.arabic_text LIKE ? ESCAPE '\\'
            OR COALESCE(u.display_name, u.name) LIKE ? ESCAPE '\\'
            OR EXISTS (
                SELECT 1 FROM life_sentence_keywords k
                WHERE k.life_sentence_id = ls.id
                  AND (k.german_word LIKE ? ESCAPE '\\' OR k.arabic_meaning LIKE ? ESCAPE '\\')
            )
         ORDER BY ls.created_at DESC, ls.id DESC
         LIMIT ? OFFSET ?`,
        [trimmed, like, like, like, like, like, limit, offset]
    );
}

export async function listReportedUsers(db: D1Database, limit: number, offset: number): Promise<ReportedUserRow[]> {
    return queryAll<ReportedUserRow>(
        db,
        `SELECT u.user_id,
                COALESCE(u.display_name, u.name) AS display_name,
                COALESCE(u.telegram_user_id, u.telegram_id) AS telegram_user_id,
                COUNT(DISTINCT ls.id) AS sentence_count,
                SUM(CASE WHEN ls.visibility = 'public' AND ls.deleted_at IS NULL THEN 1 ELSE 0 END) AS public_sentence_count,
                COUNT(r.id) AS received_reports,
                SUM(CASE WHEN r.status IN ('reviewed', 'removed') THEN 1 ELSE 0 END) AS accepted_reports,
                COALESCE(lus.life_sharing_suspended, 0) AS life_sharing_suspended,
                u.created_at
         FROM users u
         JOIN life_sentences ls ON ls.user_id = u.user_id
         LEFT JOIN life_sentence_reports r ON r.sentence_id = ls.id
         LEFT JOIN life_user_settings lus ON lus.user_id = u.user_id
         GROUP BY u.user_id
         HAVING received_reports > 0
         ORDER BY received_reports DESC, u.user_id DESC
         LIMIT ? OFFSET ?`,
        [limit, offset]
    );
}

export async function setLifeSharingSuspended(db: D1Database, userId: number, suspended: boolean, adminUserId: number): Promise<boolean> {
    await run(db, 'INSERT OR IGNORE INTO life_user_settings (user_id) VALUES (?)', [userId]);
    const result = await run(
        db,
        `UPDATE life_user_settings
            SET life_sharing_suspended = ?,
                sharing_suspended_at = CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END,
                sharing_suspended_by = CASE WHEN ? = 1 THEN ? ELSE NULL END,
                updated_at = datetime('now')
          WHERE user_id = ?`,
        [suspended ? 1 : 0, suspended ? 1 : 0, suspended ? 1 : 0, adminUserId, userId]
    );
    return ((result.meta as { changes?: number })?.changes ?? 0) > 0;
}

export async function hideAllPublicLifeSentencesForUser(db: D1Database, targetUserId: number, adminUserId: number, note: string | null = null): Promise<number> {
    const result = await run(
        db,
        `UPDATE life_sentences
            SET moderation_status = 'hidden',
                moderation_note = ?,
                moderated_by = ?,
                moderated_at = datetime('now'),
                is_pinned = 0,
                pinned_at = NULL,
                pinned_by = NULL,
                pin_order = 0,
                updated_at = datetime('now')
          WHERE user_id = ?
            AND visibility = 'public'
            AND deleted_at IS NULL`,
        [note, adminUserId, targetUserId]
    );
    return (result.meta as { changes?: number })?.changes ?? 0;
}

export async function getModerationStats(db: D1Database): Promise<ModerationStats> {
    const row = await queryOne<ModerationStats>(
        db,
        `SELECT
            (SELECT COUNT(*) FROM life_sentence_reports WHERE status = 'pending') AS pendingReports,
            (SELECT COUNT(*) FROM life_sentence_reports WHERE status IN ('reviewed', 'dismissed', 'removed')) AS handledReports,
            (SELECT COUNT(*) FROM life_sentences WHERE deleted_at IS NOT NULL OR COALESCE(moderation_status, 'approved') = 'removed') AS deletedSentences,
            (SELECT COUNT(*) FROM life_sentences WHERE COALESCE(moderation_status, 'approved') = 'hidden' AND deleted_at IS NULL) AS hiddenSentences,
            (SELECT COUNT(*) FROM life_sentences WHERE COALESCE(is_pinned, 0) = 1 AND deleted_at IS NULL) AS pinnedSentences,
            (SELECT COUNT(*) FROM life_sentences WHERE visibility = 'public' AND deleted_at IS NULL) AS publicSentences,
            (SELECT COUNT(*) FROM life_user_settings WHERE COALESCE(life_sharing_suspended, 0) = 1) AS suspendedUsers,
            (SELECT COUNT(*) FROM admin_moderation_actions WHERE date(created_at) = date('now')) AS actionsToday,
            (SELECT COUNT(*) FROM admin_moderation_actions WHERE created_at >= datetime('now', '-7 days')) AS actionsThisWeek`
    );
    return row ?? {
        pendingReports: 0,
        handledReports: 0,
        deletedSentences: 0,
        hiddenSentences: 0,
        pinnedSentences: 0,
        publicSentences: 0,
        suspendedUsers: 0,
        actionsToday: 0,
        actionsThisWeek: 0,
    };
}

export async function logModerationAction(
    db: D1Database,
    input: {
        adminUserId: number;
        actionType: ModerationActionType;
        targetSentenceId?: number | null;
        targetUserId?: number | null;
        reportId?: number | null;
        oldValue?: unknown;
        newValue?: unknown;
        note?: string | null;
    }
): Promise<void> {
    await run(
        db,
        `INSERT INTO admin_moderation_actions
            (admin_user_id, action_type, target_sentence_id, target_user_id, report_id, old_value, new_value, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            input.adminUserId,
            input.actionType,
            input.targetSentenceId ?? null,
            input.targetUserId ?? null,
            input.reportId ?? null,
            input.oldValue === undefined ? null : JSON.stringify(input.oldValue),
            input.newValue === undefined ? null : JSON.stringify(input.newValue),
            input.note ?? null,
        ]
    );
}

function escapeAdminLike(value: string): string {
    return value.replace(/[\\%_]/g, char => `\\${char}`);
}
