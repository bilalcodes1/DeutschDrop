import { AsyncUnzipInflate, Unzip, UnzipPassThrough } from 'fflate';
import type { Env } from '../models/index.js';
import type { GoetheFormat, GoetheLevel, GoetheQuestionInput, GoetheSection } from '../repositories/goetheRepository.js';

export interface GoethePackLimits {
    maxCompressedBytes: number;
    maxUncompressedBytes: number;
    maxFiles: number;
    maxAudioFileBytes: number;
    maxQuestions: number;
    maxCompressionRatio: number;
}

export interface GoethePackManifest {
    schema_version?: number;
    source_name?: string;
    source_year?: number;
    model_number?: string;
    publisher?: string;
    default_level?: string;
    revision?: number;
    language?: string;
    description?: string;
    rights_confirmed?: boolean;
}

export interface GoethePackAudio {
    normalizedName: string;
    originalName: string;
    bytes: Uint8Array;
    sha256: string;
    mimeType: string;
}

export interface GoethePackParseResult {
    manifest: GoethePackManifest;
    sourceName: string;
    sourceKey: string;
    publisher: string | null;
    sourceYear: number | null;
    modelNumber: string | null;
    revision: number;
    defaultLevel: GoetheLevel;
    description: string | null;
    rightsConfirmed: boolean;
    packSha256: string;
    questions: GoetheQuestionInput[];
    audio: Map<string, GoethePackAudio>;
    summary: {
        sections: Record<string, number>;
        scenarioTypes: Record<string, number>;
        difficulty: Record<string, number>;
        levels: Record<string, number>;
    };
}

export interface GoethePackError {
    rowNumber?: number | null;
    fileName?: string | null;
    code: string;
    message: string;
}

export class GoethePackValidationError extends Error {
    constructor(readonly errors: GoethePackError[]) {
        super('goethe_pack_validation_failed');
    }
}

const ALLOWED_LEVELS = new Set(['A1', 'A2', 'B1']);
const ALLOWED_SECTIONS = new Set(['listening', 'reading', 'writing', 'speaking']);
const ALLOWED_FORMATS = new Set(['mcq_single', 'true_false', 'text_input']);
const ALLOWED_AUDIO_EXTENSIONS = new Set(['.mp3', '.ogg', '.wav', '.m4a']);
const REQUIRED_COLUMNS = ['external_id', 'level', 'section', 'format', 'question', 'correct_answer', 'difficulty'];

export function getGoethePackLimits(env: Env): GoethePackLimits {
    return {
        maxCompressedBytes: readInt(env.GOETHE_PACK_MAX_COMPRESSED_BYTES, 50 * 1024 * 1024),
        maxUncompressedBytes: readInt(env.GOETHE_PACK_MAX_UNCOMPRESSED_BYTES, 200 * 1024 * 1024),
        maxFiles: readInt(env.GOETHE_PACK_MAX_FILES, 500),
        maxAudioFileBytes: readInt(env.GOETHE_PACK_MAX_AUDIO_FILE_BYTES, 15 * 1024 * 1024),
        maxQuestions: readInt(env.GOETHE_PACK_MAX_QUESTIONS, 1000),
        maxCompressionRatio: readInt(env.GOETHE_PACK_MAX_COMPRESSION_RATIO, 30),
    };
}

