import { InlineKeyboard } from 'grammy';
import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '../models/index.js';
import {
    activateGoetheSource,
    addGoetheImportErrors,
    createImportingGoetheSource,
    failGoetheSource,
    findGoetheSourceByPackHash,
    findGoetheSourceRevision,
    insertGoetheQuestions,
    listGoetheImports,
    lockGoetheImportJobById,
    lockNextGoetheImportJob,
    updateGoetheImportJob,
    type GoetheImportJob,
} from '../repositories/goetheRepository.js';
import { GoethePackValidationError, getGoethePackLimits, parseGoethePack, type GoethePackAudio, type GoethePackParseResult } from './goethePackParser.js';
import { sendTelegramPlainMessage } from './notifications.js';

const MAX_GOETHE_JOBS_PER_CRON = 1;

export async function processPendingGoetheImports(env: Env, bot?: any): Promise<void> {
    for (let processed = 0; processed < MAX_GOETHE_JOBS_PER_CRON; processed += 1) {
        const job = await lockNextGoetheImportJob(env.DB);
        if (!job) return;
        await processGoetheImportJob(env, job, bot).catch(error => console.error('goethe_import_job_failed', sanitizeError(error)));
    }
}

export async function processGoetheImportJobById(env: Env, jobId: number, bot?: any): Promise<void> {
    const job = await lockGoetheImportJobById(env.DB, jobId);
    if (!job) return;
    await updateGoetheImportJob(env.DB, job.job_id, { phase: 'downloading' });
    await processGoetheImportJob(env, job, bot);
}

async function processGoetheImportJob(env: Env, job: GoetheImportJob, bot?: any): Promise<void> {
    let sourceId: number | null = job.source_id;
    const stagingKeys: string[] = [];
    const finalKeys: string[] = [];
    try {
        ensureGoetheBucket(env);
        await updateProgress(env, bot, job, 'downloading', 'تنزيل الحزمة', 0, 0);
        const zip = await downloadTelegramFile(env, job.telegram_file_id);
        const zipR2Key = `goethe/staging/${job.job_id}/pack.zip`;
        await env.GOETHE_AUDIO!.put(zipR2Key, zip, {
            httpMetadata: { contentType: 'application/zip' },
            customMetadata: { telegram_file_name: job.telegram_file_name },
        });
        stagingKeys.push(zipR2Key);
        await updateGoetheImportJob(env.DB, job.job_id, { zip_r2_key: zipR2Key });

        await updateProgress(env, bot, job, 'extracting', 'فك الضغط', 0, 0);
        const pack = await parseGoethePack(zip, env);
        await updateGoetheImportJob(env.DB, job.job_id, {
            pack_sha256: pack.packSha256,
            questions_found: pack.questions.length,
            audio_files_found: uniqueAudioCount(pack),
        });

        const duplicate = await findGoetheSourceByPackHash(env.DB, pack.packSha256);
        if (duplicate) {
            await failWithReport(env, bot, job, 'duplicate_pack', `⚠️ هذه الحزمة مستوردة مسبقاً\nImport ID: ${duplicate.source_id}\nSource: ${duplicate.source_name}\nQuestions: ${duplicate.question_count}`);
            return;
        }

        const revisionConflict = await findGoetheSourceRevision(env.DB, pack.sourceName, pack.modelNumber, pack.revision);
        if (revisionConflict && revisionConflict.pack_sha256 !== pack.packSha256) {
            await failWithReport(env, bot, job, 'revision_conflict', `Revision conflict: ${pack.sourceName} v${pack.revision} موجود مسبقاً بحزمة مختلفة.`);
            return;
        }

        await updateProgress(env, bot, job, 'staging_audio', 'رفع الصوتيات', 0, uniqueAudioCount(pack));
        const audioNameToR2 = new Map<string, string>();
        let uploaded = 0;
        for (const audio of uniqueAudioItems(pack)) {
            const finalKey = `goethe/audio/${pack.defaultLevel.toLowerCase()}/${pack.sourceKey}/v${pack.revision}/${audio.normalizedName.split('/').pop()}`;
            await env.GOETHE_AUDIO!.put(finalKey, audio.bytes, {
                httpMetadata: { contentType: audio.mimeType },
                customMetadata: { sha256: audio.sha256, source: pack.sourceKey },
            });
            finalKeys.push(finalKey);
            audioNameToR2.set(audio.normalizedName, finalKey);
            audioNameToR2.set(audio.normalizedName.split('/').pop() ?? audio.normalizedName, finalKey);
            uploaded += 1;
            await updateGoetheImportJob(env.DB, job.job_id, { audio_files_uploaded: uploaded, progress_current: uploaded, progress_total: uniqueAudioCount(pack) });
        }

        await updateProgress(env, bot, job, 'importing', 'استيراد الأسئلة', 0, pack.questions.length);
        sourceId = await createImportingGoetheSource(env.DB, {
            sourceKey: pack.sourceKey,
            sourceName: pack.sourceName,
            publisher: pack.publisher,
            sourceYear: pack.sourceYear,
            modelNumber: pack.modelNumber,
            revision: pack.revision,
            defaultLevel: pack.defaultLevel,
            description: pack.description,
            packSha256: pack.packSha256,
            rightsConfirmed: pack.rightsConfirmed,
            importedByUserId: job.admin_user_id,
        });
        await updateGoetheImportJob(env.DB, job.job_id, { source_id: sourceId });

        const questions = pack.questions.map(question => ({
            ...question,
            audioR2Key: question.audioR2Key ? audioNameToR2.get(question.audioR2Key) ?? audioNameToR2.get(question.audioR2Key.split('/').pop() ?? '') ?? question.audioR2Key : null,
        }));
        await insertGoetheQuestions(env.DB, sourceId, questions);

        await updateProgress(env, bot, job, 'activating', 'تفعيل الحزمة', pack.questions.length, pack.questions.length);
        await activateGoetheSource(env.DB, sourceId, pack.questions.length, uniqueAudioCount(pack));

        await updateProgress(env, bot, job, 'cleanup', 'تنظيف staging', 1, 1);
        await cleanupKeys(env, stagingKeys);
        const summary = buildImportSummary(pack, job.job_id);
        await updateGoetheImportJob(env.DB, job.job_id, {
            status: 'completed',
            phase: 'completed',
            questions_imported: pack.questions.length,
            audio_files_uploaded: uniqueAudioCount(pack),
            summary_json: JSON.stringify(summary),
            progress_current: pack.questions.length,
            progress_total: pack.questions.length,
            error_code: null,
            error_message: null,
            finished: true,
        });
        await sendCompletion(env, bot, job, formatImportComplete(summary));
    } catch (error) {
        await failGoetheSource(env.DB, sourceId);
        await cleanupKeys(env, [...stagingKeys, ...finalKeys]).catch(() => undefined);
        if (error instanceof GoethePackValidationError) {
            await addGoetheImportErrors(env.DB, job.job_id, error.errors);
            await failWithReport(env, bot, job, 'validation_failed', formatValidationFailure(job.job_id, error.errors));
            return;
        }
        const message = error instanceof Error ? error.message : String(error);
        const transient = isTransientError(message);
        const canRetry = transient && job.retry_count < 2;
        await updateGoetheImportJob(env.DB, job.job_id, {
            status: canRetry ? 'pending' : 'failed',
            phase: canRetry ? 'received' : 'failed',
            error_code: transient ? 'transient_error' : 'import_error',
            error_message: message.slice(0, 300),
            incrementRetry: transient,
            finished: !canRetry,
        });
        if (canRetry) {
            await sendCompletion(env, bot, job, `⚠️ Import مؤقتاً فشل وسيعاد تلقائياً\n\nImport ID: #${job.job_id}\nError: ${safeText(message)}`);
        } else {
            await sendCompletion(env, bot, job, `❌ Import Failed\n\nImport ID: #${job.job_id}\nPhase: ${job.phase}\nError: ${safeText(message)}\n\nلم تتم إضافة أو تفعيل أي أسئلة.`);
        }
    }
}

