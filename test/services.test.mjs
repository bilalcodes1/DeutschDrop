import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { parseWordCsv } from '../dist/services/csvParser.js';
import { calculateNextReview } from '../dist/services/srs.js';
import { getLevelFromXp, getProgressToNextLevel } from '../dist/services/xpMath.js';
import { buildArasaacImageUrl, normalizeArasaacResults, searchEducationalPictograms } from '../dist/services/pictogramSearch.js';
import { getAdminTelegramIds, isAdminTelegramId } from '../dist/services/adminAccess.js';
import { classifyHttpStatus } from '../dist/services/ai/aiErrors.js';

test('parseWordCsv handles quoted commas and examples', () => {
    const parsed = parseWordCsv('German,Arabic,Example\nHaus,بيت,"Das Haus ist groß, aber alt."\nAuto,سيارة,');

    assert.equal(parsed.errors, 0);
    assert.deepEqual(parsed.words, [
        { german: 'Haus', arabic: 'بيت', example: 'Das Haus ist groß, aber alt.' },
        { german: 'Auto', arabic: 'سيارة', example: null },
    ]);
});

test('parseWordCsv handles equals format and invalid rows', () => {
    const parsed = parseWordCsv('Haus=بيت\ninvalid\nAuto=سيارة');

    assert.equal(parsed.errors, 1);
    assert.deepEqual(parsed.words, [
        { german: 'Haus', arabic: 'بيت', example: null },
        { german: 'Auto', arabic: 'سيارة', example: null },
    ]);
});

test('parseWordCsv handles BOM headers and collapses spaces', () => {
    const parsed = parseWordCsv('\uFEFFGerman,Arabic,Example\n  Auto  ,  سيارة  ,  Ich   habe   ein Auto.  ');

    assert.equal(parsed.errors, 0);
    assert.deepEqual(parsed.words, [
        { german: 'Auto', arabic: 'سيارة', example: 'Ich habe ein Auto.' },
    ]);
});

test('calculateNextReview advances correct answers and caps hard failures', () => {
    const correct = calculateNextReview(
        { easeFactor: 2.5, interval: 0, repetitions: 0, correctCount: 0, wrongCount: 0 },
        true,
        'easy'
    );
    assert.equal(correct.status, 'learning');
    assert.equal(correct.interval, 1);
    assert.equal(correct.repetitions, 1);
    assert.equal(correct.easeFactor, 2.65);

    const wrong = calculateNextReview(
        { easeFactor: 1.35, interval: 10, repetitions: 4, correctCount: 4, wrongCount: 0 },
        false,
        'hard'
    );
    assert.equal(wrong.status, 'learning');
    assert.equal(wrong.interval, 0);
    assert.equal(wrong.repetitions, 0);
    assert.equal(wrong.easeFactor, 1.3);

    const nextReviewMs = new Date(wrong.nextReview).getTime();
    const oneHourFromNow = Date.now() + 60 * 60 * 1000;
    assert.ok(Math.abs(nextReviewMs - oneHourFromNow) < 60_000);
});

test('calculateNextReview uses fixed review intervals', () => {
    const second = calculateNextReview(
        { easeFactor: 2.5, interval: 1, repetitions: 1, correctCount: 1, wrongCount: 0 },
        true,
        'medium'
    );
    assert.equal(second.interval, 3);

    const fifth = calculateNextReview(
        { easeFactor: 2.5, interval: 14, repetitions: 4, correctCount: 4, wrongCount: 0 },
        true,
        'medium'
    );
    assert.equal(fifth.interval, 30);
});

test('XP level helpers return current level and progress', () => {
    assert.deepEqual(getLevelFromXp(1500), { level: 3, nextLevelXp: 3000 });

    const progress = getProgressToNextLevel(2000);
    assert.equal(progress.currentLevel, 3);
    assert.equal(progress.current, 2000);
    assert.equal(progress.target, 3000);
    assert.equal(progress.percent, 33);
});

test('pictogram helpers normalize ARASAAC results', () => {
    assert.equal(
        buildArasaacImageUrl(6964),
        'https://static.arasaac.org/pictograms/6964/6964_300.png'
    );

    const results = normalizeArasaacResults([
        { _id: 1, keywords: [{ keyword: 'Gebäude' }], aac: false, aacColor: false, schematic: false },
        { _id: 6964, keywords: [{ keyword: 'Haus' }], aac: true, aacColor: true, schematic: true },
    ], 'Haus');

    assert.equal(results[0].pictogramId, '6964');
    assert.equal(results[0].provider, 'arasaac');
    assert.equal(results[0].attribution, 'Pictogram: ARASAAC / Sergio Palao');
});

