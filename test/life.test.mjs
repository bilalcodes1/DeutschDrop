import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import {
    calculateLifeStreak,
    chooseGapKeyword,
    getLifeGateDate,
    getLifeGateStatus,
    isLifeGateOpen,
    parseExternalKeywords,
    parseExternalLifeResult,
    reviewLifeSentenceStats,
    saveLifeSentenceAndGate,
    shuffledSentenceWords,
    validateLifeDraft,
    validateLifeOriginalInput,
} from '../dist/services/lifeSentences.js';
import {
    completeLifeGate,
    createLifeSentence,
    ensureLifeSettings,
    getLifeSentenceById,
    getLifeStats,
    listLifeSentences,
    softDeleteLifeSentence,
    updateLifeSettings,
} from '../dist/repositories/lifeSentenceRepository.js';

function createMockD1() {
    const sqlite = new Database(':memory:');
    sqlite.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE users (user_id INTEGER PRIMARY KEY, xp INTEGER DEFAULT 0, level INTEGER DEFAULT 1, updated_at TEXT);
        CREATE TABLE xp_log (log_id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, amount INTEGER NOT NULL, reason TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE xp_events (event_id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, amount INTEGER NOT NULL, reason TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE xp_transactions (
            transaction_id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            amount INTEGER NOT NULL,
            base_amount INTEGER NOT NULL,
            final_amount INTEGER NOT NULL,
            reason TEXT NOT NULL,
            source_type TEXT,
            source_id TEXT,
            multiplier REAL DEFAULT 1.0,
            cap_applied INTEGER DEFAULT 0,
            daily_cap_eligible INTEGER DEFAULT 0,
            metadata_json TEXT,
            cap_base_amount INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE user_boosts (
            boost_id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            multiplier REAL NOT NULL,
            starts_at TEXT DEFAULT CURRENT_TIMESTAMP,
            expires_at TEXT NOT NULL,
            reason TEXT NOT NULL,
            source_type TEXT,
            source_id TEXT,
            is_consumed INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE ai_usage (user_id INTEGER, usage_date TEXT, task_type TEXT, count INTEGER DEFAULT 0, updated_at TEXT, UNIQUE(user_id, usage_date, task_type));
    `);
    sqlite.exec(fs.readFileSync(new URL('../src/db/migrations/0043_life_sentences.sql', import.meta.url), 'utf8'));
    sqlite.exec('INSERT INTO users (user_id, xp, level) VALUES (1, 0, 1), (2, 0, 1);');
    return {
        prepare: sql => {
            const stmt = sqlite.prepare(sql);
            return {
                bind: (...params) => ({
                    run: async () => {
                        const result = stmt.run(...params);
                        return { success: true, meta: { last_row_id: Number(result.lastInsertRowid), changes: result.changes } };
                    },
                    all: async () => ({ results: stmt.all(...params) }),
                    first: async () => stmt.get(...params) ?? null,
                }),
            };
        },
        _db: sqlite,
    };
}

function draft(overrides = {}) {
    return {
        original_arabic: 'اليوم كان الجو حاراً.',
        german: 'Heute war es heiß.',
        arabic: 'اليوم كان الجو حاراً.',
        pronunciation_ar: 'هويته فار إس هايس',
        memory_hint: 'heiß تعني حار',
        keywords: [{ german: 'heiß', arabic: 'حار' }],
        level: 'A1',
        tense: 'past',
        ...overrides,
    };
}

test('life gate respects enabled setting completion and new day reset', async () => {
    const db = createMockD1();
    await ensureLifeSettings(db, 1);

    assert.equal(await isLifeGateOpen(db, 1, new Date('2026-06-22T10:00:00Z')), false);

    await updateLifeSettings(db, 1, { gate_enabled: 0 });
    assert.equal(await isLifeGateOpen(db, 1, new Date('2026-06-22T10:00:00Z')), true);

    await updateLifeSettings(db, 1, { gate_enabled: 1 });
    const sentenceId = await createLifeSentence(db, {
        userId: 1,
        sourceType: 'manual',
        originalArabic: 'اليوم كان الجو حاراً.',
        germanText: 'Heute war es heiß.',
        arabicText: 'اليوم كان الجو حاراً.',
        level: 'A1',
        keywords: [],
    });
    await completeLifeGate(db, 1, '2026-06-22', sentenceId);
    assert.equal((await getLifeGateStatus(db, 1, new Date('2026-06-22T10:00:00Z'))).completed, true);
    assert.equal(await isLifeGateOpen(db, 1, new Date('2026-06-23T10:00:00Z')), false);
});

test('life sentence save creates gate once and awards daily XP once', async () => {
    const db = createMockD1();
    const first = await saveLifeSentenceAndGate(db, 1, '2026-06-22', draft(), 'bot_ai');
    const second = await saveLifeSentenceAndGate(db, 1, '2026-06-22', draft({ german: 'Ich habe Tee getrunken.', arabic: 'شربت الشاي.' }), 'bot_ai');

    assert.equal(first.gateCompletedNow, true);
    assert.equal(first.xpAwarded, 5);
    assert.equal(second.gateCompletedNow, false);
    assert.equal(second.xpAwarded, 0);
    assert.equal(db._db.prepare('SELECT COUNT(*) AS count FROM life_daily_gate WHERE user_id = 1 AND gate_date = ?').get('2026-06-22').count, 1);
    assert.equal(db._db.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM xp_log WHERE reason = 'life_sentence_daily'").get().total, 5);
});

test('life AI and external parsing validate strict fields and keyword formats', () => {
    assert.equal(validateLifeDraft({ german: '', arabic: 'x' }, 'اصل'), null);
    assert.equal(validateLifeDraft({ german: 'Heute war es heiß.', arabic: 'كان الجو حاراً', keywords: [{ german: 'heiß', arabic: 'حار' }], level: 'A1' }, 'اصل')?.german, 'Heute war es heiß.');

    const parsed = parseExternalLifeResult(`German: Ich habe Tee getrunken.
Arabic: شربت الشاي.
Pronunciation: إخ هابه تيه گترونكن
Memory: Tee مثل tea
Keywords:
Tee = شاي
getrunken - شربت
Level: A1`);
    assert.equal(parsed?.german, 'Ich habe Tee getrunken.');
    assert.equal(parsed?.arabic, 'شربت الشاي.');
    assert.equal(parsed?.keywords.length, 2);
    assert.equal(parseExternalLifeResult('Arabic: فقط عربي'), null);
    assert.equal(parseExternalKeywords('heiß=حار, Tee = شاي | gut - جيد').length, 3);
});

test('life input validation rejects empty long and emoji-only input', () => {
    assert.equal(validateLifeOriginalInput('').ok, false);
    assert.equal(validateLifeOriginalInput('😀🔥✨').ok, false);
    assert.equal(validateLifeOriginalInput('ا'.repeat(501)).ok, false);
    assert.equal(validateLifeOriginalInput('رأيت صرصوراً في الحمام اليوم.').ok, true);
});

test('life listing view ownership soft delete archive and stats are scoped per user', async () => {
    const db = createMockD1();
    const id1 = await createLifeSentence(db, {
        userId: 1,
        sourceType: 'bot_ai',
        originalArabic: 'اليوم كان الجو حاراً.',
        germanText: 'Heute war es heiß.',
        arabicText: 'اليوم كان الجو حاراً.',
        level: 'A1',
        nextReviewAt: '2000-01-01T00:00:00.000Z',
        keywords: [{ german_word: 'heiß', arabic_meaning: 'حار' }],
    });
    await createLifeSentence(db, {
        userId: 2,
        sourceType: 'bot_ai',
        originalArabic: 'شربت الشاي.',
        germanText: 'Ich habe Tee getrunken.',
        arabicText: 'شربت الشاي.',
        level: 'A1',
        keywords: [],
    });

    assert.equal((await listLifeSentences(db, 1, 10, 0)).length, 1);
    assert.equal(await getLifeSentenceById(db, 2, id1), null);
    await softDeleteLifeSentence(db, 1, id1);
    assert.equal((await listLifeSentences(db, 1, 10, 0)).length, 0);
    const stats = await getLifeStats(db, 1);
    assert.equal(stats.total, 1);
});

test('life SRS review helpers update next review and hard difficulty', () => {
    const sentence = {
        id: 1,
        user_id: 1,
        source_type: 'bot_ai',
        original_arabic: 'x',
        german_text: 'Heute war es heiß.',
        arabic_text: 'x',
        pronunciation_ar: null,
        memory_hint: null,
        level: 'A1',
        tense: null,
        status: 'active',
        difficulty: 'medium',
        review_count: 0,
        correct_count: 0,
        wrong_count: 2,
        ease_factor: 2.5,
        interval: 0,
        repetitions: 0,
        last_reviewed_at: null,
        next_review_at: null,
        created_at: 'now',
        updated_at: 'now',
        deleted_at: null,
    };
    const wrong = reviewLifeSentenceStats(sentence, false);
    assert.equal(wrong.difficulty, 'hard');
    assert.ok(wrong.nextReviewAt);
    assert.equal(chooseGapKeyword(sentence, [{ german_word: 'heiß', arabic_meaning: 'حار' }]).answer, 'heiß');
    assert.deepEqual(shuffledSentenceWords('Heute war es heiß.').sort(), ['Heute', 'es', 'heiß.', 'war'].sort());
});

test('life streak counts once per completed day and detects breaks', () => {
    const streak = calculateLifeStreak(['2026-06-20', '2026-06-21', '2026-06-22', '2026-06-22', '2026-06-18'], '2026-06-22');
    assert.equal(streak.current, 3);
    assert.equal(streak.best, 3);
    assert.equal(streak.completedDays, 4);
});

test('life command wiring exposes menu gate settings preview training and safe callbacks', () => {
    const botSource = fs.readFileSync(new URL('../src/bot/bot.ts', import.meta.url), 'utf8');
    const menuSource = fs.readFileSync(new URL('../src/commands/menu.ts', import.meta.url), 'utf8');
    const lifeSource = fs.readFileSync(new URL('../src/commands/life.ts', import.meta.url), 'utf8');
    const trainSource = fs.readFileSync(new URL('../src/commands/train.ts', import.meta.url), 'utf8');
    const learnSource = fs.readFileSync(new URL('../src/commands/learn.ts', import.meta.url), 'utf8');
    const gameSource = fs.readFileSync(new URL('../src/commands/game.ts', import.meta.url), 'utf8');
    const goetheSource = fs.readFileSync(new URL('../src/commands/goethe.ts', import.meta.url), 'utf8');

    assert.match(botSource, /registerLifeCommand\(bot\)/);
    assert.match(menuSource, /🧠 مواقف الحياة/);
    assert.match(menuSource, /ensureLifeGateOrShow/);
    assert.match(trainSource, /ensureLifeGateOrShow/);
    assert.match(learnSource, /ensureLifeGateOrShow/);
    assert.match(gameSource, /ensureLifeGateOrShow/);
    assert.match(goetheSource, /ensureLifeGateOrShow/);
    for (const callback of ['life:add', 'life:ext', 'life:save', 'life:regen', 'life:edit:g', 'life:edit:a', 'life:today', 'life:due', 'life:stats', 'life:settings', 'life:gate:on', 'life:gate:off']) {
        assert.match(lifeSource, new RegExp(callback.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    for (const state of ['awaiting_life_original_arabic', 'awaiting_life_external_result', 'awaiting_life_german_edit', 'awaiting_life_arabic_edit', 'life_training_writing', 'life_training_listening', 'life_training_order', 'life_training_gap']) {
        assert.match(lifeSource, new RegExp(state));
    }
    assert.match(lifeSource, /synthesizeGermanTts/);
    assert.match(lifeSource, /softDeleteLifeSentence/);
    assert.match(lifeSource, /shownGerman: mode !== 'listening'/);
});

test('life migration and AI task are wired without new providers', () => {
    const migration = fs.readFileSync(new URL('../src/db/migrations/0043_life_sentences.sql', import.meta.url), 'utf8');
    const aiTypes = fs.readFileSync(new URL('../src/services/ai/aiTypes.ts', import.meta.url), 'utf8');
    const prompts = fs.readFileSync(new URL('../src/services/ai/prompts.ts', import.meta.url), 'utf8');
    const router = fs.readFileSync(new URL('../src/services/ai/aiRouter.ts', import.meta.url), 'utf8');

    for (const table of ['life_sentences', 'life_sentence_keywords', 'life_daily_gate', 'life_user_settings']) {
        assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
    }
    assert.match(migration, /UNIQUE\(user_id, gate_date\)/);
    assert.match(migration, /idx_life_sentences_user_next_review/);
    assert.match(aiTypes, /generate_life_sentence/);
    assert.match(prompts, /حوّل موقفاً عربياً حقيقياً/);
    assert.doesNotMatch(router, /lifeProvider|speechmatics|new Provider/);
});
