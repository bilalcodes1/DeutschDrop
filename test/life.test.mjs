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
    publicLifeAuthorName,
    reviewLifeSentenceStats,
    saveLifeSentenceAndGate,
    sanitizeLifeShareDisplayName,
    shuffledSentenceWords,
    validateLifeSearchQuery,
    validateLifeDraft,
    validateLifeOriginalInput,
} from '../dist/services/lifeSentences.js';
import {
    countCopiedLifeSentencesByUser,
    countPublicLifeSentences,
    countPublishedLifeSentencesByUser,
    completeLifeGate,
    createLifeSentenceCopy,
    createLifeSentenceReport,
    createLifeSentence,
    escapeLike,
    ensureLifeSettings,
    getLifeSentenceByShareCode,
    getLifeSentenceByShareCodeAnyVisibility,
    getLifeSentenceWithAuthorById,
    getLifeShareCodeExists,
    getLifeCopyRecord,
    getLifeSentenceById,
    getLifeStats,
    listCopiedLifeSentencesByUser,
    listLifeSentences,
    listPublicLifeSentences,
    listPublishedLifeSentencesByUser,
    restoreLifeSentenceCopy,
    setLifeSentenceVisibility,
    softDeleteLifeSentence,
    archiveLifeSentence,
    updateLifeSentenceReview,
    updateLifeSettings,
} from '../dist/repositories/lifeSentenceRepository.js';