function ensureGoetheBucket(env: Env): void {
    if (!env.GOETHE_AUDIO) throw new Error('GOETHE_AUDIO_R2_NOT_CONFIGURED');
}

async function downloadTelegramFile(env: Env, fileId: string): Promise<Uint8Array> {
    const limits = getGoethePackLimits(env);
    const info = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`);
    const payload = await info.json<{ ok?: boolean; result?: { file_path?: string; file_size?: number } }>().catch(() => null);
    const path = payload?.ok ? payload.result?.file_path : null;
    if (!path) throw new Error('telegram_get_file_failed');
    if (payload?.result?.file_size && payload.result.file_size > limits.maxCompressedBytes) {
        throw new GoethePackValidationError([{ code: 'pack_too_large', message: `ZIP أكبر من الحد: ${limits.maxCompressedBytes} bytes` }]);
    }
    const response = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${path}`);
    if (!response.ok) throw new Error(`telegram_file_download_failed_${response.status}`);
    const contentLength = Number(response.headers.get('content-length') ?? 0);
    if (contentLength > limits.maxCompressedBytes) {
        throw new GoethePackValidationError([{ code: 'pack_too_large', message: `ZIP أكبر من الحد: ${limits.maxCompressedBytes} bytes` }]);
    }
    return new Uint8Array(await response.arrayBuffer());
}

async function updateProgress(
    env: Env,
    bot: any,
    job: GoetheImportJob,
    phase: GoetheImportJob['phase'],
    label: string,
    current: number,
    total: number
): Promise<void> {
    await updateGoetheImportJob(env.DB, job.job_id, { phase, progress_current: current, progress_total: total });
    const api = bot?.api ?? null;
    if (!api || !job.progress_message_id) return;
    await api.editMessageText(job.telegram_chat_id, job.progress_message_id, `📦 Goethe Import #${job.job_id}\nمرحلة: ${label}\nالتقدم: ${total ? `${current} / ${total}` : '0%'}`).catch(() => undefined);
}

