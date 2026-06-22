import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import {
    createLifeSentence,
    createLifeSentenceCopy,
    createLifeSentenceReport,
    getLifeSentenceById,
    getLifeSentenceByShareCode,
    getLifeSentenceWithAuthorById,
    listLifeSentences,
    listPinnedPublicLifeSentences,
    setLifeSentenceVisibility,
} from '../dist/repositories/lifeSentenceRepository.js';
import {
    changeModerationSentenceVisibility,
    countModerationReports,
    countModerationSentences,
    getModerationReportById,
    getModerationSentenceById,
    getModerationStats,
    hideAllPublicLifeSentencesForUser,
    hideModerationSentence,
    listModerationReports,
    listModerationSentences,
    listReportedUsers,
    logModerationAction,
    pinModerationSentence,
    replaceModerationSentenceKeywords,
    restoreModerationSentence,
    searchModerationSentences,
    setLifeSharingSuspended,
    softDeleteModerationSentence,
    unpinModerationSentence,
    updateModerationReportStatus,
    updateModerationSentenceText,
} from '../dist/repositories/lifeModerationRepository.js';

function createMockD1() {
    const sqlite = new Database(':memory:');
    sqlite.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE users (
            user_id INTEGER PRIMARY KEY,
            id INTEGER,
            name TEXT,
            display_name TEXT,
            telegram_id INTEGER,
            telegram_user_id INTEGER,
            telegram_username TEXT,
            username TEXT,
            xp INTEGER DEFAULT 0,
            level INTEGER DEFAULT 1,
            is_banned INTEGER DEFAULT 0,
            is_deleted INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
    `);
    sqlite.exec(fs.readFileSync(new URL('../src/db/migrations/0043_life_sentences.sql', import.meta.url), 'utf8'));
    sqlite.exec(fs.readFileSync(new URL('../src/db/migrations/0044_life_sentence_sharing.sql', import.meta.url), 'utf8'));
    sqlite.exec(fs.readFileSync(new URL('../src/db/migrations/0045_admin_moderation.sql', import.meta.url), 'utf8'));
    sqlite.exec(`
        INSERT INTO users (user_id, id, name, display_name, telegram_id, telegram_user_id, telegram_username, username)
        VALUES
            (1, 1, 'Admin', 'Admin', 100, 100, 'admin', 'admin'),
            (2, 2, 'Author', 'Author', 200, 200, 'author', 'author'),
            (3, 3, 'Reporter', 'Reporter', 300, 300, 'reporter', 'reporter'),
            (4, 4, 'Reader', 'Reader', 400, 400, 'reader', 'reader');
    `);
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

async function createPublicSentence(db, overrides = {}) {
    const id = await createLifeSentence(db, {
        userId: overrides.userId ?? 2,
        sourceType: 'bot_ai',
        originalArabic: overrides.originalArabic ?? 'ذهبت إلى السوق.',
        germanText: overrides.germanText ?? 'Ich gehe zum Markt.',
        arabicText: overrides.arabicText ?? 'أذهب إلى السوق.',
        pronunciationAr: overrides.pronunciationAr ?? 'إخ گيهه تسوم ماركت',
        memoryHint: overrides.memoryHint ?? 'private hint',
        level: overrides.level ?? 'A1',
        tense: overrides.tense ?? null,
        keywords: overrides.keywords ?? [{ german_word: 'Markt', arabic_meaning: 'سوق' }],
    });
    await setLifeSentenceVisibility(db, overrides.userId ?? 2, id, overrides.visibility ?? 'public', overrides.shareCode ?? `Life${id}X`);
    return id;
}

async function createReport(db, sentenceId, reason = 'spam') {
    await createLifeSentenceReport(db, sentenceId, 3, reason);
    const rows = await listModerationReports(db, 'all', 10, 0);
    return rows.find(row => row.sentence_id === sentenceId);
}

test('moderation center command is registered and guarded server side', () => {
    const botSource = fs.readFileSync(new URL('../src/bot/bot.ts', import.meta.url), 'utf8');
    const modSource = fs.readFileSync(new URL('../src/commands/adminModeration.ts', import.meta.url), 'utf8');
    assert.match(botSource, /registerAdminModerationCommand\(bot\)/);
    assert.match(modSource, /requireModerationAdmin/);
    assert.match(modSource, /isAdminTelegramId/);
});

test('admin panel contains moderation center button', () => {
    const adminSource = fs.readFileSync(new URL('../src/commands/admin.ts', import.meta.url), 'utf8');
    assert.match(adminSource, /🛡 مركز الإشراف/);
    assert.match(adminSource, /adm:mod/);
});

test('moderation migration adds fields tables and indexes', () => {
    const migration = fs.readFileSync(new URL('../src/db/migrations/0045_admin_moderation.sql', import.meta.url), 'utf8');
    for (const token of ['moderation_status', 'is_pinned', 'pin_order', 'life_sharing_suspended', 'admin_moderation_actions', 'reviewed_by_admin_id']) {
        assert.match(migration, new RegExp(token));
    }
});

test('existing life sentences default to approved moderation after migration', async () => {
    const db = createMockD1();
    const id = await createPublicSentence(db);
    const sentence = await getModerationSentenceById(db, id);
    assert.equal(sentence.moderation_status, 'approved');
    assert.equal(sentence.is_pinned, 0);
});

test('admin can list pending reports', async () => {
    const db = createMockD1();
    const id = await createPublicSentence(db);
    const report = await createReport(db, id);
    const rows = await listModerationReports(db, 'pending', 5, 0);
    assert.equal(rows[0].id, report.id);
    assert.equal(rows[0].status, 'pending');
});

test('report pagination returns limited pages', async () => {
    const db = createMockD1();
    for (let i = 0; i < 6; i++) await createReport(db, await createPublicSentence(db, { germanText: `Ich sehe ${i}.`, shareCode: `Pg${i}` }));
    assert.equal((await listModerationReports(db, 'pending', 5, 0)).length, 5);
    assert.equal((await listModerationReports(db, 'pending', 5, 5)).length, 1);
});

test('accepting report marks it reviewed with admin id', async () => {
    const db = createMockD1();
    const report = await createReport(db, await createPublicSentence(db));
    await updateModerationReportStatus(db, report.id, 'reviewed', 1);
    const updated = await getModerationReportById(db, report.id);
    assert.equal(updated.status, 'reviewed');
    assert.equal(updated.reviewed_by_admin_id, 1);
    assert.ok(updated.reviewed_at);
});

test('rejecting report marks it dismissed and preserves row', async () => {
    const db = createMockD1();
    const report = await createReport(db, await createPublicSentence(db));
    await updateModerationReportStatus(db, report.id, 'dismissed', 1);
    assert.equal((await getModerationReportById(db, report.id)).status, 'dismissed');
    assert.equal(await countModerationReports(db, 'all'), 1);
});

test('soft deleting sentence marks moderation removed', async () => {
    const db = createMockD1();
    const id = await createPublicSentence(db);
    await softDeleteModerationSentence(db, id, 1, 'bad');
    const sentence = await getModerationSentenceById(db, id);
    assert.equal(sentence.moderation_status, 'removed');
    assert.ok(sentence.deleted_at);
});

test('deleting sentence can mark report removed without deleting report row', async () => {
    const db = createMockD1();
    const report = await createReport(db, await createPublicSentence(db));
    await updateModerationReportStatus(db, report.id, 'removed', 1);
    assert.equal((await getModerationReportById(db, report.id)).status, 'removed');
    assert.equal(await countModerationReports(db, 'removed'), 1);
});

test('hidden sentence disappears from community public list', async () => {
    const db = createMockD1();
    const id = await createPublicSentence(db);
    await hideModerationSentence(db, id, 1, 'hide');
    assert.equal((await getLifeSentenceWithAuthorById(db, id, false)), null);
});

test('hidden sentence disappears from deep link lookup', async () => {
    const db = createMockD1();
    const id = await createPublicSentence(db, { shareCode: 'HideLink' });
    await hideModerationSentence(db, id, 1, 'hide');
    assert.equal(await getLifeSentenceByShareCode(db, 'HideLink'), null);
});

test('restoring deleted sentence makes it approved and private', async () => {
    const db = createMockD1();
    const id = await createPublicSentence(db);
    await softDeleteModerationSentence(db, id, 1);
    await restoreModerationSentence(db, id, 1, 'private');
    const sentence = await getModerationSentenceById(db, id);
    assert.equal(sentence.deleted_at, null);
    assert.equal(sentence.moderation_status, 'approved');
    assert.equal(sentence.visibility, 'private');
});

test('pinning a public sentence works', async () => {
    const db = createMockD1();
    const id = await createPublicSentence(db);
    assert.equal(await pinModerationSentence(db, id, 1), true);
    const sentence = await getModerationSentenceById(db, id);
    assert.equal(sentence.is_pinned, 1);
    assert.equal(sentence.pinned_by, 1);
});

test('pinned sentences appear before normal community section', async () => {
    const db = createMockD1();
    const normal = await createPublicSentence(db, { germanText: 'Normal.', shareCode: 'Norm01' });
    const pinned = await createPublicSentence(db, { germanText: 'Pinned.', shareCode: 'Pin01' });
    await pinModerationSentence(db, pinned, 1);
    const rows = await listPinnedPublicLifeSentences(db, 3);
    assert.equal(rows[0].id, pinned);
    assert.equal(rows.some(row => row.id === normal), false);
});

test('unpinning a sentence clears pin fields', async () => {
    const db = createMockD1();
    const id = await createPublicSentence(db);
    await pinModerationSentence(db, id, 1);
    await unpinModerationSentence(db, id, 1);
    const sentence = await getModerationSentenceById(db, id);
    assert.equal(sentence.is_pinned, 0);
    assert.equal(sentence.pin_order, 0);
});

test('private sentence cannot be pinned directly', async () => {
    const db = createMockD1();
    const id = await createLifeSentence(db, { userId: 2, sourceType: 'bot_ai', originalArabic: 'خاص', germanText: 'Privat.', arabicText: 'خاص.', level: 'A1', keywords: [] });
    assert.equal(await pinModerationSentence(db, id, 1), false);
});

test('non-admin callbacks are protected by moderation guard', () => {
    const modSource = fs.readFileSync(new URL('../src/commands/adminModeration.ts', import.meta.url), 'utf8');
    const guardMatches = modSource.match(/if \(!await requireModerationAdmin\(ctx\)\) return/g) ?? [];
    assert.ok(guardMatches.length >= 20);
    assert.match(modSource, /غير مصرح لك باستخدام هذا الأمر/);
});

test('admin can edit German text', async () => {
    const db = createMockD1();
    const id = await createPublicSentence(db);
    await updateModerationSentenceText(db, id, { germanText: 'Ich lerne Deutsch.' }, 1);
    assert.equal((await getModerationSentenceById(db, id)).german_text, 'Ich lerne Deutsch.');
});

test('admin can edit Arabic text', async () => {
    const db = createMockD1();
    const id = await createPublicSentence(db);
    await updateModerationSentenceText(db, id, { arabicText: 'أتعلم الألمانية.' }, 1);
    assert.equal((await getModerationSentenceById(db, id)).arabic_text, 'أتعلم الألمانية.');
});

test('admin level edit rejects invalid values by DB constraint', async () => {
    const db = createMockD1();
    const id = await createPublicSentence(db);
    await assert.rejects(() => updateModerationSentenceText(db, id, { level: 'C2' }, 1));
});

test('admin level edit accepts A2', async () => {
    const db = createMockD1();
    const id = await createPublicSentence(db);
    await updateModerationSentenceText(db, id, { level: 'A2' }, 1);
    assert.equal((await getModerationSentenceById(db, id)).level, 'A2');
});

test('admin keyword replacement works', async () => {
    const db = createMockD1();
    const id = await createPublicSentence(db);
    await replaceModerationSentenceKeywords(db, id, [{ german_word: 'Haus', arabic_meaning: 'بيت' }], 1);
    const row = db._db.prepare('SELECT german_word, arabic_meaning FROM life_sentence_keywords WHERE life_sentence_id = ?').get(id);
    assert.equal(row.german_word, 'Haus');
    assert.equal(row.arabic_meaning, 'بيت');
});

test('admin search finds public sentence by German text', async () => {
    const db = createMockD1();
    const id = await createPublicSentence(db, { germanText: 'Ich sehe einen Tiger.', shareCode: 'Search01' });
    assert.equal((await searchModerationSentences(db, 'Tiger', 5, 0))[0].id, id);
});

test('admin search finds private sentence', async () => {
    const db = createMockD1();
    const id = await createLifeSentence(db, { userId: 2, sourceType: 'bot_ai', originalArabic: 'خاص', germanText: 'Private Suche.', arabicText: 'بحث خاص.', level: 'A1', keywords: [] });
    assert.equal((await searchModerationSentences(db, 'Private', 5, 0))[0].id, id);
});

test('admin search finds deleted sentence', async () => {
    const db = createMockD1();
    const id = await createPublicSentence(db, { germanText: 'Gelöscht.', shareCode: 'DelSearch' });
    await softDeleteModerationSentence(db, id, 1);
    assert.equal((await searchModerationSentences(db, 'Gelöscht', 5, 0))[0].id, id);
});

test('admin search finds sentence by share code', async () => {
    const db = createMockD1();
    const id = await createPublicSentence(db, { shareCode: 'CodeFind' });
    assert.equal((await searchModerationSentences(db, 'CodeFind', 5, 0))[0].id, id);
});

test('reviewed report is retained in history', async () => {
    const db = createMockD1();
    const report = await createReport(db, await createPublicSentence(db));
    await updateModerationReportStatus(db, report.id, 'reviewed', 1);
    assert.equal(await countModerationReports(db, 'all'), 1);
});

test('audit log records pin action', async () => {
    const db = createMockD1();
    const id = await createPublicSentence(db);
    await logModerationAction(db, { adminUserId: 1, actionType: 'sentence_pinned', targetSentenceId: id });
    assert.equal(db._db.prepare("SELECT COUNT(*) AS count FROM admin_moderation_actions WHERE action_type = 'sentence_pinned'").get().count, 1);
});

test('audit log records unpin action', async () => {
    const db = createMockD1();
    const id = await createPublicSentence(db);
    await logModerationAction(db, { adminUserId: 1, actionType: 'sentence_unpinned', targetSentenceId: id });
    assert.equal(db._db.prepare("SELECT COUNT(*) AS count FROM admin_moderation_actions WHERE action_type = 'sentence_unpinned'").get().count, 1);
});

test('audit log records edit action', async () => {
    const db = createMockD1();
    const id = await createPublicSentence(db);
    await logModerationAction(db, { adminUserId: 1, actionType: 'sentence_edited', targetSentenceId: id });
    assert.equal(db._db.prepare("SELECT COUNT(*) AS count FROM admin_moderation_actions WHERE action_type = 'sentence_edited'").get().count, 1);
});

test('audit log records delete action', async () => {
    const db = createMockD1();
    const id = await createPublicSentence(db);
    await logModerationAction(db, { adminUserId: 1, actionType: 'sentence_deleted', targetSentenceId: id });
    assert.equal(db._db.prepare("SELECT COUNT(*) AS count FROM admin_moderation_actions WHERE action_type = 'sentence_deleted'").get().count, 1);
});

test('sharing suspension stores flag in life settings', async () => {
    const db = createMockD1();
    await setLifeSharingSuspended(db, 2, true, 1);
    assert.equal(db._db.prepare('SELECT life_sharing_suspended FROM life_user_settings WHERE user_id = 2').get().life_sharing_suspended, 1);
});

test('sharing suspension can be restored', async () => {
    const db = createMockD1();
    await setLifeSharingSuspended(db, 2, true, 1);
    await setLifeSharingSuspended(db, 2, false, 1);
    assert.equal(db._db.prepare('SELECT life_sharing_suspended FROM life_user_settings WHERE user_id = 2').get().life_sharing_suspended, 0);
});

test('suspended sharing does not delete private training sentences', async () => {
    const db = createMockD1();
    const id = await createLifeSentence(db, { userId: 2, sourceType: 'bot_ai', originalArabic: 'تدريب', germanText: 'Ich trainiere.', arabicText: 'أتدرب.', level: 'A1', keywords: [] });
    await setLifeSharingSuspended(db, 2, true, 1);
    assert.equal((await listLifeSentences(db, 2, 5, 0)).map(row => row.id).includes(id), true);
});

test('warning action is logged without exposing admin identity in user text path', async () => {
    const db = createMockD1();
    await logModerationAction(db, { adminUserId: 1, actionType: 'user_warned', targetUserId: 2, note: 'تنبيه' });
    const row = db._db.prepare("SELECT note FROM admin_moderation_actions WHERE action_type = 'user_warned'").get();
    assert.equal(row.note, 'تنبيه');
});

test('missing report returns null safely', async () => {
    const db = createMockD1();
    assert.equal(await getModerationReportById(db, 999), null);
});

test('moderation callback data stays within Telegram 64 byte limit', () => {
    for (const callback of ['adm:mod', 'adm:rep:p:123', 'adm:sent:v:123456', 'adm:sent:edit:123456:kw', 'adm:user:do:hideall:123456']) {
        assert.ok(Buffer.byteLength(callback, 'utf8') <= 64, callback);
    }
});

test('community menu renders pinned sentence section', () => {
    const lifeSource = fs.readFileSync(new URL('../src/commands/life.ts', import.meta.url), 'utf8');
    assert.match(lifeSource, /listPinnedPublicLifeSentences/);
    assert.match(lifeSource, /📌 جمل مميزة/);
});

test('old report callbacks remain wired', () => {
    const lifeSource = fs.readFileSync(new URL('../src/commands/life.ts', import.meta.url), 'utf8');
    assert.match(lifeSource, /life:report:/);
    assert.match(lifeSource, /createLifeSentenceReport/);
});

test('life training callbacks remain wired after moderation changes', () => {
    const lifeSource = fs.readFileSync(new URL('../src/commands/life.ts', import.meta.url), 'utf8');
    for (const callback of ['life:train:w', 'life:train:l', 'life:train:o', 'life:train:f']) {
        assert.match(lifeSource, new RegExp(callback.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
});

test('hidden public sentence cannot be copied through public id lookup', async () => {
    const db = createMockD1();
    const id = await createPublicSentence(db);
    await hideModerationSentence(db, id, 1);
    assert.equal(await getLifeSentenceWithAuthorById(db, id, true), null);
});

test('removed public sentence cannot be opened through share code', async () => {
    const db = createMockD1();
    const id = await createPublicSentence(db, { shareCode: 'Gone01' });
    await softDeleteModerationSentence(db, id, 1);
    assert.equal(await getLifeSentenceByShareCode(db, 'Gone01'), null);
});

test('soft deleting original does not delete existing copy', async () => {
    const db = createMockD1();
    const id = await createPublicSentence(db);
    const source = await getLifeSentenceWithAuthorById(db, id, false);
    const copy = await createLifeSentenceCopy(db, source, 4);
    await softDeleteModerationSentence(db, id, 1);
    assert.ok(await getLifeSentenceById(db, 4, copy.newSentenceId));
});

test('moderation stats count reports hidden pinned and suspended users', async () => {
    const db = createMockD1();
    const id = await createPublicSentence(db);
    await createReport(db, id);
    await hideModerationSentence(db, id, 1);
    await setLifeSharingSuspended(db, 2, true, 1);
    const stats = await getModerationStats(db);
    assert.equal(stats.pendingReports, 1);
    assert.equal(stats.hiddenSentences, 1);
    assert.equal(stats.suspendedUsers, 1);
});

test('reported users list shows publisher report totals', async () => {
    const db = createMockD1();
    await createReport(db, await createPublicSentence(db));
    const users = await listReportedUsers(db, 5, 0);
    assert.equal(users[0].user_id, 2);
    assert.equal(users[0].received_reports, 1);
});

test('hide all public sentences for user leaves private sentences alone', async () => {
    const db = createMockD1();
    const publicId = await createPublicSentence(db);
    const privateId = await createLifeSentence(db, { userId: 2, sourceType: 'bot_ai', originalArabic: 'خاص', germanText: 'Privat.', arabicText: 'خاص.', level: 'A1', keywords: [] });
    await hideAllPublicLifeSentencesForUser(db, 2, 1, 'bulk');
    assert.equal((await getModerationSentenceById(db, publicId)).moderation_status, 'hidden');
    assert.equal((await getModerationSentenceById(db, privateId)).moderation_status, 'approved');
});

test('admin visibility change can make sentence unlisted', async () => {
    const db = createMockD1();
    const id = await createPublicSentence(db);
    await changeModerationSentenceVisibility(db, id, 'unlisted', 1);
    assert.equal((await getModerationSentenceById(db, id)).visibility, 'unlisted');
});

test('admin sentence lists expose hidden deleted pinned and public scopes', async () => {
    const db = createMockD1();
    const publicId = await createPublicSentence(db, { shareCode: 'Scope1' });
    const hiddenId = await createPublicSentence(db, { shareCode: 'Scope2' });
    const deletedId = await createPublicSentence(db, { shareCode: 'Scope3' });
    await pinModerationSentence(db, publicId, 1);
    await hideModerationSentence(db, hiddenId, 1);
    await softDeleteModerationSentence(db, deletedId, 1);
    assert.equal((await listModerationSentences(db, 'pinned', 5, 0))[0].id, publicId);
    assert.equal((await listModerationSentences(db, 'hidden', 5, 0))[0].id, hiddenId);
    assert.equal((await listModerationSentences(db, 'deleted', 5, 0))[0].id, deletedId);
    assert.ok((await listModerationSentences(db, 'public', 5, 0)).some(row => row.id === publicId));
});