export async function parseGoethePack(zipBytes: Uint8Array, env: Env): Promise<GoethePackParseResult> {
    const limits = getGoethePackLimits(env);
    const errors: GoethePackError[] = [];

    if (zipBytes.byteLength > limits.maxCompressedBytes) {
        throw new GoethePackValidationError([{ code: 'pack_too_large', message: `ZIP أكبر من الحد: ${limits.maxCompressedBytes} bytes` }]);
    }

    const packSha256 = await sha256Hex(zipBytes);
    const files = await unzipBounded(zipBytes, limits);
    const normalizedFiles = new Map<string, { originalName: string; bytes: Uint8Array }>();

    for (const [name, bytes] of Object.entries(files)) {
        const safe = normalizeZipPath(name);
        if (!safe.ok) {
            errors.push({ fileName: name, code: 'unsafe_path', message: safe.reason });
            continue;
        }
        const normalizedName = safe.path;
        if (normalizedFiles.has(normalizedName)) {
            errors.push({ fileName: name, code: 'duplicate_file_name', message: `اسم ملف مكرر بعد التنظيف: ${normalizedName}` });
            continue;
        }
        if (normalizedName.length > 180) errors.push({ fileName: name, code: 'file_name_too_long', message: 'اسم الملف طويل جداً' });
        if (normalizedName.startsWith('.') || normalizedName.includes('/.')) errors.push({ fileName: name, code: 'hidden_file', message: 'ملف مخفي غير مسموح' });
        if (normalizedName.endsWith('.zip')) errors.push({ fileName: name, code: 'nested_zip', message: 'ZIP داخل ZIP غير مسموح' });
        const ext = extensionOf(normalizedName);
        if (!['.csv', '.json', ...ALLOWED_AUDIO_EXTENSIONS].includes(ext)) {
            errors.push({ fileName: name, code: 'unsupported_extension', message: `امتداد غير مدعوم: ${ext}` });
        }
        normalizedFiles.set(normalizedName, { originalName: name, bytes });
    }

    const csvFiles = [...normalizedFiles.keys()].filter(name => name.endsWith('questions.csv'));
    if (csvFiles.length !== 1) errors.push({ code: 'questions_csv_count', message: 'questions.csv يجب أن يكون موجوداً مرة واحدة فقط' });

    const manifestFiles = [...normalizedFiles.keys()].filter(name => name.endsWith('manifest.json'));
    if (manifestFiles.length > 1) errors.push({ code: 'manifest_count', message: 'manifest.json يجب أن لا يتكرر' });

    if (errors.length) throw new GoethePackValidationError(errors);

    const manifest = manifestFiles.length === 1 ? parseManifest(decodeUtf8(normalizedFiles.get(manifestFiles[0])!.bytes), errors) : {};
    const csvText = stripBom(decodeUtf8(normalizedFiles.get(csvFiles[0])!.bytes));
    const rows = parseCsv(csvText);
    if (rows.length < 2) errors.push({ fileName: 'questions.csv', code: 'empty_csv', message: 'questions.csv فارغ' });
    const headers = rows[0].map(normalizeHeader);
    for (const column of REQUIRED_COLUMNS) {
        if (!headers.includes(column)) errors.push({ fileName: 'questions.csv', code: 'missing_column', message: `العمود مفقود: ${column}` });
    }
    if (errors.length) throw new GoethePackValidationError(errors);

    const records = rows.slice(1).map((row, index) => rowToRecord(headers, row, index + 2));
    if (records.length > limits.maxQuestions) {
        errors.push({ code: 'too_many_questions', message: `عدد الأسئلة يتجاوز ${limits.maxQuestions}` });
    }

    const sourceName = clean(records[0]?.source_name) || clean(manifest.source_name) || '';
    const sourceYear = parseOptionalInt(clean(records[0]?.source_year) || manifest.source_year);
    const modelNumber = clean(records[0]?.model_number) || clean(manifest.model_number) || null;
    const publisher = clean(manifest.publisher) || null;
    const revision = parseOptionalInt(manifest.revision) ?? 1;
    const defaultLevel = normalizeLevel(clean(manifest.default_level) || clean(records[0]?.level) || '');
    const description = clean(manifest.description) || null;
    const rightsConfirmed = manifest.rights_confirmed === true || records.some(row => normalizeBool(row.rights_confirmed));

    if (!sourceName) errors.push({ code: 'source_name_missing', message: 'source_name مطلوب في manifest أو CSV' });
    if (!defaultLevel) errors.push({ code: 'default_level_missing', message: 'default_level مطلوب' });
    if (!rightsConfirmed) errors.push({ code: 'rights_not_confirmed', message: 'rights_confirmed يجب أن يكون true' });

    const audio = new Map<string, GoethePackAudio>();
    for (const [name, file] of normalizedFiles) {
        const ext = extensionOf(name);
        if (!ALLOWED_AUDIO_EXTENSIONS.has(ext)) continue;
        if (file.bytes.byteLength > limits.maxAudioFileBytes) {
            errors.push({ fileName: name, code: 'audio_too_large', message: 'ملف صوت أكبر من الحد' });
            continue;
        }
        const mimeType = detectAudioMimeType(file.bytes, ext);
        if (!mimeType) {
            errors.push({ fileName: name, code: 'invalid_audio', message: 'ملف الصوت لا يطابق magic bytes' });
            continue;
        }
        audio.set(name, {
            normalizedName: name,
            originalName: file.originalName,
            bytes: file.bytes,
            sha256: await sha256Hex(file.bytes),
            mimeType,
        });
        audio.set(baseName(name), {
            normalizedName: name,
            originalName: file.originalName,
            bytes: file.bytes,
            sha256: await sha256Hex(file.bytes),
            mimeType,
        });
    }

    const seenExternalIds = new Set<string>();
    const normalizedQuestions = new Set<string>();
    const questions: GoetheQuestionInput[] = [];
    const summary = { sections: {}, scenarioTypes: {}, difficulty: {}, levels: {} } as GoethePackParseResult['summary'];

    for (const record of records) {
        const row = record.__rowNumber;
        const externalId = clean(record.external_id);
        const level = normalizeLevel(record.level);
        const section = normalizeSection(record.section);
        const format = normalizeFormat(record.format);
        const scenarioType = normalizeSlug(clean(record.scenario_type) || 'general');
        const difficulty = parseIntStrict(record.difficulty);
        const questionText = clean(record.question);
        const correctAnswer = clean(record.correct_answer);
        const points = clamp(parseOptionalInt(record.points) ?? 10, 1, 50);
        const timeLimitSeconds = record.time_limit_seconds ? clamp(parseOptionalInt(record.time_limit_seconds) ?? 0, 5, 300) : null;

        if (!externalId) errors.push({ rowNumber: row, code: 'external_id_missing', message: 'external_id مطلوب' });
        if (externalId && seenExternalIds.has(externalId)) errors.push({ rowNumber: row, code: 'duplicate_external_id', message: `external_id مكرر: ${externalId}` });
        if (externalId) seenExternalIds.add(externalId);
        if (!level) errors.push({ rowNumber: row, code: 'invalid_level', message: 'level يجب أن يكون A1/A2/B1' });
        if (!section) errors.push({ rowNumber: row, code: 'invalid_section', message: 'section غير صحيح' });
        if (!format) errors.push({ rowNumber: row, code: 'invalid_format', message: 'format غير صحيح' });
        if (!questionText) errors.push({ rowNumber: row, code: 'question_missing', message: 'question مطلوب' });
        if (!correctAnswer) errors.push({ rowNumber: row, code: 'correct_answer_missing', message: 'correct_answer مطلوب' });
        if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) errors.push({ rowNumber: row, code: 'invalid_difficulty', message: 'difficulty يجب أن يكون 1-5' });

        const options = buildOptions(record);
        validateAnswerRules(record, format, correctAnswer, options, row, errors);

        const audioFile = normalizeAudioReference(record.audio_file);
        let audioItem: GoethePackAudio | undefined;
        if (section === 'listening') {
            if (!audioFile) {
                errors.push({ rowNumber: row, code: 'audio_missing', message: 'audio_file مطلوب لقسم listening' });
            } else {
                audioItem = audio.get(audioFile) || audio.get(baseName(audioFile));
                if (!audioItem) errors.push({ rowNumber: row, fileName: audioFile, code: 'audio_file_not_found', message: `ملف الصوت غير موجود: ${audioFile}` });
            }
        } else if (audioFile) {
            audioItem = audio.get(audioFile) || audio.get(baseName(audioFile));
            if (!audioItem) errors.push({ rowNumber: row, fileName: audioFile, code: 'audio_file_not_found', message: `ملف الصوت غير موجود: ${audioFile}` });
        }

        const duplicateKey = normalizeText(`${level}|${section}|${format}|${questionText}|${correctAnswer}`);
        if (normalizedQuestions.has(duplicateKey)) errors.push({ rowNumber: row, code: 'duplicate_question', message: 'سؤال مكرر داخل نفس المصدر' });
        normalizedQuestions.add(duplicateKey);

        if (level && section && format && questionText && correctAnswer && Number.isInteger(difficulty)) {
            increment(summary.levels, level);
            increment(summary.sections, section);
            increment(summary.scenarioTypes, scenarioType);
            increment(summary.difficulty, String(difficulty));
            questions.push({
                externalId,
                level,
                section,
                format,
                scenarioType,
                audioR2Key: audioItem ? audioItem.normalizedName : null,
                audioSha256: audioItem?.sha256 ?? null,
                audioSizeBytes: audioItem?.bytes.byteLength ?? null,
                audioMimeType: audioItem?.mimeType ?? null,
                instruction: clean(record.instruction) || null,
                questionText,
                correctAnswer,
                acceptedAnswers: format === 'text_input' ? correctAnswer.split('|').map(clean).filter(Boolean) : null,
                transcript: clean(record.transcript) || null,
                explanation: clean(record.explanation) || null,
                difficulty,
                tags: clean(record.tags).split('|').map(normalizeSlug).filter(Boolean),
                timeLimitSeconds,
                points,
                options,
            });
        }
    }

    if (errors.length) throw new GoethePackValidationError(errors);

    return {
        manifest,
        sourceName,
        sourceKey: slugify(`${sourceName}-${modelNumber ?? ''}-v${revision}`),
        publisher,
        sourceYear,
        modelNumber,
        revision,
        defaultLevel: defaultLevel as GoetheLevel,
        description,
        rightsConfirmed,
        packSha256,
        questions,
        audio,
        summary,
    };
}