async function failWithReport(env: Env, bot: any, job: GoetheImportJob, code: string, message: string): Promise<void> {
    await updateGoetheImportJob(env.DB, job.job_id, {
        status: 'failed',
        phase: 'failed',
        error_code: code,
        error_message: message.slice(0, 300),
        finished: true,
    });
    await sendCompletion(env, bot, job, `❌ Import Failed\n\nImport ID: #${job.job_id}\n${message}\n\nلم تتم إضافة أو تفعيل أي أسئلة.`);
}

async function sendCompletion(env: Env, bot: any, job: GoetheImportJob, text: string): Promise<void> {
    const keyboard = new InlineKeyboard()
        .text('📦 آخر الاستيرادات', 'goethe_imports').row()
        .text('📚 مصادر غوته', 'goethe_sources').row()
        .text('🏠 الرئيسية', 'menu_main');
    if (bot?.api && job.progress_message_id) {
        await bot.api.editMessageText(job.telegram_chat_id, job.progress_message_id, text, { reply_markup: keyboard }).catch(() => undefined);
        return;
    }
    await sendTelegramPlainMessage(env, job.telegram_chat_id, text, keyboard);
}

function buildImportSummary(pack: GoethePackParseResult, jobId: number) {
    return {
        importId: jobId,
        source: pack.sourceName,
        revision: pack.revision,
        levels: Object.keys(pack.summary.levels),
        questions: pack.questions.length,
        audioFiles: uniqueAudioCount(pack),
        sections: pack.summary.sections,
        scenarioTypes: pack.summary.scenarioTypes,
        difficulty: pack.summary.difficulty,
    };
}

function formatImportComplete(summary: ReturnType<typeof buildImportSummary>): string {
    return `✅ Import Complete\n\n` +
        `📦 Source: ${summary.source}\n` +
        `🔢 Revision: ${summary.revision}\n` +
        `🎓 Levels: ${summary.levels.join(', ')}\n` +
        `❓ Questions: ${summary.questions}\n` +
        `🎧 Audio Files: ${summary.audioFiles}\n\n` +
        `Sections:\n${formatCounter(summary.sections)}\n\n` +
        `Types:\n${formatCounter(summary.scenarioTypes)}\n\n` +
        `Difficulty:\n${formatCounter(summary.difficulty)}\n\n` +
        `Import ID: #${summary.importId}`;
}

function formatValidationFailure(jobId: number, errors: Array<{ rowNumber?: number | null; fileName?: string | null; code: string; message: string }>): string {
    const head = errors.slice(0, 12).map(error => {
        const where = error.rowNumber ? `Row ${error.rowNumber}` : error.fileName ? error.fileName : error.code;
        return `• ${where}: ${error.message}`;
    }).join('\n');
    const tail = errors.length > 12 ? `\n... و${errors.length - 12} أخطاء أخرى` : '';
    return `Import ID: #${jobId}\nPhase: Validation\nErrors: ${errors.length}\n\n${head}${tail}`;
}

function uniqueAudioItems(pack: GoethePackParseResult): GoethePackAudio[] {
    const map = new Map<string, GoethePackAudio>();
    for (const item of pack.audio.values()) map.set(item.normalizedName, item);
    return [...map.values()];
}

function uniqueAudioCount(pack: GoethePackParseResult): number {
    return uniqueAudioItems(pack).length;
}

function formatCounter(counter: Record<string, number>): string {
    return Object.entries(counter)
        .map(([key, value]) => `• ${key}: ${value}`)
        .join('\n') || '• لا يوجد';
}

async function cleanupKeys(env: Env, keys: string[]): Promise<void> {
    if (!env.GOETHE_AUDIO) return;
    await Promise.all(keys.map(key => env.GOETHE_AUDIO!.delete(key).catch(() => undefined)));
}

function isTransientError(message: string): boolean {
    return /telegram|r2|fetch|timeout|network|5\d\d/i.test(message);
}

function sanitizeError(error: unknown): Record<string, unknown> {
    return { message: error instanceof Error ? error.message : String(error) };
}

function safeText(value: string): string {
    return value.replace(/[A-Za-z0-9_-]{24,}/g, '[redacted]').slice(0, 300);
}

export async function formatGoetheImportsList(db: D1Database): Promise<string> {
    const jobs = await listGoetheImports(db, 10);
    if (!jobs.length) return '📦 لا توجد عمليات استيراد Goethe بعد.';
    return `📦 آخر عمليات Goethe Import\n\n` + jobs.map(job =>
        `#${job.job_id} — ${job.status}\n` +
        `Phase: ${job.phase}\n` +
        `File: ${job.telegram_file_name}\n` +
        `Questions: ${job.questions_imported || job.questions_found}\n` +
        (job.error_code ? `Error: ${job.error_code}\n` : '')
    ).join('\n');
}