function createMockD1() {
    const sqlite = new Database(':memory:');
    sqlite.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE users (user_id INTEGER PRIMARY KEY, name TEXT, display_name TEXT, xp INTEGER DEFAULT 0, level INTEGER DEFAULT 1, updated_at TEXT);
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
    sqlite.exec(fs.readFileSync(new URL('../src/db/migrations/0044_life_sentence_sharing.sql', import.meta.url), 'utf8'));
    sqlite.exec(fs.readFileSync(new URL('../src/db/migrations/0045_admin_moderation.sql', import.meta.url), 'utf8'));
    sqlite.exec("INSERT INTO users (user_id, name, display_name, xp, level) VALUES (1, 'Bilal', 'Bilal', 0, 1), (2, 'Mira', 'Mira', 0, 1);");
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

function createMockD1BeforeSharing() {
    const sqlite = new Database(':memory:');
    sqlite.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE users (user_id INTEGER PRIMARY KEY, name TEXT, display_name TEXT, xp INTEGER DEFAULT 0, level INTEGER DEFAULT 1, updated_at TEXT);
    `);
    sqlite.exec(fs.readFileSync(new URL('../src/db/migrations/0043_life_sentences.sql', import.meta.url), 'utf8'));
    sqlite.exec("INSERT INTO users (user_id, name, display_name, xp, level) VALUES (1, 'Bilal', 'Bilal', 0, 1), (2, 'Mira', 'Mira', 0, 1);");
    sqlite.prepare(`INSERT INTO life_sentences (user_id, source_type, original_arabic, german_text, arabic_text, level)
        VALUES (1, 'bot_ai', 'قديم', 'Ich trinke Wasser.', 'أشرب الماء.', 'A1')`).run();
    return sqlite;
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

test('life sharing visibility search and deep links enforce privacy', async () => {
    const db = createMockD1();
    await ensureLifeSettings(db, 1);
    await updateLifeSettings(db, 1, { share_name_mode: 'custom', share_display_name: 'Bilal Deutsch' });
    const id = await createLifeSentence(db, {
        userId: 1,
        sourceType: 'bot_ai',
        originalArabic: 'رأيت نمراً في الحديقة.',
        germanText: 'Ich habe einen Tiger im Garten gesehen.',
        arabicText: 'رأيت نمراً في الحديقة.',
        pronunciationAr: 'إخ هابه آينن تيغر إم غارتن غِزين',
        memoryHint: 'Tiger مثل tiger',
        level: 'A1',
        keywords: [{ german_word: 'Tiger', arabic_meaning: 'نمر' }],
    });

    const privateSentence = await getLifeSentenceById(db, 1, id);
    assert.equal(privateSentence.visibility, 'private');
    assert.equal(await countPublicLifeSentences(db, { query: 'Tiger' }), 0);
    assert.equal(await setLifeSentenceVisibility(db, 2, id, 'public', 'badcode'), false);

    assert.equal(await setLifeSentenceVisibility(db, 1, id, 'public', 'LifeA001'), true);
    assert.equal(await getLifeShareCodeExists(db, 'LifeA001'), true);
    assert.equal((await getLifeSentenceByShareCode(db, 'LifeA001'))?.id, id);
    assert.equal((await listPublicLifeSentences(db, 5, 0, { query: 'Tiger' })).length, 1);
    assert.equal((await listPublicLifeSentences(db, 5, 0, { query: 'نمر' })).length, 1);
    assert.equal((await listPublicLifeSentences(db, 5, 0, { query: 'Garten' }))[0].author_display_name, 'Bilal Deutsch');
    assert.equal(publicLifeAuthorName(null), 'متعلم في DeutschDrop');

    assert.equal(await setLifeSentenceVisibility(db, 1, id, 'unlisted', 'LifeA001'), true);
    assert.equal(await countPublicLifeSentences(db, { query: 'Tiger' }), 0);
    assert.equal((await getLifeSentenceByShareCode(db, 'LifeA001'))?.visibility, 'unlisted');

    assert.equal(await setLifeSentenceVisibility(db, 1, id, 'private', 'LifeA001'), true);
    assert.equal(await getLifeSentenceByShareCode(db, 'LifeA001'), null);
    assert.equal((await getLifeSentenceByShareCodeAnyVisibility(db, 'LifeA001'))?.visibility, 'private');

    await setLifeSentenceVisibility(db, 1, id, 'public', 'LifeA001');
    await softDeleteLifeSentence(db, 1, id);
    assert.equal(await getLifeSentenceByShareCode(db, 'LifeA001'), null);
});

test('life sentence copy creates private independent SRS-ready copies and prevents duplicates', async () => {
    const db = createMockD1();
    const id = await createLifeSentence(db, {
        userId: 1,
        sourceType: 'bot_ai',
        originalArabic: 'هذا نص شخصي لا ينسخ.',
        germanText: 'Ich trinke heute Tee.',
        arabicText: 'أشرب الشاي اليوم.',
        pronunciationAr: 'إخ ترينكه هويته تيه',
        memoryHint: 'تلميح شخصي لا ينسخ',
        level: 'A1',
        tense: 'present',
        keywords: [{ german_word: 'Tee', arabic_meaning: 'شاي' }],
    });
    await setLifeSentenceVisibility(db, 1, id, 'public', 'LifeCopy1');
    const source = await getLifeSentenceWithAuthorById(db, id, false);
    const first = await createLifeSentenceCopy(db, source, 2);
    const copy = await getLifeSentenceById(db, 2, first.newSentenceId);

    assert.equal(first.copiedNow, true);
    assert.equal(copy.user_id, 2);
    assert.equal(copy.visibility, 'private');
    assert.equal(copy.german_text, source.german_text);
    assert.equal(copy.arabic_text, source.arabic_text);
    assert.equal(copy.pronunciation_ar, source.pronunciation_ar);
    assert.equal(copy.original_arabic, source.arabic_text);
    assert.equal(copy.memory_hint, null);
    assert.equal(copy.copied_from_sentence_id, id);
    assert.equal(copy.keywords.length, 1);
    assert.equal((await getLifeSentenceById(db, 1, id)).copied_count, 1);
    assert.equal((await listCopiedLifeSentencesByUser(db, 2, 5, 0)).length, 1);
    assert.equal(await countCopiedLifeSentencesByUser(db, 2), 1);

    const second = await createLifeSentenceCopy(db, source, 2);
    assert.equal(second.copiedNow, false);
    assert.equal(second.newSentenceId, first.newSentenceId);
    assert.equal((await getLifeSentenceById(db, 1, id)).copied_count, 1);

    await softDeleteLifeSentence(db, 2, first.newSentenceId);
    const record = await getLifeCopyRecord(db, id, 2);
    await restoreLifeSentenceCopy(db, 2, record);
    assert.equal((await getLifeSentenceById(db, 2, first.newSentenceId)).deleted_at, null);
});

test('life sharing reports search validation and UI wiring are safe', async () => {
    const migration = fs.readFileSync(new URL('../src/db/migrations/0044_life_sentence_sharing.sql', import.meta.url), 'utf8');
    const lifeSource = fs.readFileSync(new URL('../src/commands/life.ts', import.meta.url), 'utf8');
    const startSource = fs.readFileSync(new URL('../src/commands/start.ts', import.meta.url), 'utf8');
    const db = createMockD1();
    const id = await createLifeSentence(db, {
        userId: 1,
        sourceType: 'bot_ai',
        originalArabic: 'ذهبت إلى السوق.',
        germanText: 'Ich bin zum Markt gegangen.',
        arabicText: 'ذهبت إلى السوق.',
        level: 'A1',
        keywords: [{ german_word: 'Markt', arabic_meaning: 'سوق' }],
    });
    await setLifeSentenceVisibility(db, 1, id, 'public', 'LifeR001');

    assert.equal(await createLifeSentenceReport(db, id, 2, 'wrong_translation'), true);
    assert.equal(await createLifeSentenceReport(db, id, 2, 'wrong_translation'), false);
    assert.equal(validateLifeSearchQuery('😀🔥').ok, false);
    assert.equal(validateLifeSearchQuery('Ma').ok, true);
    assert.equal(escapeLike('50%_test'), '50\\%\\_test');
    assert.equal(sanitizeLifeShareDisplayName('https://spam.test'), null);
    assert.equal(sanitizeLifeShareDisplayName('Bilal Codes'), 'Bilal Codes');

    for (const text of ['visibility TEXT', 'life_sentence_copies', 'life_sentence_reports', 'share_name_mode']) {
        assert.match(migration, new RegExp(text));
    }
    for (const callback of ['life:community', 'life:copy', 'life:share', 'life:published', 'life:copied', 'life:report', 'life:ord']) {
        assert.match(lifeSource, new RegExp(callback.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    assert.match(startSource, /life_/);
    assert.match(lifeSource, /recordTemporaryMessage/);
    assert.doesNotMatch(lifeSource, /caption:\s*`🔊/);
});

