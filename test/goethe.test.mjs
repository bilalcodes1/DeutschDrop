import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { strToU8, zipSync } from 'fflate';
import { parseGoethePack, GoethePackValidationError } from '../dist/services/goethePackParser.js';
import {
    activateGoetheSource,
    createGoetheImportJob,
    createImportingGoetheSource,
    createGoetheSession,
    failGoetheSource,
    findGoetheSourceByPackHash,
    getActiveGoetheLevels,
    getGoetheSessionReview,
    insertGoetheQuestions,
    lockGoetheImportJobById,
    lockNextGoetheImportJob,
    selectGoetheQuestionCandidates,
    setGoetheSourceStatus,
} from '../dist/repositories/goetheRepository.js';
import { answerGoetheQuestion, startGoetheSession } from '../dist/services/goetheTrainingService.js';
import { getGoetheAudioBlob } from '../dist/services/goetheAudioService.js';

const mp3 = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0, 0, 0, 0]);

function makeZip(files) {
    return zipSync(Object.fromEntries(Object.entries(files).map(([name, value]) => [
        name,
        typeof value === 'string' ? strToU8(value) : value,
    ])));
}

function manifest(extra = {}) {
    return JSON.stringify({
        schema_version: 1,
        source_name: 'Goethe A1 Modelltest 01',
        source_year: 2024,
        model_number: '01',
        publisher: 'Goethe-Institut',
        default_level: 'A1',
        revision: 1,
        language: 'de',
        rights_confirmed: true,
        ...extra,
    });
}

function validCsv(overrides = {}) {
    const row = {
        external_id: 'q1',
        level: 'A1',
        section: 'listening',
        format: 'mcq_single',
        scenario_type: 'phone',
        audio_file: 'audio/a1_h01.mp3',
        instruction: 'Hören Sie.',
        question: 'Was hört man?',
        option_a: 'Hallo',
        option_b: 'Tschüss',
        option_c: '',
        option_d: '',
        correct_answer: 'A',
        transcript: 'Hallo',
        explanation: 'Begrüßung',
        difficulty: '1',
        tags: 'phone|greeting',
        source_name: 'Goethe A1 Modelltest 01',
        source_year: '2024',
        model_number: '01',
        time_limit_seconds: '30',
        points: '10',
        rights_confirmed: 'true',
        is_active: '1',
        ...overrides,
    };
    const headers = Object.keys(row);
    return `${headers.join(',')}\n${headers.map(key => csvCell(row[key])).join(',')}`;
}

