import type { D1Database } from '@cloudflare/workers-types';
import { queryAll, queryOne, run, runBatch } from '../db/queries.js';

export type GoetheLevel = 'A1' | 'A2' | 'B1';
export type GoetheSection = 'listening' | 'reading' | 'writing' | 'speaking';
export type GoetheFormat = 'mcq_single' | 'true_false' | 'text_input';
export type GoetheImportStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
export type GoetheImportPhase =
    | 'received'
    | 'downloading'
    | 'extracting'
    | 'validating'
    | 'staging_audio'
    | 'importing'
    | 'activating'
    | 'cleanup'
    | 'completed'
    | 'failed';

export interface GoetheImportJob {
    job_id: number;
    admin_user_id: number;
    telegram_chat_id: number;
    telegram_file_id: string;
    telegram_file_name: string;
    telegram_file_size: number | null;
    zip_r2_key: string | null;
    pack_sha256: string | null;
    source_id: number | null;
    status: GoetheImportStatus;
    phase: GoetheImportPhase;
    progress_current: number;
    progress_total: number;
    questions_found: number;
    audio_files_found: number;
    questions_imported: number;
    audio_files_uploaded: number;
    progress_message_id: number | null;
    retry_count: number;
    error_code: string | null;
    error_message: string | null;
    summary_json: string | null;
    created_at: string;
    started_at: string | null;
    finished_at: string | null;
    updated_at: string;
}

export interface GoetheSource {
    source_id: number;
    source_key: string;
    source_name: string;
    publisher: string | null;
    source_year: number | null;
    model_number: string | null;
    revision: number;
    default_level: string | null;
    description: string | null;
    pack_sha256: string;
    status: 'importing' | 'active' | 'disabled' | 'failed';
    rights_confirmed: number;
    question_count: number;
    audio_count: number;
    imported_by_user_id: number | null;
    created_at: string;
    activated_at: string | null;
    disabled_at: string | null;
}

export interface GoetheQuestionInput {
    externalId: string;
    level: GoetheLevel;
    section: GoetheSection;
    format: GoetheFormat;
    scenarioType: string;
    audioR2Key: string | null;
    audioSha256: string | null;
    audioSizeBytes: number | null;
    audioMimeType: string | null;
    instruction: string | null;
    questionText: string;
    correctAnswer: string;
    acceptedAnswers: string[] | null;
    transcript: string | null;
    explanation: string | null;
    difficulty: number;
    tags: string[];
    timeLimitSeconds: number | null;
    points: number;
    options: Array<{ key: string; text: string; sortOrder: number }>;
}

export interface GoetheQuestion extends GoetheQuestionInput {
    question_id: number;
    source_id: number;
    telegram_file_id: string | null;
    is_active: number;
}

export interface GoetheQuestionOption {
    option_id: number;
    question_id: number;
    option_key: string;
    option_text: string;
    sort_order: number;
}

export interface GoetheSession {
    session_id: number;
    user_id: number;
    mode: string;
    level: GoetheLevel;
    section: string | null;
    scenario_type: string | null;
    source_id: number | null;
    status: 'active' | 'finished' | 'expired' | 'cancelled';
    total_questions: number;
    current_position: number;
    correct_count: number;
    wrong_count: number;
    score: number;
    xp_awarded: number;
    started_at: string;
    finished_at: string | null;
    expires_at: string;
}

export interface GoetheSessionQuestion {
    session_question_id: number;
    session_id: number;
    question_id: number;
    position: number;
    deadline_at: string | null;
    answered: number;
    is_correct: number | null;
    selected_answer: string | null;
    response_time_ms: number | null;
    answered_at: string | null;
}

export interface GoetheSessionQuestionDetail extends GoetheSessionQuestion {
    external_id: string;
    level: GoetheLevel;
    section: GoetheSection;
    format: GoetheFormat;
    scenario_type: string;
    audio_r2_key: string | null;
    audio_sha256: string | null;
    audio_size_bytes: number | null;
    audio_mime_type: string | null;
    telegram_file_id: string | null;
    instruction: string | null;
    question_text: string;
    correct_answer: string;
    accepted_answers_json: string | null;
    transcript: string | null;
    explanation: string | null;
    difficulty: number;
    tags_json: string | null;
    time_limit_seconds: number | null;
    points: number;
}