test('life sharing migration preserves old sentences as private with nullable share code', () => {
    const sqlite = createMockD1BeforeSharing();
    sqlite.exec(fs.readFileSync(new URL('../src/db/migrations/0044_life_sentence_sharing.sql', import.meta.url), 'utf8'));
    const row = sqlite.prepare('SELECT visibility, share_code, view_count, copied_count FROM life_sentences LIMIT 1').get();
    assert.equal(row.visibility, 'private');
    assert.equal(row.share_code, null);
    assert.equal(row.view_count, 0);
    assert.equal(row.copied_count, 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name IN ('life_sentence_copies', 'life_sentence_reports')").get().count, 2);
});

test('life sharing migration enforces unique non-null share codes while allowing private nulls', async () => {
    const db = createMockD1();
    const id1 = await createLifeSentence(db, { userId: 1, sourceType: 'bot_ai', originalArabic: 'أ', germanText: 'Ich trinke Wasser.', arabicText: 'أشرب الماء.', level: 'A1', keywords: [] });
    const id2 = await createLifeSentence(db, { userId: 1, sourceType: 'bot_ai', originalArabic: 'ب', germanText: 'Ich esse Brot.', arabicText: 'آكل الخبز.', level: 'A1', keywords: [] });
    assert.equal((await getLifeSentenceById(db, 1, id1)).share_code, null);
    assert.equal((await getLifeSentenceById(db, 1, id2)).share_code, null);
    assert.equal(await setLifeSentenceVisibility(db, 1, id1, 'public', 'Unique01'), true);
    await assert.rejects(() => setLifeSentenceVisibility(db, 1, id2, 'public', 'Unique01'));
});

test('life public latest and popular lists order by published time and copied count', async () => {
    const db = createMockD1();
    const low = await createLifeSentence(db, { userId: 1, sourceType: 'bot_ai', originalArabic: 'أ', germanText: 'Ich trinke Wasser.', arabicText: 'أشرب الماء.', level: 'A1', keywords: [] });
    const high = await createLifeSentence(db, { userId: 1, sourceType: 'bot_ai', originalArabic: 'ب', germanText: 'Ich esse Brot.', arabicText: 'آكل الخبز.', level: 'A1', keywords: [] });
    await setLifeSentenceVisibility(db, 1, low, 'public', 'Latest01');
    await setLifeSentenceVisibility(db, 1, high, 'public', 'Latest02');
    db._db.prepare('UPDATE life_sentences SET copied_count = 9, published_at = datetime(\'now\', \'-1 day\') WHERE id = ?').run(low);
    db._db.prepare('UPDATE life_sentences SET copied_count = 1, published_at = datetime(\'now\') WHERE id = ?').run(high);

    assert.equal((await listPublicLifeSentences(db, 5, 0, { sort: 'latest' }))[0].id, high);
    assert.equal((await listPublicLifeSentences(db, 5, 0, { sort: 'popular' }))[0].id, low);
});

test('life public search escapes wildcards and does not duplicate keyword matches', async () => {
    const db = createMockD1();
    const percent = await createLifeSentence(db, {
        userId: 1,
        sourceType: 'bot_ai',
        originalArabic: 'اختبار نسبة.',
        germanText: 'Ich habe 50% geschafft.',
        arabicText: 'أنجزت 50%.',
        level: 'A1',
        keywords: [{ german_word: '50%', arabic_meaning: 'خمسون بالمئة' }],
    });
    const other = await createLifeSentence(db, { userId: 1, sourceType: 'bot_ai', originalArabic: 'آخر.', germanText: 'Ich habe Tee.', arabicText: 'لدي شاي.', level: 'A1', keywords: [] });
    await setLifeSentenceVisibility(db, 1, percent, 'public', 'Percent1');
    await setLifeSentenceVisibility(db, 1, other, 'public', 'Percent2');

    assert.deepEqual((await listPublicLifeSentences(db, 5, 0, { query: '50%' })).map(row => row.id), [percent]);
    assert.equal(await countPublicLifeSentences(db, { query: '__' }), 0);
    assert.equal((await listPublicLifeSentences(db, 5, 0, { query: 'خمسون' })).length, 1);
});

test('life unlisted sentence is hidden from public lists but opens and copies by share code', async () => {
    const db = createMockD1();
    const id = await createLifeSentence(db, { userId: 1, sourceType: 'bot_ai', originalArabic: 'سر.', germanText: 'Ich habe ein Geheimnis.', arabicText: 'لدي سر.', level: 'A1', keywords: [] });
    await setLifeSentenceVisibility(db, 1, id, 'unlisted', 'Hidden01');
    assert.equal(await countPublicLifeSentences(db, { query: 'Geheimnis' }), 0);
    assert.equal(await getLifeSentenceWithAuthorById(db, id, false), null);
    const byCode = await getLifeSentenceByShareCode(db, 'Hidden01');
    assert.equal(byCode.id, id);
    const copy = await createLifeSentenceCopy(db, byCode, 2);
    assert.equal((await getLifeSentenceById(db, 2, copy.newSentenceId)).visibility, 'private');
});

test('life private sentence cannot be copied through public lookup even if id is known', async () => {
    const db = createMockD1();
    const id = await createLifeSentence(db, { userId: 1, sourceType: 'bot_ai', originalArabic: 'خاص.', germanText: 'Das ist privat.', arabicText: 'هذا خاص.', level: 'A1', keywords: [] });
    assert.equal(await getLifeSentenceWithAuthorById(db, id, false), null);
    assert.equal(await getLifeSentenceByShareCode(db, 'missing'), null);
    assert.equal(await countCopiedLifeSentencesByUser(db, 2), 0);
});

test('life copied sentence SRS updates independently from source', async () => {
    const db = createMockD1();
    const id = await createLifeSentence(db, { userId: 1, sourceType: 'bot_ai', originalArabic: 'شربت ماء.', germanText: 'Ich habe Wasser getrunken.', arabicText: 'شربت الماء.', level: 'A1', keywords: [{ german_word: 'Wasser', arabic_meaning: 'ماء' }] });
    await setLifeSentenceVisibility(db, 1, id, 'public', 'SrsCopy1');
    const source = await getLifeSentenceWithAuthorById(db, id, false);
    const copy = await createLifeSentenceCopy(db, source, 2);
    const copied = await getLifeSentenceById(db, 2, copy.newSentenceId);
    const stats = reviewLifeSentenceStats(copied, true);
    await updateLifeSentenceReview(db, 2, copied.id, { isCorrect: true, ...stats });

    assert.equal((await getLifeSentenceById(db, 2, copied.id)).correct_count, 1);
    assert.equal((await getLifeSentenceById(db, 1, id)).correct_count, 0);
});

test('life due and hard filters exclude archived deleted future and other users', async () => {
    const db = createMockD1();
    const hard = await createLifeSentence(db, { userId: 1, sourceType: 'bot_ai', originalArabic: 'صعب.', germanText: 'Das ist schwierig.', arabicText: 'هذا صعب.', level: 'A1', nextReviewAt: '2000-01-01T00:00:00.000Z', keywords: [] });
    const future = await createLifeSentence(db, { userId: 1, sourceType: 'bot_ai', originalArabic: 'مستقبل.', germanText: 'Ich lerne morgen.', arabicText: 'أتعلم غداً.', level: 'A1', nextReviewAt: '2999-01-01T00:00:00.000Z', keywords: [] });
    const archived = await createLifeSentence(db, { userId: 1, sourceType: 'bot_ai', originalArabic: 'أرشيف.', germanText: 'Ich war dort.', arabicText: 'كنت هناك.', level: 'A1', nextReviewAt: '2000-01-01T00:00:00.000Z', keywords: [] });
    const other = await createLifeSentence(db, { userId: 2, sourceType: 'bot_ai', originalArabic: 'آخر.', germanText: 'Ich bin da.', arabicText: 'أنا هنا.', level: 'A1', nextReviewAt: '2000-01-01T00:00:00.000Z', keywords: [] });
    db._db.prepare("UPDATE life_sentences SET difficulty = 'hard' WHERE id = ?").run(hard);
    await archiveLifeSentence(db, 1, archived);

    assert.deepEqual((await listLifeSentences(db, 1, 10, 0, 'hard')).map(row => row.id), [hard]);
    assert.deepEqual((await listLifeSentences(db, 1, 10, 0, 'due')).map(row => row.id), [hard]);
    assert.equal((await listLifeSentences(db, 1, 10, 0, 'active')).some(row => row.id === other), false);
    assert.equal((await listLifeSentences(db, 1, 10, 0, 'due')).some(row => row.id === future), false);
});

test('life gap keyword prefers meaningful keyword over article and punctuation', () => {
    const prompt = chooseGapKeyword(
        { german_text: 'Der Tiger schläft.' },
        [{ german_word: 'Tiger', arabic_meaning: 'نمر' }]
    );
    assert.equal(prompt.answer, 'Tiger');
    assert.equal(prompt.prompt, 'Der ____ schläft.');
});

test('life report constraints reject malformed reason and keep source visible', async () => {
    const db = createMockD1();
    const id = await createLifeSentence(db, { userId: 1, sourceType: 'bot_ai', originalArabic: 'سوق.', germanText: 'Ich gehe zum Markt.', arabicText: 'أذهب إلى السوق.', level: 'A1', keywords: [] });
    await setLifeSentenceVisibility(db, 1, id, 'public', 'Report01');
    await assert.rejects(() => createLifeSentenceReport(db, id, 2, 'not_allowed'));
    assert.equal(await createLifeSentenceReport(db, id, 2, 'spam'), true);
    assert.equal((await getLifeSentenceWithAuthorById(db, id, false)).id, id);
});

test('life TTS command path records temporary audio without leaking German in caption', () => {
    const lifeSource = fs.readFileSync(new URL('../src/commands/life.ts', import.meta.url), 'utf8');
    assert.match(lifeSource, /ttlSeconds: LIFE_AUDIO_TTL_SECONDS/);
    assert.match(lifeSource, /const LIFE_AUDIO_TTL_SECONDS = 45/);
    assert.match(lifeSource, /kind: 'life_tts'/);
    assert.doesNotMatch(lifeSource, /caption:/);
    assert.doesNotMatch(lifeSource, /setTimeout/);
});

test('life ordering callbacks use indexes and keep callback data short', () => {
    const lifeSource = fs.readFileSync(new URL('../src/commands/life.ts', import.meta.url), 'utf8');
    assert.match(lifeSource, /life:ord:\$\{index\}/);
    assert.match(lifeSource, /handleLifeOrderUndo/);
    assert.match(lifeSource, /handleLifeOrderReset/);
    assert.ok('life:train_filter:hard:m'.length <= 64);
    assert.ok('life:copy_code:ABCDEFGH'.length <= 64);
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