function csvCell(value) {
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function fixtureZip(name) {
    return new Uint8Array(fs.readFileSync(new URL(`fixtures/goethe/${name}`, import.meta.url)));
}

function env() {
    return {};
}

function createMockD1() {
    const sqlite = new Database(':memory:');
    sqlite.exec('CREATE TABLE users (user_id INTEGER PRIMARY KEY, xp INTEGER DEFAULT 0, level INTEGER DEFAULT 1, updated_at TEXT);');
    sqlite.exec('CREATE TABLE xp_log (log_id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, amount INTEGER, reason TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);');
    sqlite.exec(`CREATE TABLE xp_events (event_id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, amount INTEGER, reason TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);`);
    sqlite.exec(`CREATE TABLE xp_transactions (
        transaction_id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER, amount INTEGER, base_amount INTEGER, final_amount INTEGER,
        reason TEXT, source_type TEXT, source_id TEXT, multiplier REAL DEFAULT 1,
        cap_applied INTEGER DEFAULT 0, daily_cap_eligible INTEGER DEFAULT 0,
        metadata_json TEXT, cap_base_amount INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );`);
    sqlite.exec('CREATE TABLE user_boosts (boost_id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, multiplier REAL, starts_at TEXT DEFAULT CURRENT_TIMESTAMP, expires_at TEXT, reason TEXT, source_type TEXT, source_id TEXT, is_consumed INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);');
    sqlite.exec(fs.readFileSync(new URL('../src/db/migrations/0042_goethe_training_system.sql', import.meta.url), 'utf8'));
    sqlite.exec('INSERT INTO users (user_id) VALUES (1);');
    return {
        prepare: (query) => {
            const stmt = sqlite.prepare(query);
            return {
                bind: (...params) => ({
                    run: async () => {
                        const result = stmt.run(...params);
                        return { success: true, meta: { last_row_id: Number(result.lastInsertRowid), changes: result.changes } };
                    },
                    all: async () => ({ results: stmt.all(...params) }),
                    first: async () => stmt.get(...params) || null,
                }),
            };
        },
        batch: async (statements) => Promise.all(statements.map(statement => statement.run())),
        _db: sqlite,
    };
}

async function seedGoethe(db) {
    const pack = await parseGoethePack(makeZip({
        'manifest.json': manifest(),
        'questions.csv': validCsv(),
        'audio/a1_h01.mp3': mp3,
    }), env());
    const sourceId = await createImportingGoetheSource(db, {
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
        importedByUserId: 1,
    });
    await insertGoetheQuestions(db, sourceId, pack.questions.map(question => ({ ...question, audioR2Key: 'goethe/audio/a1/test/v1/a1_h01.mp3' })));
    await activateGoetheSource(db, sourceId, pack.questions.length, 1);
    return sourceId;
}

test('goethe pack parser accepts valid ZIP with manifest csv and audio', async () => {
    const pack = await parseGoethePack(makeZip({
        'manifest.json': manifest(),
        'questions.csv': validCsv(),
        'audio/a1_h01.mp3': mp3,
    }), env());
    assert.equal(pack.questions.length, 1);
    assert.equal(pack.audio.size >= 1, true);
    assert.equal(pack.sourceName, 'Goethe A1 Modelltest 01');
    assert.equal(pack.rightsConfirmed, true);
});

test('goethe fixture ZIP imports end-to-end into source questions options and active level', async () => {
    const db = createMockD1();
    const pack = await parseGoethePack(fixtureZip('valid_pack.zip'), env());
    const sourceId = await createImportingGoetheSource(db, {
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
        importedByUserId: 1,
    });
    await insertGoetheQuestions(db, sourceId, pack.questions.map(question => ({ ...question, audioR2Key: 'goethe/audio/a1/test/v1/a1_h01.mp3' })));
    assert.equal(db._db.prepare('SELECT COUNT(*) AS count FROM goethe_questions WHERE source_id = ? AND is_active = 0').get(sourceId).count, 1);
    assert.equal(db._db.prepare('SELECT COUNT(*) AS count FROM goethe_question_options').get().count, 2);
    await activateGoetheSource(db, sourceId, pack.questions.length, 1);
    const levels = await getActiveGoetheLevels(db);
    assert.equal(levels[0].level, 'A1');
    assert.equal(levels[0].count, 1);
});

test('goethe fixture ZIP failures cover missing audio traversal duplicate id and invalid answer', async () => {
    const cases = [
        ['missing_audio_pack.zip', 'audio_file_not_found'],
        ['traversal_pack.zip', 'unsafe_path'],
        ['duplicate_external_id_pack.zip', 'duplicate_external_id'],
        ['invalid_answer_pack.zip', 'invalid_correct_answer'],
    ];
    for (const [fileName, code] of cases) {
        await assert.rejects(
            parseGoethePack(fixtureZip(fileName), env()),
            (error) => error instanceof GoethePackValidationError && error.errors.some(e => e.code === code),
            fileName
        );
    }
});

test('goethe pack parser rejects missing audio', async () => {
    await assert.rejects(
        parseGoethePack(makeZip({ 'manifest.json': manifest(), 'questions.csv': validCsv() }), env()),
        (error) => error instanceof GoethePackValidationError && error.errors.some(e => e.code === 'audio_file_not_found')
    );
});

test('goethe pack parser rejects path traversal', async () => {
    await assert.rejects(
        parseGoethePack(makeZip({ '../evil.mp3': mp3, 'manifest.json': manifest(), 'questions.csv': validCsv() }), env()),
        (error) => error instanceof GoethePackValidationError && error.errors.some(e => e.code === 'unsafe_path')
    );
});

test('goethe pack parser rejects duplicate external_id', async () => {
    const csv = `${validCsv()}\n${validCsv({ option_a: 'Ja', option_b: 'Nein' }).split('\n')[1]}`;
    await assert.rejects(
        parseGoethePack(makeZip({ 'manifest.json': manifest(), 'questions.csv': csv, 'audio/a1_h01.mp3': mp3 }), env()),
        (error) => error instanceof GoethePackValidationError && error.errors.some(e => e.code === 'duplicate_external_id')
    );
});

test('goethe pack parser rejects invalid correct answer', async () => {
    await assert.rejects(
        parseGoethePack(makeZip({
            'manifest.json': manifest(),
            'questions.csv': validCsv({ correct_answer: 'C' }),
            'audio/a1_h01.mp3': mp3,
        }), env()),
        (error) => error instanceof GoethePackValidationError && error.errors.some(e => e.code === 'invalid_correct_answer')
    );
});

test('goethe pack parser rejects missing questions csv duplicate filenames and invalid metadata', async () => {
    await assert.rejects(
        parseGoethePack(makeZip({ 'manifest.json': manifest(), 'audio/a1_h01.mp3': mp3 }), env()),
        (error) => error instanceof GoethePackValidationError && error.errors.some(e => e.code === 'questions_csv_count')
    );

    await assert.rejects(
        parseGoethePack(makeZip({
            'manifest.json': manifest(),
            'questions.csv': validCsv(),
            'audio/a1_h01.mp3': mp3,
            'audio//a1_h01.mp3': mp3,
        }), env()),
        (error) => error instanceof GoethePackValidationError && error.errors.some(e => e.code === 'duplicate_file_name')
    );

    await assert.rejects(
        parseGoethePack(makeZip({
            'manifest.json': manifest(),
            'questions.csv': validCsv({ level: 'C1', section: 'grammar', format: 'essay' }),
            'audio/a1_h01.mp3': mp3,
        }), env()),
        (error) => error instanceof GoethePackValidationError &&
            ['invalid_level', 'invalid_section', 'invalid_format'].every(code => error.errors.some(e => e.code === code))
    );
});

test('goethe source activation exposes active level only after success', async () => {
    const db = createMockD1();
    assert.deepEqual(await getActiveGoetheLevels(db), []);
    await seedGoethe(db);
    const levels = await getActiveGoetheLevels(db);
    assert.equal(levels[0].level, 'A1');
    assert.equal(levels[0].count, 1);
});

test('goethe duplicate pack hash is detected and disabled sources are excluded', async () => {
    const db = createMockD1();
    const sourceId = await seedGoethe(db);
    const pack = await parseGoethePack(makeZip({
        'manifest.json': manifest(),
        'questions.csv': validCsv(),
        'audio/a1_h01.mp3': mp3,
    }), env());
    const duplicate = await findGoetheSourceByPackHash(db, pack.packSha256);
    assert.equal(duplicate.source_id, sourceId);

    await setGoetheSourceStatus(db, sourceId, false);
    const rows = await selectGoetheQuestionCandidates(db, { userId: 1, level: 'A1', mode: 'challenge', limit: 10 });
    assert.equal(rows.length, 0);
});

test('goethe failed import rollback removes inactive source questions and options', async () => {
    const db = createMockD1();
    const sourceId = await seedGoethe(db);
    db._db.prepare("UPDATE goethe_sources SET status = 'importing' WHERE source_id = ?").run(sourceId);
    db._db.prepare('UPDATE goethe_questions SET is_active = 0 WHERE source_id = ?').run(sourceId);
    await failGoetheSource(db, sourceId);
    assert.equal(db._db.prepare('SELECT COUNT(*) AS count FROM goethe_sources WHERE source_id = ?').get(sourceId).count, 0);
    assert.equal(db._db.prepare('SELECT COUNT(*) AS count FROM goethe_questions WHERE source_id = ?').get(sourceId).count, 0);
    assert.equal(db._db.prepare('SELECT COUNT(*) AS count FROM goethe_question_options').get().count, 0);
});

test('goethe import job locking is atomic and stale jobs recover', async () => {
    const db = createMockD1();
    const jobId = await createGoetheImportJob(db, {
        adminUserId: 1,
        telegramChatId: 100,
        telegramFileId: 'file-id',
        telegramFileName: 'pack.zip',
        telegramFileSize: 100,
        progressMessageId: null,
    });

    const first = await lockGoetheImportJobById(db, jobId);
    assert.equal(first.status, 'processing');
    assert.equal(await lockGoetheImportJobById(db, jobId), null);
    assert.equal(await lockNextGoetheImportJob(db), null);

    db._db.prepare("UPDATE goethe_import_jobs SET updated_at = datetime('now', '-10 minutes') WHERE job_id = ?").run(jobId);
    const recovered = await lockNextGoetheImportJob(db);
    assert.equal(recovered.job_id, jobId);
});

test('goethe question selection uses filters and not ORDER BY RANDOM', async () => {
    const source = fs.readFileSync(new URL('../src/repositories/goetheRepository.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /ORDER BY RANDOM\(\)/i);
    const db = createMockD1();
    await seedGoethe(db);
    const rows = await selectGoetheQuestionCandidates(db, { userId: 1, level: 'A1', mode: 'missed_call', limit: 10, section: 'listening', scenarioTypes: ['phone', 'voicemail'] });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].scenario_type, 'phone');
});

test('goethe session start reuses active session and handles missing level questions', async () => {
    const db = createMockD1();
    await seedGoethe(db);
    const first = await startGoetheSession(db, 1, 'A1', 'challenge');
    assert.equal(first.ok, true);
    const second = await startGoetheSession(db, 1, 'A1', 'challenge');
    assert.equal(second.sessionId, first.sessionId);
    const missing = await startGoetheSession(db, 2, 'B1', 'challenge');
    assert.equal(missing.ok, false);
});

test('goethe answer awards XP once and duplicate callback gives no second XP', async () => {
    const db = createMockD1();
    await seedGoethe(db);
    const sessionId = await createGoetheSession(db, { userId: 1, mode: 'challenge', level: 'A1', questionIds: [1] });
    const first = await answerGoetheQuestion(db, 1, sessionId, 0, 'A');
    assert.equal(first.correct, true);
    assert.equal(first.xpAwarded, 10);
    const duplicate = await answerGoetheQuestion(db, 1, sessionId, 0, 'A');
    assert.equal(duplicate.ok, false);
    const xp = db._db.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM xp_log WHERE reason = ?').get('goethe_correct').total;
    assert.equal(xp, 10);
});

test('goethe answer guards ownership position timeout and review output', async () => {
    const db = createMockD1();
    await seedGoethe(db);
    const sessionId = await createGoetheSession(db, { userId: 1, mode: 'speed', level: 'A1', questionIds: [1], speedSeconds: 30 });

    const wrongUser = await answerGoetheQuestion(db, 2, sessionId, 0, 'A');
    assert.equal(wrongUser.ok, false);

    const wrongPosition = await answerGoetheQuestion(db, 1, sessionId, 1, 'A');
    assert.equal(wrongPosition.ok, false);

    db._db.prepare("UPDATE goethe_session_questions SET deadline_at = datetime('now', '-1 minute') WHERE session_id = ?").run(sessionId);
    const timedOut = await answerGoetheQuestion(db, 1, sessionId, 0, 'A');
    assert.equal(timedOut.correct, false);
    const stat = db._db.prepare('SELECT weakness_score FROM goethe_user_question_stats WHERE user_id = 1 AND question_id = 1').get();
    assert.equal(stat.weakness_score, 4);

    const review = await getGoetheSessionReview(db, sessionId, 1);
    assert.equal(review.length, 1);
    assert.equal(review[0].user_answer, 'A');
});

test('goethe wrong answer raises weakness score', async () => {
    const db = createMockD1();
    await seedGoethe(db);
    const sessionId = await createGoetheSession(db, { userId: 1, mode: 'challenge', level: 'A1', questionIds: [1] });
    const result = await answerGoetheQuestion(db, 1, sessionId, 0, 'B');
    assert.equal(result.correct, false);
    const stat = db._db.prepare('SELECT weakness_score, wrong_attempts FROM goethe_user_question_stats WHERE user_id = 1 AND question_id = 1').get();
    assert.equal(stat.weakness_score, 3);
    assert.equal(stat.wrong_attempts, 1);
});

test('goethe audio service returns null safely or R2 blob when available', async () => {
    assert.equal(await getGoetheAudioBlob({}, 'missing'), null);
    const blob = await getGoetheAudioBlob({
        GOETHE_AUDIO: {
            get: async (key) => key === 'goethe/audio/a.mp3'
                ? { blob: async () => new Blob(['audio'], { type: 'audio/mpeg' }) }
                : null,
        },
    }, 'goethe/audio/a.mp3');
    assert.equal(await blob.text(), 'audio');
});

test('goethe migration and schema contain required indexes and tables', () => {
    const migration = fs.readFileSync(new URL('../src/db/migrations/0042_goethe_training_system.sql', import.meta.url), 'utf8');
    const schema = fs.readFileSync(new URL('../src/db/schema.sql', import.meta.url), 'utf8');
    for (const table of ['goethe_sources', 'goethe_questions', 'goethe_import_jobs', 'goethe_sessions', 'goethe_attempts', 'goethe_user_question_stats']) {
        assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
        assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
    }
    assert.match(migration, /idx_goethe_questions_active_level/);
    assert.match(migration, /idx_goethe_import_jobs_status_created/);
});

test('goethe UI and admin commands are wired', () => {
    const bot = fs.readFileSync(new URL('../src/bot/bot.ts', import.meta.url), 'utf8');
    const menu = fs.readFileSync(new URL('../src/commands/menu.ts', import.meta.url), 'utf8');
    const command = fs.readFileSync(new URL('../src/commands/goethe.ts', import.meta.url), 'utf8');
    assert.match(bot, /registerGoetheCommand\(bot\)/);
    assert.match(menu, /🎯 تحديات غوته/);
    assert.match(command, /upload_goethe_pack/);
    assert.match(command, /goethe_imports/);
    assert.match(command, /goethe_sources/);
});