export async function createGoetheImportJob(
    db: D1Database,
    input: {
        adminUserId: number;
        telegramChatId: number;
        telegramFileId: string;
        telegramFileName: string;
        telegramFileSize: number | null;
        progressMessageId: number | null;
    }
): Promise<number> {
    const result = await run(
        db,
        `INSERT INTO goethe_import_jobs
         (admin_user_id, telegram_chat_id, telegram_file_id, telegram_file_name, telegram_file_size, status, phase, progress_message_id)
         VALUES (?, ?, ?, ?, ?, 'pending', 'received', ?)`,
        [input.adminUserId, input.telegramChatId, input.telegramFileId, input.telegramFileName, input.telegramFileSize, input.progressMessageId]
    );
    return (result.meta as { last_row_id?: number })?.last_row_id ?? 0;
}

export async function lockNextGoetheImportJob(db: D1Database): Promise<GoetheImportJob | null> {
    const job = await queryOne<GoetheImportJob>(
        db,
        `SELECT * FROM goethe_import_jobs
         WHERE status = 'pending'
            OR (status = 'processing' AND retry_count < 3 AND updated_at < datetime('now', '-5 minutes'))
         ORDER BY created_at ASC
         LIMIT 1`
    );
    if (!job) return null;
    return lockGoetheImportJobById(db, job.job_id);
}

export async function lockGoetheImportJobById(db: D1Database, jobId: number): Promise<GoetheImportJob | null> {
    const result = await run(
        db,
        `UPDATE goethe_import_jobs
         SET status = 'processing',
             started_at = COALESCE(started_at, datetime('now')),
             updated_at = datetime('now')
         WHERE job_id = ?
           AND (
                status = 'pending'
                OR (status = 'processing' AND retry_count < 3 AND updated_at < datetime('now', '-5 minutes'))
           )`,
        [jobId]
    );
    if (((result.meta as { changes?: number })?.changes ?? 0) === 0) return null;
    return getGoetheImportJob(db, jobId);
}

export async function getGoetheImportJob(db: D1Database, jobId: number): Promise<GoetheImportJob | null> {
    return queryOne<GoetheImportJob>(db, 'SELECT * FROM goethe_import_jobs WHERE job_id = ?', [jobId]);
}

export async function updateGoetheImportJob(
    db: D1Database,
    jobId: number,
    patch: Partial<Pick<GoetheImportJob,
        'status' | 'phase' | 'progress_current' | 'progress_total' | 'questions_found' | 'audio_files_found' |
        'questions_imported' | 'audio_files_uploaded' | 'zip_r2_key' | 'pack_sha256' | 'source_id' |
        'error_code' | 'error_message' | 'summary_json' | 'progress_message_id'
    >> & { incrementRetry?: boolean; finished?: boolean }
): Promise<void> {
    const fields: string[] = ["updated_at = datetime('now')"];
    const values: unknown[] = [];
    for (const [key, column] of Object.entries({
        status: 'status',
        phase: 'phase',
        progress_current: 'progress_current',
        progress_total: 'progress_total',
        questions_found: 'questions_found',
        audio_files_found: 'audio_files_found',
        questions_imported: 'questions_imported',
        audio_files_uploaded: 'audio_files_uploaded',
        zip_r2_key: 'zip_r2_key',
        pack_sha256: 'pack_sha256',
        source_id: 'source_id',
        error_code: 'error_code',
        error_message: 'error_message',
        summary_json: 'summary_json',
        progress_message_id: 'progress_message_id',
    } as Record<string, string>)) {
        if ((patch as Record<string, unknown>)[key] !== undefined) {
            fields.push(`${column} = ?`);
            values.push((patch as Record<string, unknown>)[key]);
        }
    }
    if (patch.incrementRetry) fields.push('retry_count = retry_count + 1');
    if (patch.finished) fields.push("finished_at = datetime('now')");
    values.push(jobId);
    await run(db, `UPDATE goethe_import_jobs SET ${fields.join(', ')} WHERE job_id = ?`, values);
}

export async function addGoetheImportErrors(
    db: D1Database,
    jobId: number,
    errors: Array<{ rowNumber?: number | null; fileName?: string | null; code: string; message: string }>
): Promise<void> {
    const statements = errors.slice(0, 200).map(error => ({
        sql: `INSERT INTO goethe_import_errors (job_id, row_number, file_name, error_code, error_message) VALUES (?, ?, ?, ?, ?)`,
        params: [jobId, error.rowNumber ?? null, error.fileName ?? null, error.code, error.message],
    }));
    if (statements.length) await runBatch(db, statements);
}