async function unzipBounded(zipBytes: Uint8Array, limits: GoethePackLimits): Promise<Record<string, Uint8Array>> {
    const files: Record<string, Uint8Array> = {};
    let fileCount = 0;
    let totalUncompressed = 0;
    let pendingFiles = 0;
    let inputFinished = false;
    let settled = false;
    const activeFiles: Array<{ terminate?: () => void }> = [];

    return new Promise((resolve, reject) => {
        const finishReject = (error: GoethePackError | Error) => {
            if (settled) return;
            settled = true;
            for (const file of activeFiles) file.terminate?.();
            reject(error instanceof Error ? error : new GoethePackValidationError([error]));
        };

        const maybeResolve = () => {
            if (settled || !inputFinished || pendingFiles !== 0) return;
            if (totalUncompressed / Math.max(1, zipBytes.byteLength) > limits.maxCompressionRatio) {
                finishReject({ code: 'compression_ratio_too_high', message: 'نسبة الضغط مشبوهة' });
                return;
            }
            settled = true;
            resolve(files);
        };

        const unzipper = new Unzip((file) => {
            fileCount += 1;
            if (fileCount > limits.maxFiles) {
                finishReject({ fileName: file.name, code: 'too_many_files', message: `عدد الملفات يتجاوز ${limits.maxFiles}` });
                return;
            }
            if (file.name.endsWith('/')) return;
            if (file.originalSize && file.originalSize > limits.maxUncompressedBytes) {
                finishReject({ fileName: file.name, code: 'file_too_large', message: 'ملف داخل ZIP أكبر من الحد الكلي' });
                return;
            }
            if (file.originalSize && ALLOWED_AUDIO_EXTENSIONS.has(extensionOf(file.name)) && file.originalSize > limits.maxAudioFileBytes) {
                finishReject({ fileName: file.name, code: 'audio_too_large', message: 'ملف صوت أكبر من الحد' });
                return;
            }

            pendingFiles += 1;
            let fileBytes = 0;
            const chunks: Uint8Array[] = [];
            activeFiles.push(file);
            file.ondata = (error, chunk, final) => {
                if (settled) return;
                if (error) {
                    finishReject(error);
                    return;
                }
                if (chunk?.byteLength) {
                    fileBytes += chunk.byteLength;
                    totalUncompressed += chunk.byteLength;
                    if (fileBytes > limits.maxUncompressedBytes) {
                        finishReject({ fileName: file.name, code: 'file_too_large', message: 'ملف داخل ZIP أكبر من الحد الكلي' });
                        return;
                    }
                    if (ALLOWED_AUDIO_EXTENSIONS.has(extensionOf(file.name)) && fileBytes > limits.maxAudioFileBytes) {
                        finishReject({ fileName: file.name, code: 'audio_too_large', message: 'ملف صوت أكبر من الحد' });
                        return;
                    }
                    if (totalUncompressed > limits.maxUncompressedBytes) {
                        finishReject({ code: 'uncompressed_too_large', message: 'الحجم بعد فك الضغط أكبر من الحد' });
                        return;
                    }
                    chunks.push(chunk);
                }
                if (final) {
                    files[file.name] = concatChunks(chunks, fileBytes);
                    pendingFiles -= 1;
                    maybeResolve();
                }
            };
            try {
                file.start();
            } catch (error) {
                finishReject(error instanceof Error ? error : new Error('zip_start_failed'));
            }
        });
        unzipper.register(UnzipPassThrough);
        unzipper.register(AsyncUnzipInflate);

        try {
            unzipper.push(zipBytes, true);
            inputFinished = true;
            maybeResolve();
        } catch (error) {
            finishReject(error instanceof Error ? error : new Error('zip_parse_failed'));
        }
    });
}