test('pictogram search limits options to 3 for words without saved pictogram', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
        ok: true,
        json: async () => [
            { _id: 1, keywords: [{ keyword: 'Haus' }], aac: true, aacColor: true, schematic: true },
            { _id: 2, keywords: [{ keyword: 'Haus' }] },
            { _id: 3, keywords: [{ keyword: 'Haus' }] },
            { _id: 4, keywords: [{ keyword: 'Haus' }] },
        ],
    });

    try {
        const results = await searchEducationalPictograms('Haus', 'بيت', 3);
        assert.equal(results.length, 3);
        assert.deepEqual(results.map(result => result.pictogramId), ['1', '2', '3']);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('pictogram repository uses word_id upsert to replace one row', () => {
    const repositorySource = fs.readFileSync(new URL('../src/repositories/pictogramRepository.ts', import.meta.url), 'utf8');
    const schemaSource = fs.readFileSync(new URL('../src/db/schema.sql', import.meta.url), 'utf8');

    assert.match(repositorySource, /export async function getPictogramByWordId/);
    assert.match(repositorySource, /export async function upsertPictogramForWord/);
    assert.match(repositorySource, /ON CONFLICT\(word_id\) DO UPDATE/);
    assert.match(schemaSource, /CREATE UNIQUE INDEX IF NOT EXISTS idx_word_pictograms_word_id/);
});

test('CSV upload flow does not call ARASAAC pictogram search', () => {
    const uploadSource = fs.readFileSync(new URL('../src/commands/upload.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(uploadSource, /pictogramSearch|searchEducationalPictograms|ARASAAC/i);
});

test('saved pictogram view path does not call ARASAAC search directly', () => {
    const source = fs.readFileSync(new URL('../src/commands/pictograms.ts', import.meta.url), 'utf8');
    const viewBlock = source.slice(source.indexOf("bot.callbackQuery(/^pictogram_view_"), source.indexOf("bot.callbackQuery(/^pictogram_use_"));
    assert.match(viewBlock, /showSavedPictogram/);
    assert.doesNotMatch(viewBlock, /searchEducationalPictograms/);
});

test('public start flow asks new users for display name and stores registration session', () => {
    const source = fs.readFileSync(new URL('../src/commands/start.ts', import.meta.url), 'utf8');
    assert.match(source, /اكتب اسمك للانضمام/);
    assert.match(source, /saveBotSession<NameSessionData>\(ctx\.db, user\.user_id, 'register'/);
    assert.match(source, /completeUserRegistration\(ctx\.db, user\.user_id, displayName\)/);
    assert.match(source, /تم تسجيلك ✅ أهلاً/);
});

test('registered start flow skips name prompt and shows main menu', () => {
    const source = fs.readFileSync(new URL('../src/commands/start.ts', import.meta.url), 'utf8');
    assert.match(source, /if \(!user\.display_name\?\.trim\(\)\)/);
    assert.match(source, /مرحباً مجدداً/);
    assert.match(source, /showMainMenu\(ctx\)/);
});

test('rename flow updates display_name', () => {
    const startSource = fs.readFileSync(new URL('../src/commands/start.ts', import.meta.url), 'utf8');
    const repositorySource = fs.readFileSync(new URL('../src/repositories/userRepository.ts', import.meta.url), 'utf8');
    assert.match(startSource, /bot\.command\('rename'/);
    assert.match(startSource, /اكتب الاسم الجديد/);
    assert.match(repositorySource, /export async function renameUser/);
    assert.match(repositorySource, /SET display_name = \?, name = \?/);
});

test('leaderboard uses display_name and orders by XP', () => {
    const xpSource = fs.readFileSync(new URL('../src/services/xpLevels.ts', import.meta.url), 'utf8');
    const leaderboardSource = fs.readFileSync(new URL('../src/commands/leaderboard.ts', import.meta.url), 'utf8');
    assert.match(xpSource, /COALESCE\(u\.display_name, u\.name\) AS display_name/);
    assert.match(xpSource, /ORDER BY total_xp DESC/);
    assert.match(leaderboardSource, /الترتيب العام/);
});

test('word duplicate checks remain scoped per user', () => {
    const source = fs.readFileSync(new URL('../src/repositories/wordRepository.ts', import.meta.url), 'utf8');
    assert.match(source, /SELECT \* FROM words WHERE added_by = \?/);
    assert.match(source, /normalizeGermanForCompare\(word\.german\) === key/);
    assert.match(source, /createWordAndAssignToUser/);
});

test('main menu exposes the requested public navigation buttons', () => {
    const source = fs.readFileSync(new URL('../src/commands/menu.ts', import.meta.url), 'utf8');
    for (const label of ['📚 تعلم', '🏋️ تدريب', '⚔️ تحدي', '🏆 الترتيب', '📂 إدارة الكلمات', '📊 الإحصائيات', '👤 ملفي الشخصي', '⚙️ الإعدادات']) {
        assert.match(source, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    assert.match(source, /menu_main/);
});

test('word list uses D1 pagination and exposes page controls', () => {
    const addWordSource = fs.readFileSync(new URL('../src/commands/addword.ts', import.meta.url), 'utf8');
    const repositorySource = fs.readFileSync(new URL('../src/repositories/wordRepository.ts', import.meta.url), 'utf8');
    const menuSource = fs.readFileSync(new URL('../src/commands/menu.ts', import.meta.url), 'utf8');

    assert.match(menuSource, /📋 عرض كل الكلمات/);
    assert.match(repositorySource, /export async function countWordsByUser/);
    assert.match(repositorySource, /export async function getWordsByUserPaginated/);
    assert.match(repositorySource, /LIMIT \? OFFSET \?/);
    assert.match(addWordSource, /const WORDS_PAGE_SIZE = 10/);
    assert.match(addWordSource, /الصفحة:/);
    assert.match(addWordSource, /التالي ➡️/);
    assert.match(addWordSource, /⬅️ السابق/);
});

test('word list first and last pages hide unavailable navigation', () => {
    const addWordSource = fs.readFileSync(new URL('../src/commands/addword.ts', import.meta.url), 'utf8');
    assert.match(addWordSource, /if \(page > 0\)/);
    assert.match(addWordSource, /if \(page < totalPages - 1\)/);
    assert.match(addWordSource, /word_detail_\$\{word\.word_id\}/);
});

test('word search is scoped to current user and paginated', () => {
    const repositorySource = fs.readFileSync(new URL('../src/repositories/wordRepository.ts', import.meta.url), 'utf8');
    const addWordSource = fs.readFileSync(new URL('../src/commands/addword.ts', import.meta.url), 'utf8');

    assert.match(repositorySource, /export async function searchWordsByUser/);
    assert.match(repositorySource, /export async function countSearchWordsByUser/);
    assert.match(repositorySource, /WHERE added_by = \?/);
    assert.match(repositorySource, /german LIKE \? COLLATE NOCASE OR arabic LIKE \?/);
    assert.match(addWordSource, /word_search_start/);
    assert.match(addWordSource, /word_search_page_/);
    assert.match(addWordSource, /اكتب كلمة للبحث/);
});

test('admin main menu button is shown only for admins', () => {
    const source = fs.readFileSync(new URL('../src/commands/menu.ts', import.meta.url), 'utf8');
    const wranglerSource = fs.readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');

    assert.match(source, /mainMenuKeyboard\(isAdmin: boolean = false\)/);
    assert.match(source, /isAdminTelegramId\(ctx\.env, ctx\.from\?\.id\)/);
    assert.match(source, /if \(isAdmin\) keyboard\.text\('🛠 لوحة الأدمن', 'admin_panel'\)/);
    assert.match(wranglerSource, /ADMIN_TELEGRAM_IDS = "8590766269,8014388174"/);
});

test('word panel shows review status and pictogram-specific actions', () => {
    const source = fs.readFileSync(new URL('../src/commands/wordPanel.ts', import.meta.url), 'utf8');
    assert.match(source, /حالة المراجعة/);
    assert.match(source, /🖼 عرض الرمز/);
    assert.match(source, /🖼 تعيين رمز/);
    assert.match(source, /🔄 تغيير الرمز/);
    assert.match(source, /word\.added_by !== user\.user_id/);
});

test('pictogram flow uses single-message carousel controls', () => {
    const source = fs.readFileSync(new URL('../src/commands/pictograms.ts', import.meta.url), 'utf8');
    assert.match(source, /editMessageMedia/);
    assert.match(source, /pictogram_nav_/);
    assert.match(source, /⬅️ السابق/);
    assert.match(source, /التالي ➡️/);
    assert.match(source, /❌ إلغاء/);
});

test('admin commands are gated by ADMIN_TELEGRAM_IDS', () => {
    const source = fs.readFileSync(new URL('../src/commands/admin.ts', import.meta.url), 'utf8');
    for (const command of ['admin_stats', 'users', 'broadcast', 'ban', 'unban']) {
        assert.match(source, new RegExp(`bot\\.command\\('${command}'`));
    }
    assert.match(source, /isAdminTelegramId\(ctx\.env, ctx\.from\?\.id\)/);
    assert.match(source, /غير مصرح لك باستخدام هذا الأمر/);
});

test('configured admin IDs are allowed', () => {
    const env = { ADMIN_TELEGRAM_IDS: '8590766269,8014388174' };

    assert.deepEqual(getAdminTelegramIds(env), [8590766269, 8014388174]);
    assert.equal(isAdminTelegramId(env, 8590766269), true);
    assert.equal(isAdminTelegramId(env, 8014388174), true);
});

test('non-admin IDs are denied', () => {
    const env = { ADMIN_TELEGRAM_IDS: '8590766269,8014388174' };

    assert.equal(isAdminTelegramId(env, 123456789), false);
    assert.equal(isAdminTelegramId({}, 8590766269), false);
});

test('support project button is shown in main menu', () => {
    const source = fs.readFileSync(new URL('../src/commands/menu.ts', import.meta.url), 'utf8');
    assert.match(source, /💙 دعم المشروع/);
    assert.match(source, /menu_support/);
});

test('support screens include QiCard number and ZainCash QR flow', () => {
    const source = fs.readFileSync(new URL('../src/commands/support.ts', import.meta.url), 'utf8');
    assert.match(source, /7112008623/);
    assert.match(source, /support_zaincash/);
    assert.match(source, /ZAINCASH_QR_URL/);
    assert.match(source, /امسح الباركود للتحويل/);
});

test('Payoneer support request is persisted', () => {
    const supportSource = fs.readFileSync(new URL('../src/commands/support.ts', import.meta.url), 'utf8');
    const repoSource = fs.readFileSync(new URL('../src/repositories/supportRepository.ts', import.meta.url), 'utf8');
    assert.match(supportSource, /support_payoneer_request/);
    assert.match(supportSource, /createSupportRequest\(ctx\.db, user\.user_id, 'payoneer'/);
    assert.match(repoSource, /INSERT INTO support_requests/);
});

test('support notifications are sent only through configured admin IDs', () => {
    const supportSource = fs.readFileSync(new URL('../src/commands/support.ts', import.meta.url), 'utf8');
    const wranglerSource = fs.readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');

    assert.match(supportSource, /getAdminTelegramIds\(ctx\.env\)/);
    assert.doesNotMatch(supportSource, /ADMIN_TELEGRAM_IDS\?\.split/);
    assert.match(supportSource, /sendTelegramMessage\(ctx\.env, id, text\)/);
    assert.match(wranglerSource, /ADMIN_TELEGRAM_IDS = "8590766269,8014388174"/);
});

test('support approval callbacks require admin and activate supporter for 24 hours', () => {
    const supportSource = fs.readFileSync(new URL('../src/commands/support.ts', import.meta.url), 'utf8');
    const repositorySource = fs.readFileSync(new URL('../src/repositories/supportRepository.ts', import.meta.url), 'utf8');

    const approveBlock = supportSource.slice(
        supportSource.indexOf("bot.callbackQuery(/^support_approve_"),
        supportSource.indexOf("bot.callbackQuery(/^support_reject_")
    );
    assert.match(approveBlock, /requireSupportAdmin\(ctx\)/);
    assert.match(approveBlock, /updateSupportProofStatus\(ctx\.db, proofId, 'approved'/);
    assert.match(approveBlock, /activateSupporterFor24Hours/);
    assert.match(repositorySource, /Date\.now\(\) \+ 24 \* 60 \* 60 \* 1000/);
    assert.match(repositorySource, /supporter_until/);
});

test('non-admin cannot approve or reject support proofs', () => {
    const supportSource = fs.readFileSync(new URL('../src/commands/support.ts', import.meta.url), 'utf8');
    assert.match(supportSource, /async function requireSupportAdmin/);
    assert.match(supportSource, /isAdminTelegramId\(ctx\.env, ctx\.from\?\.id\)/);
    assert.match(supportSource, /غير مصرح لك باستخدام هذا الأمر/);
});

test('profile and leaderboard show active supporter badge', () => {
    const profileSource = fs.readFileSync(new URL('../src/commands/profile.ts', import.meta.url), 'utf8');
    const leaderboardSource = fs.readFileSync(new URL('../src/commands/leaderboard.ts', import.meta.url), 'utf8');
    const xpSource = fs.readFileSync(new URL('../src/services/xpLevels.ts', import.meta.url), 'utf8');

    assert.match(profileSource, /getActiveSupportStatus/);
    assert.match(profileSource, /💙 حسابك مثبت كداعِم/);
    assert.match(leaderboardSource, /is_supporter_active \? ' 💙' : ''/);
    assert.match(xpSource, /LEFT JOIN user_support_status/);
    assert.match(xpSource, /supporter_until > datetime\('now'\)/);
});

test('admin broadcast is protected and skips banned users', () => {
    const adminSource = fs.readFileSync(new URL('../src/commands/admin.ts', import.meta.url), 'utf8');

    assert.match(adminSource, /bot\.callbackQuery\('admin_broadcast_confirm'/);
    assert.match(adminSource, /requireAdmin\(ctx\)/);
    assert.match(adminSource, /if \(user\.is_banned\) continue/);
    assert.match(adminSource, /createBroadcastLog/);
});

test('pending support proofs are reachable only from admin panel', () => {
    const adminSource = fs.readFileSync(new URL('../src/commands/admin.ts', import.meta.url), 'utf8');
    const supportSource = fs.readFileSync(new URL('../src/commands/support.ts', import.meta.url), 'utf8');

    assert.match(adminSource, /bot\.callbackQuery\(\/\^admin_support_pending/);
    assert.match(adminSource, /requireAdmin\(ctx\)/);
    assert.match(adminSource, /getPendingSupportProofs/);
    assert.match(supportSource, /supportProofAdminKeyboard/);
    assert.doesNotMatch(supportSource, /support_proofs WHERE status = 'pending'/);
});

test('supporter admin migration adds status and broadcast tables', () => {
    const migrationSource = fs.readFileSync(new URL('../src/db/migrations/0009_supporter_admin_tools.sql', import.meta.url), 'utf8');
    const schemaSource = fs.readFileSync(new URL('../src/db/schema.sql', import.meta.url), 'utf8');

    assert.match(migrationSource, /ALTER TABLE support_proofs ADD COLUMN status/);
    assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS user_support_status/);
    assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS broadcast_logs/);
    assert.match(schemaSource, /'admin_broadcast'/);
});

test('home button edits the existing main menu panel', () => {
    const menuSource = fs.readFileSync(new URL('../src/commands/menu.ts', import.meta.url), 'utf8');
    const wordPanelSource = fs.readFileSync(new URL('../src/commands/wordPanel.ts', import.meta.url), 'utf8');
    const mainCallback = menuSource.slice(menuSource.indexOf("bot.callbackQuery('menu_main'"), menuSource.indexOf('export async function showMainMenu'));

    assert.match(mainCallback, /showMainMenu\(ctx\)/);
    assert.doesNotMatch(mainCallback, /ctx\.reply/);
    assert.match(wordPanelSource, /ctx\.editMessageText/);
    assert.match(wordPanelSource, /await ctx\.reply\(text/);
});

test('role badges distinguish member admin and active supporter', () => {
    const roleSource = fs.readFileSync(new URL('../src/services/roleUi.ts', import.meta.url), 'utf8');
    assert.match(roleSource, /export function getUserRoleBadge/);
    assert.match(roleSource, /return '🛡 أدمن'/);
    assert.match(roleSource, /return '💙 داعم'/);
    assert.match(roleSource, /return '👤 عضو'/);
    assert.match(roleSource, /isAdminTelegramId/);
});

test('profile shows role and supporter pinning details', () => {
    const profileSource = fs.readFileSync(new URL('../src/commands/profile.ts', import.meta.url), 'utf8');
    assert.match(profileSource, /getUserRoleBadge/);
    assert.match(profileSource, /الحالة:/);
    assert.match(profileSource, /Telegram ID:/);
    assert.match(profileSource, /حسابك مثبت كداعِم/);
});

test('admin can create broadcast and non-admin is denied', () => {
    const adminSource = fs.readFileSync(new URL('../src/commands/admin.ts', import.meta.url), 'utf8');
    assert.match(adminSource, /bot\.callbackQuery\('admin_broadcast_start'/);
    assert.match(adminSource, /bot\.callbackQuery\('admin_broadcast_confirm'/);
    assert.match(adminSource, /if \(!await requireAdmin\(ctx\)\) return/);
    assert.match(adminSource, /غير مصرح لك باستخدام هذا الأمر/);
    assert.match(adminSource, /✅ إرسال للجميع/);
});

test('/admin panel exposes broadcast and announcement pinning', () => {
    const adminSource = fs.readFileSync(new URL('../src/commands/admin.ts', import.meta.url), 'utf8');
    assert.match(adminSource, /bot\.command\('admin'/);
    assert.match(adminSource, /📢 إرسال تبليغ/);
    assert.match(adminSource, /📌 تثبيت رسالة داخل البوت/);
    assert.match(adminSource, /admin_announcement_start/);
    assert.match(adminSource, /requireAdmin\(ctx\)/);
});

test('CSV duplicate logic is scoped to user and supports update existing', () => {
    const wordSource = fs.readFileSync(new URL('../src/repositories/wordRepository.ts', import.meta.url), 'utf8');
    const uploadSource = fs.readFileSync(new URL('../src/commands/upload.ts', import.meta.url), 'utf8');

    assert.match(wordSource, /normalizeGermanForCompare/);
    assert.match(wordSource, /SELECT \* FROM words WHERE added_by = \?/);
    assert.match(uploadSource, /duplicateRows/);
    assert.match(uploadSource, /upload_update_existing/);
    assert.match(uploadSource, /updateExistingWordFieldsForUser/);
    assert.match(uploadSource, /لم تتم إضافة كلمات جديدة/);
});

test('word selection bulk delete is limited to current user', () => {
    const addWordSource = fs.readFileSync(new URL('../src/commands/addword.ts', import.meta.url), 'utf8');
    const wordSource = fs.readFileSync(new URL('../src/repositories/wordRepository.ts', import.meta.url), 'utf8');

    for (const callback of ['select_words', 'word_select_all', 'word_delete_selected', 'word_delete_all']) {
        assert.match(addWordSource, new RegExp(callback));
    }
    assert.match(addWordSource, /saveBotSession<WordSelectionSession>/);
    assert.match(addWordSource, /getWordsByUserPaginated\(ctx\.db, userId, WORDS_PAGE_SIZE/);
    assert.match(addWordSource, /⬅️ رجوع للعرض/);
    assert.match(wordSource, /deleteWordsForUser/);
    assert.match(wordSource, /deleteAllWordsForUser/);
    assert.match(wordSource, /deleteWordForUser\(db, userId, wordId\)/);
});

test('smart notifications include retrieval practice types and cooldown rules', () => {
    const indexSource = fs.readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
    const serviceSource = fs.readFileSync(new URL('../src/services/smartNotificationService.ts', import.meta.url), 'utf8');
    const migrationSource = fs.readFileSync(new URL('../src/db/migrations/0013_smart_learning_notifications.sql', import.meta.url), 'utf8');

    assert.match(indexSource, /sendSmartNotification/);
    assert.match(serviceSource, /selectNotificationForUser/);
    assert.match(serviceSource, /quick_recall/);
    assert.match(serviceSource, /due_word/);
    assert.match(serviceSource, /hard_word/);
    assert.match(serviceSource, /context_example/);
    assert.match(serviceSource, /pictogram_recall/);
    assert.match(serviceSource, /daily_summary/);
    assert.match(serviceSource, /withinHours\(settings\.last_notification_at, 6\)/);
    assert.match(serviceSource, /withinMinutes\(user\.updated_at, 30\)/);
    assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS notification_events/);
});

test('user without words gets no words notification', () => {
    const serviceSource = fs.readFileSync(new URL('../src/services/smartNotificationService.ts', import.meta.url), 'utf8');
    assert.match(serviceSource, /if \(totalWords === 0\)/);
    assert.match(serviceSource, /buildNoWordsNotification/);
    assert.match(serviceSource, /ابدأ رحلتك مع DeutschDrop/);
});

test('user with due words gets German word notification and avoids repeat for 24 hours', () => {
    const serviceSource = fs.readFileSync(new URL('../src/services/smartNotificationService.ts', import.meta.url), 'utf8');
    assert.match(serviceSource, /countDueWords/);
    assert.match(serviceSource, /SELECT w\.word_id, w\.german, w\.arabic, w\.example/);
    assert.match(serviceSource, /ne\.sent_at >= datetime\('now', '-24 hours'\)/);
    assert.match(serviceSource, /🇩🇪 \$\{word\.german\}/);
});

test('notification callbacks show meaning and store known forgotten responses', () => {
    const commandSource = fs.readFileSync(new URL('../src/commands/smartNotifications.ts', import.meta.url), 'utf8');
    const serviceSource = fs.readFileSync(new URL('../src/services/smartNotificationService.ts', import.meta.url), 'utf8');
    const botSource = fs.readFileSync(new URL('../src/bot/bot.ts', import.meta.url), 'utf8');

    assert.match(botSource, /registerSmartNotificationCommand/);
    assert.match(commandSource, /notif_show_/);
    assert.match(commandSource, /🇮🇶 \$\{word\.arabic\}/);
    assert.match(commandSource, /word\.example/);
    assert.match(commandSource, /notif_known_/);
    assert.match(commandSource, /notif_forgot_/);
    assert.match(serviceSource, /recordNotificationResponse/);
    assert.match(serviceSource, /markForgottenForTrainingPriority/);
});

test('notification intensity limits light normal intensive and disabled sends nothing', () => {
    const serviceSource = fs.readFileSync(new URL('../src/services/smartNotificationService.ts', import.meta.url), 'utf8');
    const settingsSource = fs.readFileSync(new URL('../src/commands/settings.ts', import.meta.url), 'utf8');

    assert.match(serviceSource, /settings\.reminders_enabled === 0/);
    assert.match(serviceSource, /notification_intensity === 'off'/);
    assert.match(serviceSource, /if \(intensity === 'light'\) return 1/);
    assert.match(serviceSource, /if \(intensity === 'intensive'\) return 3/);
    assert.match(serviceSource, /return 2/);
    assert.match(settingsSource, /إعدادات الإشعارات/);
    assert.match(settingsSource, /notification_intensity_light/);
});

test('hard word pictogram and daily summary notification paths exist', () => {
    const serviceSource = fs.readFileSync(new URL('../src/services/smartNotificationService.ts', import.meta.url), 'utf8');
    assert.match(serviceSource, /selectHardWord/);
    assert.match(serviceSource, /wrong_count >= 2/);
    assert.match(serviceSource, /selectPictogramWord/);
    assert.match(serviceSource, /INNER JOIN word_pictograms/);
    assert.match(serviceSource, /sendPhoto/);
    assert.match(serviceSource, /buildDailySummaryNotification/);
    assert.match(serviceSource, /XP اليوم/);
    assert.match(serviceSource, /السلسلة:/);
});

test('active announcement is rendered in main menu and can be cleared', () => {
    const menuSource = fs.readFileSync(new URL('../src/commands/menu.ts', import.meta.url), 'utf8');
    const adminSource = fs.readFileSync(new URL('../src/commands/admin.ts', import.meta.url), 'utf8');
    const repoSource = fs.readFileSync(new URL('../src/repositories/announcementRepository.ts', import.meta.url), 'utf8');
    const migrationSource = fs.readFileSync(new URL('../src/db/migrations/0010_admin_announcements_and_role_ui.sql', import.meta.url), 'utf8');

    assert.match(menuSource, /getActiveAnnouncement/);
    assert.match(menuSource, /📌 \*إعلان:\*/);
    assert.match(adminSource, /admin_announcement_start/);
    assert.match(adminSource, /admin_announcement_confirm/);
    assert.match(adminSource, /admin_announcement_clear/);
    assert.match(repoSource, /UPDATE bot_announcements SET is_active = 0/);
    assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS bot_announcements/);
});

test('support proof approval cannot run twice', () => {
    const supportSource = fs.readFileSync(new URL('../src/commands/support.ts', import.meta.url), 'utf8');
    const repositorySource = fs.readFileSync(new URL('../src/repositories/supportRepository.ts', import.meta.url), 'utf8');

    assert.match(repositorySource, /WHERE id = \? AND status = "pending"/);
    assert.match(repositorySource, /changes/);
    assert.match(supportSource, /if \(!updated\)/);
    assert.match(supportSource, /تمت مراجعته سابقاً/);
});

test('callback middleware answers callback queries safely', () => {
    const source = fs.readFileSync(new URL('../src/bot/bot.ts', import.meta.url), 'utf8');
    assert.match(source, /ctx\.callbackQuery/);
    assert.match(source, /await answer\(\)\.catch\(\(\) => \{\}\)/);
    assert.match(source, /ctx\.answerCallbackQuery =/);
});

test('banned users are blocked before support proofs', () => {
    const botSource = fs.readFileSync(new URL('../src/bot/bot.ts', import.meta.url), 'utf8');
    const supportSource = fs.readFileSync(new URL('../src/commands/support.ts', import.meta.url), 'utf8');
    assert.match(botSource, /user\?\.is_banned/);
    assert.match(supportSource, /user\.is_banned\) return next\(\)/);
});

test('optional AI coach is disabled safely and uses provider fallback', () => {
    const routerSource = fs.readFileSync(new URL('../src/services/ai/aiRouter.ts', import.meta.url), 'utf8');
    const wranglerSource = fs.readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');

    assert.match(wranglerSource, /AI_ENABLED = "(true|false)"/);
    assert.match(routerSource, /env\.AI_ENABLED !== 'true'/);
    assert.match(routerSource, /AI_DISABLED/);
    assert.match(routerSource, /AI_UNAVAILABLE/);
    assert.match(routerSource, /geminiProvider/);
    assert.match(routerSource, /kimiProvider/);
    assert.match(routerSource, /grokProvider/);
    assert.match(routerSource, /for \(const provider of orderedProviders\(env\)\)/);
});

test('AI router checks cache before rate limits and caches successful JSON', () => {
    const routerSource = fs.readFileSync(new URL('../src/services/ai/aiRouter.ts', import.meta.url), 'utf8');
    const cacheSource = fs.readFileSync(new URL('../src/services/ai/aiCache.ts', import.meta.url), 'utf8');
    const usageSource = fs.readFileSync(new URL('../src/services/ai/aiUsage.ts', import.meta.url), 'utf8');
    const migrationSource = fs.readFileSync(new URL('../src/db/migrations/0014_ai_coach.sql', import.meta.url), 'utf8');

    assert.ok(routerSource.indexOf('getCachedAiResult') < routerSource.indexOf('canUseAiTask'));
    assert.match(routerSource, /setCachedAiResult/);
    assert.match(routerSource, /incrementAiUsage/);
    assert.match(cacheSource, /SHA-256/);
    assert.match(migrationSource, /UNIQUE\(task_type, input_hash\)/);
    assert.match(usageSource, /generate_example_and_pronunciation:\s*20/);
    assert.match(usageSource, /generate_pronunciation:\s*30/);
    assert.match(usageSource, /explain_answer:\s*30/);
    assert.match(usageSource, /classify_level:\s*30/);
});

test('AI prompts require strict JSON and Iraqi Arabic learning output', () => {
    const promptsSource = fs.readFileSync(new URL('../src/services/ai/prompts.ts', import.meta.url), 'utf8');

    assert.match(promptsSource, /رجّع JSON فقط/);
    assert.match(promptsSource, /الشرح يكون عربي عراقي بسيط/);
    assert.match(promptsSource, /"example_de"/);
    assert.match(promptsSource, /"pronunciation_ar"/);
    assert.match(promptsSource, /"short_explanation"/);
    assert.match(promptsSource, /"level"/);
});

test('AI coach saves word changes only after user confirmation', () => {
    const aiSource = fs.readFileSync(new URL('../src/commands/aiCoach.ts', import.meta.url), 'utf8');
    const panelSource = fs.readFileSync(new URL('../src/commands/wordPanel.ts', import.meta.url), 'utf8');
    const repoSource = fs.readFileSync(new URL('../src/repositories/wordRepository.ts', import.meta.url), 'utf8');

    assert.match(panelSource, /✨ تحسين بالذكاء الاصطناعي/);
    assert.match(panelSource, /🗣 توليد اللفظ/);
    assert.match(panelSource, /📊 تحديد المستوى/);
    assert.match(aiSource, /ai_save_suggestion_/);
    assert.match(aiSource, /ai_save_pron_/);
    assert.match(aiSource, /ai_save_level_/);
    assert.match(aiSource, /saveBotSession<AiWordSession>/);
    assert.match(repoSource, /updateWordAiFieldsForUser/);
});

test('AI payloads avoid Telegram identity and private user data', () => {
    const aiSource = fs.readFileSync(new URL('../src/commands/aiCoach.ts', import.meta.url), 'utf8');
    const runCalls = [...aiSource.matchAll(/runAiTask<[\s\S]*?\{ userId: [\s\S]*?\}/g)].map(match => match[0]).join('\n');

    assert.doesNotMatch(runCalls, /telegram_id|telegram_user_id|username|display_name|support_proof|payment|file_id/i);
    assert.match(runCalls, /german/);
    assert.match(runCalls, /arabic/);
    assert.match(runCalls, /correctAnswer/);
});

test('AI pronunciation is displayed in learn, notifications, and word detail', () => {
    const panelSource = fs.readFileSync(new URL('../src/commands/wordPanel.ts', import.meta.url), 'utf8');
    const learnSource = fs.readFileSync(new URL('../src/commands/learn.ts', import.meta.url), 'utf8');
    const notifSource = fs.readFileSync(new URL('../src/commands/smartNotifications.ts', import.meta.url), 'utf8');
    const smartServiceSource = fs.readFileSync(new URL('../src/services/smartNotificationService.ts', import.meta.url), 'utf8');

    assert.match(panelSource, /pronunciation_ar/);
    assert.match(learnSource, /pronunciation_ar/);
    assert.match(notifSource, /pronunciation_ar/);
    assert.match(smartServiceSource, /w\.pronunciation_ar/);
});

test('training wrong answer stores explain context and handles missing context', () => {
    const trainSource = fs.readFileSync(new URL('../src/commands/train.ts', import.meta.url), 'utf8');
    const aiSource = fs.readFileSync(new URL('../src/commands/aiCoach.ts', import.meta.url), 'utf8');

    assert.match(trainSource, /train_explain/);
    assert.match(trainSource, /correctAnswer/);
    assert.match(trainSource, /userAnswer/);
    assert.match(aiSource, /لا يوجد سؤال لشرحه حالياً/);
    assert.match(aiSource, /explain_answer/);
});

test('AI migration adds cache usage and word metadata columns', () => {
    const migrationSource = fs.readFileSync(new URL('../src/db/migrations/0014_ai_coach.sql', import.meta.url), 'utf8');
    const schemaSource = fs.readFileSync(new URL('../src/db/schema.sql', import.meta.url), 'utf8');

    assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS ai_cache/);
    assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS ai_usage/);
    assert.match(migrationSource, /ALTER TABLE words ADD COLUMN example_ar/);
    assert.match(migrationSource, /ALTER TABLE words ADD COLUMN pronunciation_ar/);
    assert.match(migrationSource, /ALTER TABLE words ADD COLUMN level/);
    assert.match(schemaSource, /example_ar TEXT DEFAULT NULL/);
    assert.match(schemaSource, /pronunciation_ar TEXT DEFAULT NULL/);
    assert.match(schemaSource, /level TEXT DEFAULT NULL/);
});

test('/ai_debug is admin-only and does not expose provider keys', () => {
    const aiSource = fs.readFileSync(new URL('../src/commands/aiCoach.ts', import.meta.url), 'utf8');
    const debugSource = fs.readFileSync(new URL('../src/services/ai/aiDebug.ts', import.meta.url), 'utf8');

    assert.match(aiSource, /bot\.command\('ai_debug'/);
    assert.match(aiSource, /isAdminTelegramId\(ctx\.env, ctx\.from\?\.id\)/);
    assert.match(aiSource, /غير مصرح لك باستخدام هذا الأمر/);
    assert.match(debugSource, /keys: \$\{provider\.keys\}/);
    assert.doesNotMatch(debugSource, /GEMINI_API_KEYS.*\+|KIMI_API_KEYS.*\+|GROK_API_KEYS.*\+/);
});

test('AI debug marks providers without keys as SKIPPED_NO_KEY', () => {
    const debugSource = fs.readFileSync(new URL('../src/services/ai/aiDebug.ts', import.meta.url), 'utf8');

    assert.match(debugSource, /hasProviderKey/);
    assert.match(debugSource, /raw_text_test_status: 'SKIPPED_NO_KEY'/);
    assert.match(debugSource, /json_test_status: 'SKIPPED_NO_KEY'/);
    assert.match(debugSource, /error_type: 'SKIPPED_NO_KEY'/);
    assert.match(debugSource, /gemini/);
    assert.match(debugSource, /kimi/);
    assert.match(debugSource, /grok/);
});

test('AI diagnostics classify bad JSON and 401 safely', () => {
    const routerSource = fs.readFileSync(new URL('../src/services/ai/aiRouter.ts', import.meta.url), 'utf8');
    const debugSource = fs.readFileSync(new URL('../src/services/ai/aiDebug.ts', import.meta.url), 'utf8');
    const providerSource = fs.readFileSync(new URL('../src/services/ai/providers/geminiProvider.ts', import.meta.url), 'utf8');
    const errorsSource = fs.readFileSync(new URL('../src/services/ai/aiErrors.ts', import.meta.url), 'utf8');

    assert.equal(classifyHttpStatus(401), 'AUTH');
    assert.equal(classifyHttpStatus(404), 'MODEL_NOT_FOUND');
    assert.equal(classifyHttpStatus(400), 'BAD_REQUEST');
    assert.equal(classifyHttpStatus(429), 'RATE_LIMIT');
    assert.match(debugSource, /error_type: 'BAD_JSON'/);
    assert.match(routerSource, /safeProviderWarn\(provider\.name, 'BAD_JSON'\)/);
    assert.match(providerSource, /classifyHttpStatus\(response\.status\)/);
    assert.match(errorsSource, /AI provider failed: provider=/);
});

test('AI providers use correct endpoints models and response extraction paths', () => {
    const geminiSource = fs.readFileSync(new URL('../src/services/ai/providers/geminiProvider.ts', import.meta.url), 'utf8');
    const kimiSource = fs.readFileSync(new URL('../src/services/ai/providers/kimiProvider.ts', import.meta.url), 'utf8');
    const grokSource = fs.readFileSync(new URL('../src/services/ai/providers/grokProvider.ts', import.meta.url), 'utf8');
    const debugSource = fs.readFileSync(new URL('../src/services/ai/aiDebug.ts', import.meta.url), 'utf8');

    assert.match(geminiSource, /generativelanguage\.googleapis\.com\/v1beta\/models\/\$\{model\}:generateContent/);
    assert.match(geminiSource, /gemini-2\.0-flash/);
    assert.match(geminiSource, /candidates\?\.\[0\]\?\.content\?\.parts/);
    assert.match(kimiSource, /https:\/\/api\.moonshot\.ai\/v1\/chat\/completions/);
    assert.match(grokSource, /https:\/\/api\.x\.ai\/v1\/chat\/completions/);
    assert.match(grokSource, /Authorization: `Bearer \$\{key\}`/);
    assert.match(grokSource, /role: 'system'/);
    assert.match(grokSource, /role: 'user', content: prompt/);
    assert.match(grokSource, /max_tokens: options\.maxTokens \?\? 300/);
    assert.match(kimiSource, /choices\?\.\[0\]\?\.message\?\.content/);
    assert.match(grokSource, /extractOpenAiCompatibleText/);
    assert.match(debugSource, /Reply with OK/);
    assert.match(debugSource, /raw_text_test_status/);
    assert.match(debugSource, /json_test_status/);
    assert.match(debugSource, /endpoint_type/);
});

test('AI router continues after provider errors and can return later provider success', () => {
    const routerSource = fs.readFileSync(new URL('../src/services/ai/aiRouter.ts', import.meta.url), 'utf8');
    const errorsSource = fs.readFileSync(new URL('../src/services/ai/aiErrors.ts', import.meta.url), 'utf8');

    assert.match(routerSource, /for \(const provider of orderedProviders\(env\)\)/);
    assert.match(routerSource, /if \(!response\.ok\)/);
    assert.match(routerSource, /continue;/);
    assert.match(routerSource, /return \{ status: 'ok', result, provider: provider\.name/);
    assert.match(routerSource, /return \{ status: 'AI_UNAVAILABLE' \}/);
    assert.match(errorsSource, /MODEL_NOT_FOUND/);
    assert.match(errorsSource, /BAD_REQUEST/);
    assert.match(errorsSource, /RATE_LIMIT/);
});

test('AI rate limit and Grok bad request diagnostics are safe', () => {
    const routerSource = fs.readFileSync(new URL('../src/services/ai/aiRouter.ts', import.meta.url), 'utf8');
    const grokSource = fs.readFileSync(new URL('../src/services/ai/providers/grokProvider.ts', import.meta.url), 'utf8');
    const debugSource = fs.readFileSync(new URL('../src/services/ai/aiDebug.ts', import.meta.url), 'utf8');
    const errorsSource = fs.readFileSync(new URL('../src/services/ai/aiErrors.ts', import.meta.url), 'utf8');
    const wranglerSource = fs.readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');

    assert.match(routerSource, /AI_PROVIDER_RATE_LIMITED/);
    assert.match(routerSource, /rateLimitedProviders\+\+/);
    assert.match(routerSource, /خدمة الذكاء الصناعي وصلت حد الاستخدام حالياً\. جرّب لاحقاً\./);
    assert.match(grokSource, /readSafeErrorMessage\(response\)/);
    assert.match(grokSource, /safeMessage/);
    assert.match(debugSource, /safe_message/);
    assert.match(errorsSource, /slice\(0, 200\)/);
    assert.match(errorsSource, /Bearer \[redacted\]/);
    assert.match(wranglerSource, /GROK_MODEL = "ضع هنا الموديل الصحيح من xAI console"/);
});