export async function findGoetheSourceByPackHash(db: D1Database, hash: string): Promise<GoetheSource | null> {
    return queryOne<GoetheSource>(db, 'SELECT * FROM goethe_sources WHERE pack_sha256 = ?', [hash]);
}

export async function findGoetheSourceRevision(
    db: D1Database,
    sourceName: string,
    modelNumber: string | null,
    revision: number
): Promise<GoetheSource | null> {
    return queryOne<GoetheSource>(
        db,
        "SELECT * FROM goethe_sources WHERE source_name = ? AND COALESCE(model_number, '') = COALESCE(?, '') AND revision = ? LIMIT 1",
        [sourceName, modelNumber, revision]
    );
}

export async function createImportingGoetheSource(
    db: D1Database,
    input: {
        sourceKey: string;
        sourceName: string;
        publisher: string | null;
        sourceYear: number | null;
        modelNumber: string | null;
        revision: number;
        defaultLevel: string | null;
        description: string | null;
        packSha256: string;
        rightsConfirmed: boolean;
        importedByUserId: number;
    }
): Promise<number> {
    const result = await run(
        db,
        `INSERT INTO goethe_sources
         (source_key, source_name, publisher, source_year, model_number, revision, default_level, description, pack_sha256, status, rights_confirmed, imported_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'importing', ?, ?)`,
        [
            input.sourceKey,
            input.sourceName,
            input.publisher,
            input.sourceYear,
            input.modelNumber,
            input.revision,
            input.defaultLevel,
            input.description,
            input.packSha256,
            input.rightsConfirmed ? 1 : 0,
            input.importedByUserId,
        ]
    );
    return (result.meta as { last_row_id?: number })?.last_row_id ?? 0;
}