function concatChunks(chunks: Uint8Array[], totalLength: number): Uint8Array {
    if (chunks.length === 1) return chunks[0];
    const output = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return output;
}

function parseManifest(text: string, errors: GoethePackError[]): GoethePackManifest {
    try {
        const parsed = JSON.parse(text) as GoethePackManifest;
        if (parsed.schema_version !== undefined && parsed.schema_version !== 1) {
            errors.push({ fileName: 'manifest.json', code: 'unsupported_manifest', message: 'schema_version غير مدعوم' });
        }
        return parsed;
    } catch {
        errors.push({ fileName: 'manifest.json', code: 'invalid_manifest_json', message: 'manifest.json غير صالح' });
        return {};
    }
}

export function parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        const next = text[i + 1];
        if (ch === '"') {
            if (inQuotes && next === '"') {
                cell += '"';
                i += 1;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (ch === ',' && !inQuotes) {
            row.push(cell);
            cell = '';
        } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
            if (ch === '\r' && next === '\n') i += 1;
            row.push(cell);
            if (row.some(value => value.trim().length > 0)) rows.push(row);
            row = [];
            cell = '';
        } else {
            cell += ch;
        }
    }
    row.push(cell);
    if (row.some(value => value.trim().length > 0)) rows.push(row);
    return rows;
}