export async function insertGoetheQuestions(db: D1Database, sourceId: number, questions: GoetheQuestionInput[]): Promise<void> {
    for (const question of questions) {
        const result = await run(
            db,
            `INSERT INTO goethe_questions
             (source_id, external_id, level, section, format, scenario_type, audio_r2_key, audio_sha256, audio_size_bytes, audio_mime_type,
              instruction, question_text, correct_answer, accepted_answers_json, transcript, explanation, difficulty, tags_json, time_limit_seconds, points, is_active)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
            [
                sourceId,
                question.externalId,
                question.level,
                question.section,
                question.format,
                question.scenarioType,
                question.audioR2Key,
                question.audioSha256,
                question.audioSizeBytes,
                question.audioMimeType,
                question.instruction,
                question.questionText,
                question.correctAnswer,
                question.acceptedAnswers ? JSON.stringify(question.acceptedAnswers) : null,
                question.transcript,
                question.explanation,
                question.difficulty,
                JSON.stringify(question.tags),
                question.timeLimitSeconds,
                question.points,
            ]
        );
        const questionId = (result.meta as { last_row_id?: number })?.last_row_id ?? 0;
        if (question.options.length > 0) {
            await runBatch(
                db,
                question.options.map(option => ({
                    sql: `INSERT INTO goethe_question_options (question_id, option_key, option_text, sort_order) VALUES (?, ?, ?, ?)`,
                    params: [questionId, option.key, option.text, option.sortOrder],
                }))
            );
        }
    }
}

export async function activateGoetheSource(db: D1Database, sourceId: number, questionCount: number, audioCount: number): Promise<void> {
    await run(db, "UPDATE goethe_questions SET is_active = 1, updated_at = datetime('now') WHERE source_id = ?", [sourceId]);
    await run(
        db,
        `UPDATE goethe_sources
         SET status = 'active', question_count = ?, audio_count = ?, activated_at = datetime('now')
         WHERE source_id = ? AND status = 'importing'`,
        [questionCount, audioCount, sourceId]
    );
}

export async function failGoetheSource(db: D1Database, sourceId: number | null): Promise<void> {
    if (!sourceId) return;
    await run(db, "UPDATE goethe_sources SET status = 'failed' WHERE source_id = ? AND status = 'importing'", [sourceId]);
    await run(db, 'DELETE FROM goethe_question_options WHERE question_id IN (SELECT question_id FROM goethe_questions WHERE source_id = ? AND is_active = 0)', [sourceId]);
    await run(db, 'DELETE FROM goethe_questions WHERE source_id = ? AND is_active = 0', [sourceId]);
    await run(db, "DELETE FROM goethe_sources WHERE source_id = ? AND status = 'failed'", [sourceId]);
}

export async function listGoetheImports(db: D1Database, limit = 10): Promise<GoetheImportJob[]> {
    return queryAll<GoetheImportJob>(db, 'SELECT * FROM goethe_import_jobs ORDER BY job_id DESC LIMIT ?', [limit]);
}

export async function listGoetheSources(db: D1Database, includeDisabled = true): Promise<GoetheSource[]> {
    return queryAll<GoetheSource>(
        db,
        `SELECT * FROM goethe_sources ${includeDisabled ? '' : "WHERE status = 'active'"} ORDER BY created_at DESC LIMIT 20`
    );
}

export async function setGoetheSourceStatus(db: D1Database, sourceId: number, active: boolean): Promise<boolean> {
    const result = await run(
        db,
        `UPDATE goethe_sources
         SET status = ?, disabled_at = CASE WHEN ? = 'disabled' THEN datetime('now') ELSE NULL END
         WHERE source_id = ? AND status IN ('active', 'disabled')`,
        [active ? 'active' : 'disabled', active ? 'active' : 'disabled', sourceId]
    );
    await run(db, 'UPDATE goethe_questions SET is_active = ? WHERE source_id = ?', [active ? 1 : 0, sourceId]);
    return ((result.meta as { changes?: number })?.changes ?? 0) > 0;
}

export async function getActiveGoetheLevels(db: D1Database): Promise<Array<{ level: GoetheLevel; count: number }>> {
    return queryAll(db, `SELECT level, COUNT(*) AS count FROM goethe_questions WHERE is_active = 1 GROUP BY level ORDER BY level`);
}

export async function selectGoetheQuestionCandidates(
    db: D1Database,
    input: {
        userId: number;
        level: GoetheLevel;
        mode: string;
        limit: number;
        section?: string | null;
        scenarioTypes?: string[];
        sourceId?: number | null;
        weakness?: boolean;
    }
): Promise<Array<{ question_id: number; difficulty: number; section: string; scenario_type: string }>> {
    const filters = ['q.is_active = 1', "s.status = 'active'", 'q.level = ?'];
    const filterParams: unknown[] = [input.level];
    if (input.section) {
        filters.push('q.section = ?');
        filterParams.push(input.section);
    }
    if (input.scenarioTypes?.length) {
        filters.push(`q.scenario_type IN (${input.scenarioTypes.map(() => '?').join(', ')})`);
        filterParams.push(...input.scenarioTypes);
    }
    if (input.sourceId) {
        filters.push('q.source_id = ?');
        filterParams.push(input.sourceId);
    }
    const params: unknown[] = [input.userId, ...filterParams, Math.max(input.limit * 8, input.limit)];

    const order = input.weakness
        ? "COALESCE(st.weakness_score, 0) DESC, COALESCE(st.last_attempt_at, '1970-01-01') ASC, q.difficulty ASC, q.question_id ASC"
        : "COALESCE(st.last_attempt_at, '1970-01-01') ASC, q.difficulty ASC, q.question_id ASC";

    return queryAll(
        db,
        `SELECT q.*, st.last_attempt_at AS recent_attempt_at, COALESCE(st.weakness_score, 0) AS weakness_score
         FROM goethe_questions q
         INNER JOIN goethe_sources s ON s.source_id = q.source_id
         LEFT JOIN goethe_user_question_stats st ON st.question_id = q.question_id AND st.user_id = ?
         WHERE ${filters.join(' AND ')}
         ORDER BY ${order}
         LIMIT ?`,
        params
    );
}

export async function createGoetheSession(
    db: D1Database,
    input: {
        userId: number;
        mode: string;
        level: GoetheLevel;
        section?: string | null;
        scenarioType?: string | null;
        sourceId?: number | null;
        questionIds: number[];
        speedSeconds?: number | null;
    }
): Promise<number> {
    const result = await run(
        db,
        `INSERT INTO goethe_sessions
         (user_id, mode, level, section, scenario_type, source_id, status, total_questions, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?, datetime('now', '+2 hours'))`,
        [input.userId, input.mode, input.level, input.section ?? null, input.scenarioType ?? null, input.sourceId ?? null, input.questionIds.length]
    );
    const sessionId = (result.meta as { last_row_id?: number })?.last_row_id ?? 0;
    const statements = input.questionIds.map((questionId, index) => ({
        sql: `INSERT INTO goethe_session_questions (session_id, question_id, position, deadline_at)
              VALUES (?, ?, ?, ${input.speedSeconds ? "datetime('now', ?)" : 'NULL'})`,
        params: input.speedSeconds ? [sessionId, questionId, index, `+${input.speedSeconds} seconds`] : [sessionId, questionId, index],
    }));
    if (statements.length) await runBatch(db, statements);
    return sessionId;
}

export async function getActiveGoetheSession(db: D1Database, userId: number): Promise<GoetheSession | null> {
    return queryOne(db, `SELECT * FROM goethe_sessions WHERE user_id = ? AND status = 'active' AND expires_at > datetime('now') ORDER BY session_id DESC LIMIT 1`, [userId]);
}

export async function getGoetheSession(db: D1Database, sessionId: number): Promise<GoetheSession | null> {
    return queryOne(db, 'SELECT * FROM goethe_sessions WHERE session_id = ?', [sessionId]);
}

export async function getCurrentGoetheQuestion(db: D1Database, sessionId: number): Promise<GoetheSessionQuestionDetail | null> {
    return queryOne(
        db,
        `SELECT sq.*, q.external_id, q.level, q.section, q.format, q.scenario_type, q.audio_r2_key, q.audio_sha256,
                q.audio_size_bytes, q.audio_mime_type, q.telegram_file_id, q.instruction, q.question_text,
                q.correct_answer, q.accepted_answers_json, q.transcript, q.explanation, q.difficulty,
                q.tags_json, q.time_limit_seconds, q.points
         FROM goethe_session_questions sq
         INNER JOIN goethe_questions q ON q.question_id = sq.question_id
         INNER JOIN goethe_sessions s ON s.session_id = sq.session_id
         WHERE sq.session_id = ? AND sq.position = s.current_position
         LIMIT 1`,
        [sessionId]
    );
}

export async function getGoetheQuestionOptions(db: D1Database, questionId: number): Promise<GoetheQuestionOption[]> {
    return queryAll(db, 'SELECT * FROM goethe_question_options WHERE question_id = ? ORDER BY sort_order ASC', [questionId]);
}

export async function markGoetheQuestionAnswered(
    db: D1Database,
    input: {
        sessionQuestionId: number;
        selectedAnswer: string;
        isCorrect: boolean;
        responseTimeMs: number | null;
    }
): Promise<boolean> {
    const result = await run(
        db,
        `UPDATE goethe_session_questions
         SET answered = 1, is_correct = ?, selected_answer = ?, response_time_ms = ?, answered_at = datetime('now')
         WHERE session_question_id = ? AND answered = 0`,
        [input.isCorrect ? 1 : 0, input.selectedAnswer, input.responseTimeMs, input.sessionQuestionId]
    );
    return ((result.meta as { changes?: number })?.changes ?? 0) > 0;
}

export async function recordGoetheAttempt(
    db: D1Database,
    input: {
        userId: number;
        sessionId: number;
        questionId: number;
        mode: string;
        selectedAnswer: string;
        correctAnswer: string;
        isCorrect: boolean;
        responseTimeMs: number | null;
        pointsAwarded: number;
        xpAwarded: number;
        timeout?: boolean;
    }
): Promise<void> {
    await run(
        db,
        `INSERT INTO goethe_attempts
         (user_id, session_id, question_id, mode, selected_answer, correct_answer, is_correct, response_time_ms, points_awarded, xp_awarded)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [input.userId, input.sessionId, input.questionId, input.mode, input.selectedAnswer, input.correctAnswer, input.isCorrect ? 1 : 0, input.responseTimeMs, input.pointsAwarded, input.xpAwarded]
    );
    const delta = input.isCorrect ? -1 : input.timeout ? 4 : 3;
    await run(
        db,
        `INSERT INTO goethe_user_question_stats
         (user_id, question_id, attempts, correct_attempts, wrong_attempts, weakness_score, last_result, last_attempt_at, last_correct_at, average_response_ms)
         VALUES (?, ?, 1, ?, ?, MAX(0, ?), ?, datetime('now'), CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END, ?)
         ON CONFLICT(user_id, question_id) DO UPDATE SET
             attempts = attempts + 1,
             correct_attempts = correct_attempts + excluded.correct_attempts,
             wrong_attempts = wrong_attempts + excluded.wrong_attempts,
             weakness_score = MAX(0, weakness_score + ?),
             last_result = excluded.last_result,
             last_attempt_at = datetime('now'),
             last_correct_at = CASE WHEN excluded.last_result = 1 THEN datetime('now') ELSE last_correct_at END,
             average_response_ms = CASE
                 WHEN excluded.average_response_ms IS NULL THEN average_response_ms
                 WHEN average_response_ms IS NULL THEN excluded.average_response_ms
                 ELSE CAST(((average_response_ms * attempts) + excluded.average_response_ms) / (attempts + 1) AS INTEGER)
             END,
             updated_at = datetime('now')`,
        [
            input.userId,
            input.questionId,
            input.isCorrect ? 1 : 0,
            input.isCorrect ? 0 : 1,
            Math.max(0, delta),
            input.isCorrect ? 1 : 0,
            input.isCorrect ? 1 : 0,
            input.responseTimeMs,
            delta,
        ]
    );
}

export async function advanceGoetheSession(
    db: D1Database,
    sessionId: number,
    isCorrect: boolean,
    points: number,
    xpAwarded: number
): Promise<GoetheSession> {
    await run(
        db,
        `UPDATE goethe_sessions
         SET current_position = current_position + 1,
             correct_count = correct_count + ?,
             wrong_count = wrong_count + ?,
             score = score + ?,
             xp_awarded = xp_awarded + ?
         WHERE session_id = ? AND status = 'active'`,
        [isCorrect ? 1 : 0, isCorrect ? 0 : 1, isCorrect ? points : 0, xpAwarded, sessionId]
    );
    const session = await getGoetheSession(db, sessionId);
    if (!session) throw new Error('goethe_session_missing');
    if (session.current_position >= session.total_questions) {
        await run(db, `UPDATE goethe_sessions SET status = 'finished', finished_at = datetime('now') WHERE session_id = ?`, [sessionId]);
        return { ...session, status: 'finished', finished_at: new Date().toISOString() };
    }
    return session;
}

export async function getGoetheSessionReview(db: D1Database, sessionId: number, userId: number): Promise<Array<GoetheSessionQuestionDetail & { user_answer: string | null; correct: number | null }>> {
    return queryAll(
        db,
        `SELECT sq.*, sq.selected_answer AS user_answer, sq.is_correct AS correct,
                q.external_id, q.level, q.section, q.format, q.scenario_type, q.audio_r2_key, q.audio_sha256,
                q.audio_size_bytes, q.audio_mime_type, q.telegram_file_id, q.instruction, q.question_text,
                q.correct_answer, q.accepted_answers_json, q.transcript, q.explanation, q.difficulty,
                q.tags_json, q.time_limit_seconds, q.points
         FROM goethe_session_questions sq
         INNER JOIN goethe_questions q ON q.question_id = sq.question_id
         INNER JOIN goethe_sessions s ON s.session_id = sq.session_id
         WHERE sq.session_id = ? AND s.user_id = ?
         ORDER BY sq.position ASC
         LIMIT 100`,
        [sessionId, userId]
    );
}

export async function getGoetheUserStats(db: D1Database, userId: number): Promise<{
    sessions: number;
    questions: number;
    correct: number;
    avg_ms: number | null;
    weak: Array<{ scenario_type: string; weakness: number }>;
}> {
    const aggregate = await queryOne<{ sessions: number; questions: number; correct: number; avg_ms: number | null }>(
        db,
        `SELECT
             (SELECT COUNT(*) FROM goethe_sessions WHERE user_id = ?) AS sessions,
             COUNT(*) AS questions,
             SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) AS correct,
             CAST(AVG(response_time_ms) AS INTEGER) AS avg_ms
         FROM goethe_attempts WHERE user_id = ?`,
        [userId, userId]
    );
    const weak = await queryAll<{ scenario_type: string; weakness: number }>(
        db,
        `SELECT q.scenario_type, SUM(st.weakness_score) AS weakness
         FROM goethe_user_question_stats st
         INNER JOIN goethe_questions q ON q.question_id = st.question_id
         WHERE st.user_id = ?
         GROUP BY q.scenario_type
         ORDER BY weakness DESC
         LIMIT 5`,
        [userId]
    );
    return {
        sessions: aggregate?.sessions ?? 0,
        questions: aggregate?.questions ?? 0,
        correct: aggregate?.correct ?? 0,
        avg_ms: aggregate?.avg_ms ?? null,
        weak,
    };
}

export async function updateGoetheQuestionTelegramFileId(db: D1Database, questionId: number, fileId: string): Promise<void> {
    await run(db, "UPDATE goethe_questions SET telegram_file_id = ?, updated_at = datetime('now') WHERE question_id = ?", [fileId, questionId]);
}