function rowToRecord(headers: string[], row: string[], rowNumber: number): Record<string, string> & { __rowNumber: number } {
    const record = { __rowNumber: rowNumber } as Record<string, string> & { __rowNumber: number };
    headers.forEach((header, index) => {
        record[header] = clean(row[index] ?? '');
    });
    return record;
}

function buildOptions(record: Record<string, string>): Array<{ key: string; text: string; sortOrder: number }> {
    return ['a', 'b', 'c', 'd']
        .map((letter, index) => ({ key: letter.toUpperCase(), text: clean(record[`option_${letter}`]), sortOrder: index }))
        .filter(option => option.text);
}

function validateAnswerRules(
    record: Record<string, string>,
    format: GoetheFormat | null,
    correctAnswer: string,
    options: Array<{ key: string; text: string; sortOrder: number }>,
    row: number,
    errors: GoethePackError[]
): void {
    if (!format) return;
    if (format === 'mcq_single') {
        if (options.length < 2) errors.push({ rowNumber: row, code: 'mcq_options_missing', message: 'mcq_single يحتاج خيارين على الأقل' });
        if (!options.some(option => option.key === correctAnswer.toUpperCase())) {
            errors.push({ rowNumber: row, code: 'invalid_correct_answer', message: `${correctAnswer} لا يشير إلى خيار موجود` });
        }
        const optionTexts = options.map(option => normalizeText(option.text));
        if (new Set(optionTexts).size !== optionTexts.length) errors.push({ rowNumber: row, code: 'duplicate_options', message: 'خيارات مكررة' });
    } else if (format === 'true_false') {
        if (!['true', 'false'].includes(correctAnswer.toLowerCase())) {
            errors.push({ rowNumber: row, code: 'invalid_true_false', message: 'true_false يحتاج true أو false' });
        }
    } else if (format === 'text_input') {
        if (!correctAnswer.split('|').map(clean).filter(Boolean).length) {
            errors.push({ rowNumber: row, code: 'invalid_text_answer', message: 'text_input يحتاج جواب نصي' });
        }
    }
    void record;
}

function normalizeZipPath(input: string): { ok: true; path: string } | { ok: false; reason: string } {
    if (input.includes('\\')) return { ok: false, reason: 'backslash غير مسموح' };
    if (input.startsWith('/') || /^[A-Za-z]:/.test(input)) return { ok: false, reason: 'absolute path غير مسموح' };
    const parts = input.split('/').filter(Boolean);
    if (parts.some(part => part === '..' || part === '.')) return { ok: false, reason: 'path traversal غير مسموح' };
    const path = parts.join('/').toLowerCase();
    return path ? { ok: true, path } : { ok: false, reason: 'اسم ملف فارغ' };
}

function detectAudioMimeType(bytes: Uint8Array, ext: string): string | null {
    if (ext === '.mp3' && (startsAscii(bytes, 'ID3') || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0))) return 'audio/mpeg';
    if (ext === '.ogg' && startsAscii(bytes, 'OggS')) return 'audio/ogg';
    if (ext === '.wav' && startsAscii(bytes, 'RIFF') && startsAscii(bytes.slice(8), 'WAVE')) return 'audio/wav';
    if (ext === '.m4a' && startsAscii(bytes.slice(4), 'ftyp')) return 'audio/mp4';
    return null;
}

function startsAscii(bytes: Uint8Array, value: string): boolean {
    return value.split('').every((char, index) => bytes[index] === char.charCodeAt(0));
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
    const hash = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function stripBom(value: string): string {
    return value.replace(/^\uFEFF/, '');
}

function decodeUtf8(bytes: Uint8Array): string {
    return new TextDecoder('utf-8').decode(bytes);
}

function normalizeHeader(value: string): string {
    return clean(value).toLowerCase().replace(/\s+/g, '_');
}

function normalizeLevel(value: unknown): GoetheLevel | null {
    const normalized = clean(value).toUpperCase();
    return ALLOWED_LEVELS.has(normalized) ? normalized as GoetheLevel : null;
}

function normalizeSection(value: unknown): GoetheSection | null {
    const normalized = clean(value).toLowerCase();
    return ALLOWED_SECTIONS.has(normalized) ? normalized as GoetheSection : null;
}

function normalizeFormat(value: unknown): GoetheFormat | null {
    const normalized = clean(value).toLowerCase();
    return ALLOWED_FORMATS.has(normalized) ? normalized as GoetheFormat : null;
}

function normalizeAudioReference(value: string): string {
    const normalized = clean(value).replace(/^\.?\//, '').replace(/\\/g, '/').toLowerCase();
    return normalized;
}

function normalizeSlug(value: string): string {
    return clean(value).toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'general';
}

function slugify(value: string): string {
    return normalizeSlug(value).replace(/_+/g, '-').replace(/^-+|-+$/g, '') || `goethe-${Date.now()}`;
}

function normalizeText(value: string): string {
    return clean(value).toLowerCase().replace(/\s+/g, ' ').trim();
}

function clean(value: unknown): string {
    return String(value ?? '').trim();
}

function parseIntStrict(value: unknown): number {
    if (!/^-?\d+$/.test(clean(value))) return Number.NaN;
    return Number.parseInt(clean(value), 10);
}

function parseOptionalInt(value: unknown): number | null {
    const text = clean(value);
    if (!text) return null;
    const parsed = Number.parseInt(text, 10);
    return Number.isFinite(parsed) ? parsed : null;
}

function readInt(value: string | undefined, fallback: number): number {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function increment(record: Record<string, number>, key: string): void {
    record[key] = (record[key] ?? 0) + 1;
}

function extensionOf(path: string): string {
    const index = path.lastIndexOf('.');
    return index >= 0 ? path.slice(index).toLowerCase() : '';
}

function baseName(path: string): string {
    return path.split('/').pop() ?? path;
}

function normalizeBool(value: unknown): boolean {
    return ['true', '1', 'yes', 'y'].includes(clean(value).toLowerCase());
}
