import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { parseWordCsv } from '../dist/services/csvParser.js';
import { calculateNextReview } from '../dist/services/srs.js';
import { getLevelFromXp, getProgressToNextLevel } from '../dist/services/xpMath.js';
import { buildArasaacImageUrl, normalizeArasaacResults, searchEducationalPictograms } from '../dist/services/pictogramSearch.js';
import { getAdminTelegramIds, isAdminTelegramId } from '../dist/services/adminAccess.js';
import { classifyHttpStatus, sanitizeErrorMessage } from '../dist/services/ai/aiErrors.js';
import { exampleContainsGerman, hasSuspiciousPronunciation, validateExampleSuggestion } from '../dist/services/ai/aiValidation.js';
import { selectTrainingWords } from '../dist/services/srs.js';
import { calculateDifficultyScore, shouldBeHard } from '../dist/services/adaptiveReview.js';
import { buildYouglishDirectUrl } from '../dist/services/youglish.js';
import { normalizeArabicSearch, normalizeGermanSearch, rankWordSearchResults } from '../dist/services/wordSearch.js';

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
    const viewBlock = source.slice(source.indexOf("bot.callbackQuery(/^pictogram_view_"), source.indexOf("bot.callbackQuery(/^(?:pictogram_nav_"));
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

test('registration and old users are prompted for German level', () => {
    const startSource = fs.readFileSync(new URL('../src/commands/start.ts', import.meta.url), 'utf8');
    const menuSource = fs.readFileSync(new URL('../src/commands/menu.ts', import.meta.url), 'utf8');
    const settingsSource = fs.readFileSync(new URL('../src/commands/settings.ts', import.meta.url), 'utf8');
    const migrationSource = fs.readFileSync(new URL('../src/db/migrations/0015_simplified_ux_notifications_training_sources.sql', import.meta.url), 'utf8');

    assert.match(startSource, /showLevelSelection\(ctx, 'حدد مستواك:'\)/);
    assert.match(menuSource, /if \(!settings\?\.german_level\)/);
    assert.match(menuSource, /level_set_A1/);
    assert.match(menuSource, /level_set_A2/);
    assert.match(menuSource, /level_set_B1/);
    assert.match(settingsSource, /bot\.callbackQuery\(\/\^level_set_\(A1\|A2\|B1\)\$/);
    assert.match(settingsSource, /german_level: ctx\.match\[1\]/);
    assert.match(migrationSource, /german_level TEXT/);
});

test('notification settings support intervals and all-word review plans', () => {
    const settingsSource = fs.readFileSync(new URL('../src/commands/settings.ts', import.meta.url), 'utf8');
    const reviewPlanSource = fs.readFileSync(new URL('../src/repositories/reviewPlanRepository.ts', import.meta.url), 'utf8');
    const migrationSource = fs.readFileSync(new URL('../src/db/migrations/0015_simplified_ux_notifications_training_sources.sql', import.meta.url), 'utf8');

    assert.match(settingsSource, /notification_interval_1/);
    assert.match(settingsSource, /notification_interval_2/);
    assert.match(settingsSource, /notification_interval_3/);
    assert.match(settingsSource, /review_plan_all_words_day/);
    assert.match(settingsSource, /review_plan_all_words_week/);
    assert.match(settingsSource, /createDailyReviewPlan/);
    assert.match(reviewPlanSource, /planType === 'all_words_day' \? 1 : 7/);
    assert.match(reviewPlanSource, /batchSize: number = 10/);
    assert.match(migrationSource, /notification_interval_hours/);
    assert.match(migrationSource, /review_plan TEXT DEFAULT 'none'/);
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

test('main menu is simplified and advanced actions live under more', () => {
    const source = fs.readFileSync(new URL('../src/commands/menu.ts', import.meta.url), 'utf8');
    for (const label of ['📚 راجع الآن', '🏋️ تدريب', '📂 كلماتي', '⚙️ المزيد']) {
        assert.match(source, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    assert.match(source, /moreMenuKeyboard/);
    for (const label of ['👤 ملفي', '🏆 الصدارة', '⚔️ التحديات', '🔔 الإشعارات', '📚 المصادر', '💙 دعم المشروع', 'ℹ️ عن المشروع']) {
        assert.match(source, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    assert.match(source, /menu_main/);
});

test('about project page introduces developer and navigation', () => {
    const source = fs.readFileSync(new URL('../src/commands/menu.ts', import.meta.url), 'utf8');
    const aboutBlock = source.slice(source.indexOf("bot.callbackQuery('menu_about'"), source.indexOf("// Back to main menu"));

    assert.match(source, /bot\.callbackQuery\('menu_about'/);
    assert.match(aboutBlock, /await ctx\.answerCallbackQuery\(\)/);
    assert.match(source, /ℹ️ عن DeutschDrop/);
    assert.match(source, /بلال زامل/);
    assert.match(source, /جامعة الأنبار/);
    assert.match(source, /قسم علوم الحاسوب/);
    assert.match(source, /@bilalcodes1/);
    assert.match(source, /\.url\('📸 Instagram', 'https:\/\/instagram\.com\/bilalcodes1'\)/);
    assert.match(source, /\.url\('✈️ Telegram', 'https:\/\/t\.me\/bilalcodes1'\)/);
    assert.match(source, /\.text\('💙 دعم المشروع', 'menu_support'\)/);
    assert.match(source, /\.text\('⬅️ رجوع', 'menu_more'\)/);
    assert.match(source, /\.text\('🏠 الرئيسية', 'menu_main'\)/);
});

test('about project page shows generated project code line count without internal paths', () => {
    const menuSource = fs.readFileSync(new URL('../src/commands/menu.ts', import.meta.url), 'utf8');
    const generatedSource = fs.readFileSync(new URL('../src/generated/projectStats.ts', import.meta.url), 'utf8');
    const aboutTextBlock = menuSource.slice(menuSource.indexOf('function aboutProjectText'), menuSource.indexOf('function aboutProjectKeyboard'));

    assert.match(menuSource, /PROJECT_CODE_LINES_LABEL/);
    assert.match(aboutTextBlock, /🧾 حجم المشروع/);
    assert.match(aboutTextBlock, /يتكوّن DeutschDrop حالياً من حوالي \$\{PROJECT_CODE_LINES_LABEL\} سطر برمجي/);
    assert.match(generatedSource, /export const PROJECT_CODE_LINES = \d+;/);
    assert.match(generatedSource, /export const PROJECT_CODE_LINES_LABEL = "\d{1,3}(,\d{3})*";/);
    assert.doesNotMatch(aboutTextBlock, /src\/|scripts\/|migrations\/|wrangler\.toml|package\.json|tsconfig\.json|\.ts|\.sql/);
});

test('project stats generator includes bot files and ignores generated or dependency output', () => {
    const scriptSource = fs.readFileSync(new URL('../scripts/generateProjectStats.mjs', import.meta.url), 'utf8');
    const packageSource = fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8');

    assert.match(packageSource, /"generate:stats": "node scripts\/generateProjectStats\.mjs"/);
    for (const ignored of ["'node_modules'", "'.wrangler'", "'dist'", "'build'", "'coverage'"]) {
        assert.match(scriptSource, new RegExp(ignored.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    for (const lockFile of ["'package-lock.json'", "'pnpm-lock.yaml'", "'yarn.lock'"]) {
        assert.match(scriptSource, new RegExp(lockFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    assert.match(scriptSource, /normalized\.startsWith\('src\/'\)[\s\S]*codeExtensions\.has\(ext\)/);
    assert.match(scriptSource, /normalized\.startsWith\('scripts\/'\)[\s\S]*scriptExtensions\.has\(ext\)/);
    assert.match(scriptSource, /normalized\.startsWith\('migrations\/'\)[\s\S]*ext === '\.sql'/);
    assert.match(scriptSource, /configFiles/);
    assert.match(scriptSource, /src\/generated\/projectStats\.ts/);
});

test('onboarding appears after first level selection and only once', () => {
    const menuSource = fs.readFileSync(new URL('../src/commands/menu.ts', import.meta.url), 'utf8');
    const settingsSource = fs.readFileSync(new URL('../src/commands/settings.ts', import.meta.url), 'utf8');
    const userRepoSource = fs.readFileSync(new URL('../src/repositories/userRepository.ts', import.meta.url), 'utf8');
    const migrationSource = fs.readFileSync(new URL('../src/db/migrations/0024_onboarding_help_admin_health.sql', import.meta.url), 'utf8');

    assert.match(menuSource, /export async function showOnboarding/);
    for (const label of ['➕ أضف أول كلمة', '📤 رفع CSV', '📚 راجع الآن', '🏋️ تدريب', '🏠 الرئيسية']) {
        assert.match(menuSource, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    assert.match(settingsSource, /if \(!user\.onboarding_seen\)/);
    assert.match(settingsSource, /markOnboardingSeen\(ctx\.db, user\.user_id\)/);
    assert.match(settingsSource, /await showOnboarding\(ctx\)/);
    assert.match(userRepoSource, /export async function markOnboardingSeen/);
    assert.match(migrationSource, /ALTER TABLE users ADD COLUMN onboarding_seen INTEGER DEFAULT 0/);
    assert.match(migrationSource, /UPDATE users[\s\S]*german_level IS NOT NULL/);
});

test('help page is reachable from more menu with navigation buttons', () => {
    const source = fs.readFileSync(new URL('../src/commands/menu.ts', import.meta.url), 'utf8');
    const helpBlock = source.slice(source.indexOf("bot.callbackQuery('menu_help'"), source.indexOf("// Back to main menu"));

    assert.match(source, /❓ طريقة الاستخدام/);
    assert.match(source, /bot\.callbackQuery\('menu_help'/);
    assert.match(helpBlock, /await ctx\.answerCallbackQuery\(\)/);
    assert.match(source, /Haus = بيت/);
    assert.match(source, /German,Arabic,Example/);
    for (const callback of ['add_word', 'upload_csv', 'menu_learn', 'menu_train', 'menu_notifications', 'menu_support', 'menu_more', 'menu_main']) {
        assert.match(source, new RegExp(callback));
    }
});

test('admin health is admin-only and shows safe system sections', () => {
    const adminSource = fs.readFileSync(new URL('../src/commands/admin.ts', import.meta.url), 'utf8');

    assert.match(adminSource, /bot\.command\('admin_health'/);
    assert.match(adminSource, /bot\.callbackQuery\('admin_health'/);
    assert.match(adminSource, /await ctx\.answerCallbackQuery\(\)\.catch/);
    assert.match(adminSource, /if \(!await requireAdmin\(ctx\)\) return/);
    assert.match(adminSource, /🩺 صحة DeutschDrop/);
    for (const section of ['المستخدمون', 'الكلمات', 'التدريب والمراجعة', 'الإشعارات', 'TTS', 'AI', 'Database', 'Cron']) {
        assert.match(adminSource, new RegExp(section));
    }
    for (const label of ['🔄 تحديث', '🤖 AI Debug', '🔊 TTS Debug', '🧪 DB Check', '🏠 الرئيسية']) {
        assert.match(adminSource, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    assert.match(adminSource, /safeCount/);
    assert.match(adminSource, /غير متوفر/);
    assert.doesNotMatch(adminSource, /GEMINI_API_KEYS|VOICERSS_API_KEYS|GROK_API_KEYS|MISTRAL_API_KEYS|OPENROUTER_API_KEYS/);
});

test('core fallback errors keep users out of dead ends', () => {
    const wordPanelSource = fs.readFileSync(new URL('../src/commands/wordPanel.ts', import.meta.url), 'utf8');
    const addWordSource = fs.readFileSync(new URL('../src/commands/addword.ts', import.meta.url), 'utf8');
    const trainSource = fs.readFileSync(new URL('../src/commands/train.ts', import.meta.url), 'utf8');
    const ttsSource = fs.readFileSync(new URL('../src/commands/tts.ts', import.meta.url), 'utf8');
    const aiSource = fs.readFileSync(new URL('../src/commands/aiCoach.ts', import.meta.url), 'utf8');

    assert.match(wordPanelSource, /ما قدرت أفتح الكلمة حالياً/);
    assert.match(wordPanelSource, /قد تكون محذوفة أو غير متاحة/);
    assert.match(wordPanelSource, /wordOpenErrorKeyboard/);
    assert.match(wordPanelSource, /📂 كلماتي/);
    assert.match(addWordSource, /تعذر تحميل الكلمات حالياً/);
    assert.match(addWordSource, /🔄 إعادة المحاولة/);
    assert.match(trainSource, /تعذر بدء التدريب حالياً/);
    assert.match(trainSource, /تأكد أن عندك كلمات كافية/);
    assert.match(trainSource, /trainingStartErrorKeyboard/);
    assert.match(ttsSource, /answerCallbackQuery\(\{ text: message, show_alert: true \}/);
    assert.match(aiSource, /الذكاء الاصطناعي غير متاح حالياً|AI_ERROR_MESSAGES/);
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
    assert.match(addWordSource, /if \(page > 1\)/);
    assert.match(addWordSource, /if \(page < totalPages\)/);
    assert.match(addWordSource, /words:detail:\$\{word\.word_id\}:page:\$\{page\}/);
    assert.match(addWordSource, /words:detail:\$\{word\.word_id\}:search:\$\{page\}/);
});

test('word list handles invalid pages and DB errors with retry navigation', () => {
    const addWordSource = fs.readFileSync(new URL('../src/commands/addword.ts', import.meta.url), 'utf8');
    const repositorySource = fs.readFileSync(new URL('../src/repositories/wordRepository.ts', import.meta.url), 'utf8');

    assert.match(addWordSource, /list_words_retry/);
    assert.match(addWordSource, /parseSafePage/);
    assert.match(addWordSource, /normalizeRequestedPage/);
    assert.match(addWordSource, /Math\.min\(safeRequestedPage, totalPages\)/);
    assert.match(addWordSource, /catch \(error\)/);
    assert.match(addWordSource, /word_list_load_failed/);
    assert.match(addWordSource, /تعذر تحميل الكلمات حالياً/);
    assert.match(addWordSource, /🔄 إعادة المحاولة/);
    assert.match(addWordSource, /getWordsByUserPaginatedFallback/);
    assert.match(repositorySource, /LIMIT \? OFFSET \?/);
    assert.match(repositorySource, /WHERE added_by = \?/);
});

test('word search is scoped to current user and paginated', () => {
    const repositorySource = fs.readFileSync(new URL('../src/repositories/wordRepository.ts', import.meta.url), 'utf8');
    const addWordSource = fs.readFileSync(new URL('../src/commands/addword.ts', import.meta.url), 'utf8');

    assert.match(repositorySource, /export async function searchWordsByUser/);
    assert.match(repositorySource, /export async function countSearchWordsByUser/);
    assert.match(repositorySource, /WHERE added_by = \?/);
    assert.match(repositorySource, /german_search LIKE \?/);
    assert.match(repositorySource, /arabic_search LIKE \?/);
    assert.match(repositorySource, /example_search LIKE \?/);
    assert.match(addWordSource, /word_search_start/);
    assert.match(addWordSource, /word_search_page_/);
    assert.match(addWordSource, /اكتب جزءاً من الكلمة الألمانية أو العربية/);
});

test('word search normalization handles case German variants and Arabic variants', () => {
    assert.equal(normalizeGermanSearch(' Studentin! '), 'studentin');
    assert.equal(normalizeGermanSearch('Straße'), 'strasse');
    assert.equal(normalizeGermanSearch('möchte'), 'moechte');
    assert.equal(normalizeArabicSearch('أَلْطالبةـ'), 'الطالبه');
    assert.equal(normalizeArabicSearch('إلى المدرسة'), 'الي المدرسه');
});

test('word search ranking prefers exact before startsWith contains and examples', () => {
    const base = {
        example: null,
        example_ar: null,
        pronunciation_ar: null,
        pronunciation_latin: null,
        level: null,
        added_by: 1,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: null,
    };
    const results = rankWordSearchResults([
        { ...base, word_id: 1, german: 'Meine Studentin', arabic: 'طالبتي' },
        { ...base, word_id: 2, german: 'Studentin', arabic: 'الطالبة' },
        { ...base, word_id: 3, german: 'Haus', arabic: 'بيت', example: 'Die Studentin liest.' },
    ], 'studentin');

    assert.equal(results[0].word_id, 2);
    assert.equal(results[1].word_id, 1);
    assert.equal(results[2].word_id, 3);
});

test('word search repository uses normalized columns candidate limits and fallback', () => {
    const repositorySource = fs.readFileSync(new URL('../src/repositories/wordRepository.ts', import.meta.url), 'utf8');
    const migrationSource = fs.readFileSync(new URL('../src/db/migrations/0025_normalized_word_search.sql', import.meta.url), 'utf8');
    const schemaSource = fs.readFileSync(new URL('../src/db/schema.sql', import.meta.url), 'utf8');
    const adminSource = fs.readFileSync(new URL('../src/commands/admin.ts', import.meta.url), 'utf8');

    assert.match(repositorySource, /SEARCH_CANDIDATE_LIMIT = 200/);
    assert.match(repositorySource, /rankWordSearchResults\(candidates, query\)\.slice/);
    assert.match(repositorySource, /LOWER\(german\) LIKE LOWER\(\?\)/);
    assert.match(repositorySource, /catch \{\s*return queryAll<Word>/);
    for (const column of ['german_search', 'arabic_search', 'example_search']) {
        assert.match(migrationSource, new RegExp(`ALTER TABLE words ADD COLUMN ${column}`));
        assert.match(schemaSource, new RegExp(`${column} TEXT`));
        assert.match(adminSource, new RegExp(`'${column}'`));
    }
    assert.match(migrationSource, /idx_words_user_german_search ON words\(added_by, german_search\)/);
    assert.match(migrationSource, /idx_words_user_arabic_search ON words\(added_by, arabic_search\)/);
});

test('word creation edit CSV and AI updates maintain search columns', () => {
    const repositorySource = fs.readFileSync(new URL('../src/repositories/wordRepository.ts', import.meta.url), 'utf8');
    const uploadSource = fs.readFileSync(new URL('../src/commands/upload.ts', import.meta.url), 'utf8');
    const addWordSource = fs.readFileSync(new URL('../src/commands/addword.ts', import.meta.url), 'utf8');
    const aiSource = fs.readFileSync(new URL('../src/commands/aiCoach.ts', import.meta.url), 'utf8');

    assert.match(repositorySource, /buildWordSearchFields\(german, arabic, example\)/);
    assert.match(repositorySource, /INSERT INTO words \(german, arabic, example, added_by, german_search, arabic_search, example_search\)/);
    assert.match(repositorySource, /SET german = \?, arabic = \?, example = \?, german_search = \?, arabic_search = \?, example_search = \?/);
    assert.match(repositorySource, /example_search = \?/);
    assert.match(uploadSource, /createWordAndAssignToUser\(db, w\.german, w\.arabic, w\.example/);
    assert.match(addWordSource, /updateWordForUser\(ctx\.db, userId, wordId, parsed\.german, parsed\.arabic, parsed\.example\)/);
    assert.match(aiSource, /updateWordAiFieldsForUser/);
});

test('word search UI handles short no-result and search-detail navigation', () => {
    const addWordSource = fs.readFileSync(new URL('../src/commands/addword.ts', import.meta.url), 'utf8');

    assert.match(addWordSource, /اكتب حرفين أو أكثر للبحث/);
    assert.match(addWordSource, /لم أجد كلمة قريبة من بحثك/);
    assert.match(addWordSource, /جرّب جزءاً آخر من الكلمة/);
    assert.match(addWordSource, /🔍 بحث جديد/);
    assert.match(addWordSource, /📋 كل الكلمات/);
    assert.match(addWordSource, /words:detail:\$\{word\.word_id\}:search:\$\{page\}/);
    assert.match(addWordSource, /word_search_page_\$\{page - 1\}/);
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
    assert.match(source, /🔊 نطق/);
    assert.match(source, /tts:word:\$\{wordId\}:ctx:word_details/);
    assert.match(source, /🎬 YouGlish/);
    assert.match(source, /buildYouglishDirectUrl\(word\.german, 'german'\)/);
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

test('training and notification performance paths use candidate limits and safe loops', () => {
    const trainSource = fs.readFileSync(new URL('../src/commands/train.ts', import.meta.url), 'utf8');
    const wordRepoSource = fs.readFileSync(new URL('../src/repositories/wordRepository.ts', import.meta.url), 'utf8');
    const adminSource = fs.readFileSync(new URL('../src/commands/admin.ts', import.meta.url), 'utf8');
    const notificationSource = fs.readFileSync(new URL('../src/services/smartNotificationService.ts', import.meta.url), 'utf8');

    assert.match(trainSource, /getTrainingWordCandidates\(ctx\.db, user\.user_id, Math\.max\(100, count \* 6\)\)/);
    assert.match(wordRepoSource, /LIMIT \?/);
    assert.match(wordRepoSource, /RANDOM\(\)/);
    assert.match(adminSource, /for \(const user of users\)/);
    assert.match(adminSource, /try \{/);
    assert.match(notificationSource, /try \{/);
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

    for (const callback of ['select_words', 'bulk_select', 'manage_words_select', 'word_select', 'word_select_all', 'word_delete_selected', 'word_delete_all']) {
        assert.match(addWordSource, new RegExp(callback));
    }
    assert.match(addWordSource, /saveBotSession<WordSelectionSession>/);
    assert.match(addWordSource, /selected_word_ids: selectedIds/);
    assert.match(addWordSource, /mode: 'word_bulk_select'/);
    assert.match(addWordSource, /user_id: userId/);
    assert.match(addWordSource, /getWordsByUserPaginated\(ctx\.db, userId, WORDS_PAGE_SIZE/);
    assert.match(addWordSource, /⬅️ رجوع للعرض/);
    assert.match(wordSource, /deleteWordsForUser/);
    assert.match(wordSource, /deleteAllWordsForUser/);
    assert.match(wordSource, /deleteWordForUser\(db, userId, wordId\)/);
});

test('word detail callbacks preserve page context and verify ownership', () => {
    const addWordSource = fs.readFileSync(new URL('../src/commands/addword.ts', import.meta.url), 'utf8');
    const panelSource = fs.readFileSync(new URL('../src/commands/wordPanel.ts', import.meta.url), 'utf8');

    assert.match(addWordSource, /words:detail:/);
    assert.match(addWordSource, /returnMode === 'search'/);
    assert.match(addWordSource, /word_search_page_\$\{page - 1\}/);
    assert.match(addWordSource, /words:list:page:\$\{page\}/);
    assert.match(addWordSource, /word\.added_by !== user\.user_id/);
    assert.match(addWordSource, /word_callback_failed/);
    assert.match(panelSource, /backCallback = 'list_words'/);
    assert.match(panelSource, /wordDetailKeyboard\(word, Boolean\(pictogram\), backCallback\)/);
});

test('pictogram callbacks return to the same word detail screen', () => {
    const source = fs.readFileSync(new URL('../src/commands/pictograms.ts', import.meta.url), 'utf8');

    for (const callback of ['pictogram:view:', 'pictogram:change:', 'pictogram:next:', 'pictogram:prev:', 'pictogram:use:', 'pictogram:back:']) {
        assert.match(source, new RegExp(callback.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    assert.match(source, /showWordDetailPanel\(ctx, word\.word_id, '✅ تم حفظ الرمز\.'\)/);
    assert.match(source, /showCurrentLearnWord\(ctx, user\.user_id\)/);
    assert.match(source, /showCurrentTrainingQuestion\(ctx, user\.user_id\)/);
    assert.match(source, /:ctx:\$\{context\}/);
    assert.match(source, /word_callback_failed/);
});

test('Voice RSS German is the primary TTS path with Edge Worker fallback', () => {
    const commandSource = fs.readFileSync(new URL('../src/commands/tts.ts', import.meta.url), 'utf8');
    const voiceRssSource = fs.readFileSync(new URL('../src/services/tts/voiceRssGerman.ts', import.meta.url), 'utf8');
    const edgeWorkerSource = fs.readFileSync(new URL('../src/services/tts/edgeTtsWorker.ts', import.meta.url), 'utf8');
    const routerSource = fs.readFileSync(new URL('../src/services/tts/ttsRouter.ts', import.meta.url), 'utf8');
    const repoSource = fs.readFileSync(new URL('../src/repositories/wordAudioCacheRepository.ts', import.meta.url), 'utf8');
    const migrationSource = fs.readFileSync(new URL('../src/db/migrations/0020_word_audio_cache.sql', import.meta.url), 'utf8');
    const cacheMigrationSource = fs.readFileSync(new URL('../src/db/migrations/0021_tts_german_cache_and_locks.sql', import.meta.url), 'utf8');
    const formatMigrationSource = fs.readFileSync(new URL('../src/db/migrations/0022_tts_voice_rss_format.sql', import.meta.url), 'utf8');
    const wranglerSource = fs.readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');

    assert.match(wranglerSource, /TTS_PROVIDER_ORDER = "voiceRssGerman,edgeTtsWorker"/);
    assert.match(wranglerSource, /TTS_LANGUAGE = "de-de"/);
    assert.match(wranglerSource, /TTS_AUDIO_FORMAT = "mp3"/);
    assert.match(wranglerSource, /EDGE_TTS_VOICE = "de-DE-KatjaNeural"/);
    assert.doesNotMatch(wranglerSource, /CLOUDFLARE_TTS_MODEL|TTS_MODEL|googleTts|piperThorstenService/);
    assert.match(routerSource, /DEFAULT_TTS_PROVIDER_ORDER = \['voiceRssGerman', 'edgeTtsWorker'\]/);
    assert.match(voiceRssSource, /VOICE_RSS_GERMAN_PROVIDER = 'voiceRssGerman'/);
    assert.match(voiceRssSource, /https:\/\/api\.voicerss\.org\//);
    assert.match(voiceRssSource, /url\.searchParams\.set\('hl', language\)/);
    assert.match(voiceRssSource, /url\.searchParams\.set\('src', text\)/);
    assert.match(voiceRssSource, /url\.searchParams\.set\('v', voice\)/);
    assert.match(voiceRssSource, /url\.searchParams\.set\('c', 'mp3'\)/);
    assert.match(voiceRssSource, /VOICE_RSS_GERMAN_VOICE = 'Jonas'/);
    assert.match(voiceRssSource, /SKIPPED_NO_KEY/);
    assert.match(edgeWorkerSource, /EDGE_TTS_WORKER_URL/);
    assert.match(edgeWorkerSource, /\/api\/tts/);
    assert.match(edgeWorkerSource, /de-DE-KillianNeural/);
    assert.match(commandSource, /getCachedWordAudio/);
    assert.match(commandSource, /replyWithAudio\(cached\.telegram_file_id/);
    assert.match(commandSource, /upsertWordAudioFileId/);
    assert.match(commandSource, /acquireTtsRequestLock/);
    assert.match(commandSource, /releaseTtsRequestLock/);
    assert.match(commandSource, /synthesizeGermanTts/);
    assert.match(commandSource, /VOICE_RSS_DAILY_LIMIT_PER_KEY/);
    assert.match(commandSource, /apiKeyHash: result\.apiKeyHash/);
    assert.match(repoSource, /telegram_file_id IS NOT NULL/);
    assert.match(repoSource, /language = \? AND voice = \? AND model = \?/);
    assert.match(repoSource, /format = \?/);
    assert.match(repoSource, /api_key_hash/);
    assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS word_audio_cache/);
    assert.match(cacheMigrationSource, /ALTER TABLE word_audio_cache ADD COLUMN language/);
    assert.match(cacheMigrationSource, /CREATE TABLE IF NOT EXISTS tts_request_locks/);
    assert.match(formatMigrationSource, /ALTER TABLE word_audio_cache ADD COLUMN format/);
    assert.doesNotMatch(commandSource, /reply_markup/);
    assert.doesNotMatch(commandSource, /InlineKeyboard/);
    assert.doesNotMatch(`${commandSource}\n${voiceRssSource}\n${edgeWorkerSource}`, /generateCloudflareTts|piperThorstenService|googleTts|Google Cloud TTS|texttospeech\.googleapis|en-US|en-GB/i);
});

test('TTS debug and test are admin-only and hide secrets', () => {
    const commandSource = fs.readFileSync(new URL('../src/commands/tts.ts', import.meta.url), 'utf8');
    const voiceRssSource = fs.readFileSync(new URL('../src/services/tts/voiceRssGerman.ts', import.meta.url), 'utf8');
    const edgeWorkerSource = fs.readFileSync(new URL('../src/services/tts/edgeTtsWorker.ts', import.meta.url), 'utf8');

    assert.match(commandSource, /bot\.command\('tts_debug'/);
    assert.match(commandSource, /bot\.command\('tts_test'/);
    assert.match(commandSource, /isAdminTelegramId\(ctx\.env, ctx\.from\?\.id\)/);
    assert.match(commandSource, /keys configured: \$\{voiceRssStates\.length\}/);
    assert.match(commandSource, /estimated total daily generation: \$\{estimatedDailyTotal\}/);
    assert.match(commandSource, /Keys usage today:/);
    assert.doesNotMatch(commandSource, /VOICERSS_API_KEYS?\}/);
    assert.doesNotMatch(commandSource, /provider\.synthesize\(ctx\.env, 'Hallo'\)/);
    assert.match(voiceRssSource, /isGermanLanguage\(config\.language\)/);
    assert.match(voiceRssSource, /parseVoiceRssKeys/);
    assert.match(voiceRssSource, /VOICERSS_API_KEYS \|\| env\.VOICERSS_API_KEY/);
    assert.match(voiceRssSource, /VOICERSS_DISABLED_KEY_HASHES/);
    assert.match(edgeWorkerSource, /isGermanVoice\(config\.voice\)/);
    assert.match(edgeWorkerSource, /ALLOWED_EDGE_WORKER_VOICES\.has\(config\.voice\)/);
    assert.doesNotMatch(`${voiceRssSource}\n${edgeWorkerSource}`, /Hanna|Lina|en-US|en-GB|English/);
});

test('VoiceRSS multi-key rotation supports many keys safely', () => {
    const voiceRssSource = fs.readFileSync(new URL('../src/services/tts/voiceRssGerman.ts', import.meta.url), 'utf8');
    const commandSource = fs.readFileSync(new URL('../src/commands/tts.ts', import.meta.url), 'utf8');

    assert.match(voiceRssSource, /VOICE_RSS_DAILY_LIMIT_PER_KEY = 350/);
    assert.match(voiceRssSource, /DEBUG_VISIBLE_KEY_COUNT = 20/);
    assert.match(voiceRssSource, /env\.VOICERSS_API_KEYS \|\| env\.VOICERSS_API_KEY/);
    assert.match(voiceRssSource, /\.split\(','.*\)/s);
    assert.match(voiceRssSource, /hashVoiceRssKey/);
    assert.match(voiceRssSource, /getGeneratedAudioUsageTodayByKeyHash/);
    assert.match(voiceRssSource, /usedToday < VOICE_RSS_DAILY_LIMIT_PER_KEY/);
    assert.match(voiceRssSource, /\.sort\(\(a, b\) => a\.usedToday - b\.usedToday \|\| a\.index - b\.index\)/);
    assert.match(voiceRssSource, /url\.searchParams\.set\('v', voice\)/);
    assert.match(commandSource, /estimatedDailyTotal = voiceRssStates\.length \* VOICE_RSS_DAILY_LIMIT_PER_KEY/);
    assert.match(commandSource, /keys configured: \$\{voiceRssStates\.length\}/);
    assert.match(commandSource, /#\$\{state\.index\}: \$\{state\.usedToday\}\/\$\{state\.limit\} \$\{state\.status\}/);
    assert.match(commandSource, /hiddenCount > 0/);
    assert.doesNotMatch(voiceRssSource, /Hanna|Lina/);
});

test('TTS debug can show eight VoiceRSS keys and calculates total generation', () => {
    const commandSource = fs.readFileSync(new URL('../src/commands/tts.ts', import.meta.url), 'utf8');
    const voiceRssSource = fs.readFileSync(new URL('../src/services/tts/voiceRssGerman.ts', import.meta.url), 'utf8');

    const lines = Array.from({ length: 8 }, (_, index) => {
        const state = { index: index + 1, usedToday: 0, limit: 350, status: 'OK' };
        return `#${state.index}: ${state.usedToday}/${state.limit} ${state.status}`;
    });
    assert.equal(8 * 350, 2800);
    assert.equal(lines[0], '#1: 0/350 OK');
    assert.equal(lines[7], '#8: 0/350 OK');
    assert.match(voiceRssSource, /states\.slice\(0, DEBUG_VISIBLE_KEY_COUNT\)/);
    assert.doesNotMatch(commandSource, /slice\(0, 7\)|DEBUG_VISIBLE_KEY_COUNT = 7|firstDebugVoiceRssKeyStates/);
    assert.doesNotMatch(`${commandSource}\n${voiceRssSource}`, /VOICERSS_API_KEYS?\s*\}|key:\s*\$\{.*VOICERSS/);
});

test('VoiceRSS rotation skips disabled and exhausted keys', () => {
    const voiceRssSource = fs.readFileSync(new URL('../src/services/tts/voiceRssGerman.ts', import.meta.url), 'utf8');

    assert.match(voiceRssSource, /VOICERSS_DISABLED_KEY_HASHES/);
    assert.match(voiceRssSource, /disabled\.has\(keyHash\)/);
    assert.match(voiceRssSource, /status: disabled\.has\(keyHash\) \? 'DISABLED' : usedToday >= VOICE_RSS_DAILY_LIMIT_PER_KEY \? 'LIMIT' : 'OK'/);
    assert.match(voiceRssSource, /\.filter\(state => !state\.disabled && state\.usedToday < VOICE_RSS_DAILY_LIMIT_PER_KEY\)/);
    assert.match(voiceRssSource, /errorType: 'DAILY_LIMIT'/);
});

test('VoiceRSS debug and cache rules do not leak keys or count cached playback', () => {
    const commandSource = fs.readFileSync(new URL('../src/commands/tts.ts', import.meta.url), 'utf8');
    const voiceRssSource = fs.readFileSync(new URL('../src/services/tts/voiceRssGerman.ts', import.meta.url), 'utf8');
    const repoSource = fs.readFileSync(new URL('../src/repositories/wordAudioCacheRepository.ts', import.meta.url), 'utf8');
    const keyHashMigration = fs.readFileSync(new URL('../src/db/migrations/0023_voicerss_key_rotation.sql', import.meta.url), 'utf8');

    assert.match(commandSource, /replyWithAudio\(cached\.telegram_file_id/);
    assert.ok(commandSource.indexOf('getCachedWordAudio') < commandSource.indexOf('synthesizeGermanTts'));
    assert.match(commandSource, /النطق الألماني وصل حد الاستخدام اليومي حالياً\. جرّب لاحقاً\./);
    assert.match(voiceRssSource, /hashVoiceRssKey/);
    assert.match(voiceRssSource, /contentHash\(`voiceRssGerman:\$\{apiKey\}`\)/);
    assert.match(repoSource, /api_key_hash = \?/);
    assert.match(keyHashMigration, /ALTER TABLE word_audio_cache ADD COLUMN api_key_hash TEXT/);
    assert.doesNotMatch(commandSource, /VOICERSS_API_KEYS?\s*\}/);
    assert.doesNotMatch(`${commandSource}\n${voiceRssSource}`, /console\.warn\([^)]*VOICERSS_API_KEYS?|console\.log\([^)]*VOICERSS_API_KEYS?/);
});

test('TTS stale cache debug and cleanup use the same predicate', () => {
    const commandSource = fs.readFileSync(new URL('../src/commands/tts.ts', import.meta.url), 'utf8');

    assert.match(commandSource, /bot\.command\('tts_clear_stale_cache'/);
    assert.match(commandSource, /const VALID_TTS_CACHE_PREDICATE = `provider = '\$\{VOICE_RSS_GERMAN_PROVIDER\}' AND language = 'de-de' AND voice = '\$\{VOICE_RSS_GERMAN_VOICE\}'`/);
    assert.match(commandSource, /const STALE_TTS_CACHE_PREDICATE = `provider = 'cloudflareTts'/);
    assert.match(commandSource, /OR provider IS NULL/);
    assert.match(commandSource, /OR language IS NULL/);
    assert.match(commandSource, /OR voice IS NULL/);
    assert.match(commandSource, /OR provider != '\$\{VOICE_RSS_GERMAN_PROVIDER\}'/);
    assert.match(commandSource, /OR language != 'de-de'/);
    assert.match(commandSource, /OR voice != '\$\{VOICE_RSS_GERMAN_VOICE\}'/);
    assert.match(commandSource, /SUM\(CASE WHEN \$\{STALE_TTS_CACHE_PREDICATE\} THEN 1 ELSE 0 END\) AS stale_records/);
    assert.match(commandSource, /DELETE FROM word_audio_cache WHERE \$\{STALE_TTS_CACHE_PREDICATE\}/);
    assert.match(commandSource, /VoiceRSS Jonas records المتبقية/);
    assert.match(commandSource, /stale records المتبقية/);
    assert.doesNotMatch(commandSource, /stale cloudflare records/);
});

test('TTS stale predicate keeps only valid VoiceRSS de-de Jonas records', () => {
    const valid = { provider: 'voiceRssGerman', language: 'de-de', voice: 'Jonas' };
    const rows = [
        valid,
        { provider: 'cloudflareTts', language: 'de-de', voice: 'Jonas' },
        { provider: null, language: 'de-de', voice: 'Jonas' },
        { provider: 'voiceRssGerman', language: null, voice: 'Jonas' },
        { provider: 'voiceRssGerman', language: 'de-de', voice: null },
        { provider: 'edgeTtsWorker', language: 'de-de', voice: 'Jonas' },
        { provider: 'voiceRssGerman', language: 'de-DE', voice: 'Jonas' },
        { provider: 'voiceRssGerman', language: 'de-de', voice: 'Katja' },
    ];
    const stale = rows.filter(row => !(row.provider === 'voiceRssGerman' && row.language === 'de-de' && row.voice === 'Jonas'));
    assert.equal(stale.length, 7);
    assert.deepEqual(rows.filter(row => !stale.includes(row)), [valid]);
});

test('learn train notifications and hard words expose TTS without counting answers', () => {
    const learnSource = fs.readFileSync(new URL('../src/commands/learn.ts', import.meta.url), 'utf8');
    const trainSource = fs.readFileSync(new URL('../src/commands/train.ts', import.meta.url), 'utf8');
    const notifSource = fs.readFileSync(new URL('../src/commands/smartNotifications.ts', import.meta.url), 'utf8');
    const hardSource = fs.readFileSync(new URL('../src/commands/hardWords.ts', import.meta.url), 'utf8');
    const botSource = fs.readFileSync(new URL('../src/bot/bot.ts', import.meta.url), 'utf8');

    assert.match(botSource, /registerTtsCommand\(bot\)/);
    assert.match(learnSource, /tts:word:\$\{word\.word_id\}:ctx:learn_session/);
    assert.match(learnSource, /buildYouglishDirectUrl\(word\.german, 'german'\)/);
    assert.match(learnSource, /learn:back:/);
    assert.match(trainSource, /tts:word:\$\{q\.word_id\}:ctx:training_session/);
    assert.match(trainSource, /buildYouglishDirectUrl\(questionGerman, 'german'\)/);
    assert.match(trainSource, /tts:word:\$\{wordId\}:ctx:training_session/);
    assert.match(trainSource, /train:back:/);
    assert.match(notifSource, /tts:word:\$\{word\.word_id\}:ctx:notification_answer/);
    assert.match(notifSource, /buildYouglishDirectUrl\(word\.german, 'german'\)/);
    assert.match(hardSource, /tts:word:\$\{word\.word_id\}:ctx:hard_words/);
    assert.doesNotMatch(trainSource, /tts:word:[\s\S]{0,120}markQuestionAnswered/);
});

test('TTS pronunciation messages are temporary and replace the previous audio', () => {
    const commandSource = fs.readFileSync(new URL('../src/commands/tts.ts', import.meta.url), 'utf8');
    const repoSource = fs.readFileSync(new URL('../src/repositories/ttsLastMessageRepository.ts', import.meta.url), 'utf8');
    const cleanupSource = fs.readFileSync(new URL('../src/services/ttsMessageCleanup.ts', import.meta.url), 'utf8');
    const indexSource = fs.readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
    const schemaSource = fs.readFileSync(new URL('../src/db/schema.sql', import.meta.url), 'utf8');
    const migrationSource = fs.readFileSync(new URL('../src/db/migrations/0026_tts_last_messages.sql', import.meta.url), 'utf8');
    const wranglerSource = fs.readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
    const pronunciationFlow = commandSource.slice(
        commandSource.indexOf('async function sendWordPronunciation'),
        commandSource.indexOf('async function showTtsDebug')
    );

    assert.match(schemaSource, /CREATE TABLE IF NOT EXISTS tts_last_messages/);
    assert.match(migrationSource, /UNIQUE\(user_id, chat_id\)/);
    assert.match(migrationSource, /expires_at TEXT NOT NULL/);
    assert.match(repoSource, /DEFAULT_TTS_MESSAGE_TTL_SECONDS = 60/);
    assert.match(repoSource, /getLastTtsMessage/);
    assert.match(repoSource, /upsertLastTtsMessage/);
    assert.match(repoSource, /datetime\('now', '\+' \|\| \? \|\| ' seconds'\)/);
    assert.match(repoSource, /deleteLastTtsMessageRecord/);
    assert.match(commandSource, /deletePreviousTemporaryTtsMessage\(ctx, user\.user_id, chatId\)/);
    assert.match(commandSource, /ctx\.api\.deleteMessage\(previous\.chat_id, previous\.message_id\)\.catch\(\(\) => \{\}\)/);
    assert.match(commandSource, /trackTemporaryTtsMessage\(ctx, user\.user_id, chatId, word\.word_id, germanText, message\.message_id\)/);
    assert.match(commandSource, /replyWithAudio\(cached\.telegram_file_id/);
    assert.match(commandSource, /upsertWordAudioFileId/);
    assert.match(cleanupSource, /getExpiredTtsMessages/);
    assert.match(cleanupSource, /deleteMessage/);
    assert.match(cleanupSource, /deleteTtsLastMessageById/);
    assert.match(indexSource, /cleanupExpiredTtsMessages\(env\)/);
    assert.match(wranglerSource, /TTS_MESSAGE_TTL_SECONDS = "60"/);
    assert.doesNotMatch(commandSource, /replyWithAudio\([^)]*reply_markup/s);
    assert.doesNotMatch(pronunciationFlow, /sendMessage\([^)]*🔊|reply\([^)]*🔊/);
});

test('TTS temporary audio keeps screens and training state untouched', () => {
    const commandSource = fs.readFileSync(new URL('../src/commands/tts.ts', import.meta.url), 'utf8');

    assert.match(commandSource, /await ctx\.answerCallbackQuery\(\)\.catch\(\(\) => \{\}\)/);
    assert.match(commandSource, /show_alert: true/);
    assert.match(commandSource, /acquireTtsRequestLock/);
    assert.match(commandSource, /getCachedWordAudio[\s\S]*synthesizeGermanTts/);
    assert.doesNotMatch(commandSource, /showCurrentLearnWord|showCurrentTrainingQuestion|question_index|markQuestionAnswered|recordTrainingAnswer|handleTrainingTextAnswer/);
    assert.doesNotMatch(commandSource, /reply_markup|InlineKeyboard/);
});

test('YouGlish URLs encode German words and phrases', () => {
    assert.equal(
        buildYouglishDirectUrl('sprechen', 'german'),
        'https://youglish.com/pronounce/sprechen/german'
    );
    assert.equal(
        buildYouglishDirectUrl('richtig gut in Schuss', 'german'),
        'https://youglish.com/pronounce/richtig%20gut%20in%20Schuss/german'
    );
});

test('YouGlish is only an official URL button, not a WebApp callback', () => {
    const wordPanelSource = fs.readFileSync(new URL('../src/commands/wordPanel.ts', import.meta.url), 'utf8');
    const learnSource = fs.readFileSync(new URL('../src/commands/learn.ts', import.meta.url), 'utf8');
    const trainSource = fs.readFileSync(new URL('../src/commands/train.ts', import.meta.url), 'utf8');
    const botSource = fs.readFileSync(new URL('../src/bot/bot.ts', import.meta.url), 'utf8');
    const wranglerSource = fs.readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');

    assert.match(wordPanelSource, /\.url\('🎬 YouGlish', buildYouglishDirectUrl/);
    assert.match(learnSource, /\.url\('🎬 YouGlish', buildYouglishDirectUrl/);
    assert.match(trainSource, /\.url\('🎬 YouGlish', buildYouglishDirectUrl/);
    assert.doesNotMatch(botSource, /registerYouglishCommand/);
    assert.doesNotMatch(wranglerSource, /TELEGRAM_WEBAPP_URL/);
    assert.doesNotMatch(`${wordPanelSource}\n${learnSource}\n${trainSource}`, /youglish:/);
    assert.doesNotMatch(`${wordPanelSource}\n${learnSource}\n${trainSource}`, /webApp/);
});

test('YouGlish feature does not scrape or download videos', () => {
    const serviceSource = fs.readFileSync(new URL('../src/services/youglish.ts', import.meta.url), 'utf8');
    const indexSource = fs.readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
    const combined = `${indexSource}\n${serviceSource}`;

    assert.doesNotMatch(combined, /youtube-dl|yt-dlp|get_video_info|watch\?v=|sendVideo|replyWithVideo|iframe|embed|widget\.js|youglish-widget/i);
    assert.doesNotMatch(indexSource, /\/youglish/);
    assert.doesNotMatch(serviceSource, /fetch\(/);
});

test('smart notifications include retrieval practice types and cooldown rules', () => {
    const indexSource = fs.readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
    const serviceSource = fs.readFileSync(new URL('../src/services/smartNotificationService.ts', import.meta.url), 'utf8');
    const migrationSource = fs.readFileSync(new URL('../src/db/migrations/0013_smart_learning_notifications.sql', import.meta.url), 'utf8');
    const newMigrationSource = fs.readFileSync(new URL('../src/db/migrations/0015_simplified_ux_notifications_training_sources.sql', import.meta.url), 'utf8');

    assert.match(indexSource, /sendSmartNotification/);
    assert.match(serviceSource, /selectNotificationForUser/);
    assert.match(serviceSource, /quick_recall/);
    assert.match(serviceSource, /arabic_to_german/);
    assert.match(serviceSource, /missing_letters/);
    assert.match(serviceSource, /first_last_hint/);
    assert.match(serviceSource, /due_word/);
    assert.match(serviceSource, /hard_word/);
    assert.match(serviceSource, /context_example/);
    assert.match(serviceSource, /pictogram_recall/);
    assert.match(serviceSource, /daily_summary/);
    assert.match(serviceSource, /notification_interval_hours/);
    assert.match(serviceSource, /withinHours\(settings\.last_notification_at, intervalHours\)/);
    assert.match(serviceSource, /withinMinutes\(user\.updated_at, 30\)/);
    assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS notification_events/);
    assert.match(newMigrationSource, /daily_review_plans/);
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

test('notification messages are real word questions with answer and disable actions', () => {
    const commandSource = fs.readFileSync(new URL('../src/commands/smartNotifications.ts', import.meta.url), 'utf8');
    const serviceSource = fs.readFileSync(new URL('../src/services/smartNotificationService.ts', import.meta.url), 'utf8');

    assert.match(serviceSource, /🧠 اختبار 10 ثواني/);
    assert.match(serviceSource, /✍️ اكتبها بالألماني/);
    assert.match(serviceSource, /🧩 أكمل الكلمة/);
    assert.match(serviceSource, /✍️ تلميح كتابة/);
    assert.match(serviceSource, /👁 أظهر الجواب/);
    assert.match(serviceSource, /🔕 إيقاف الإشعارات/);
    assert.match(commandSource, /notif_disable/);
    assert.match(commandSource, /notification_mode: 'off'/);
    assert.match(commandSource, /Latin: \$\{word\.pronunciation_latin\}/);
    assert.match(commandSource, /عربي: \$\{word\.pronunciation_ar\}/);
});

test('notification intensity limits light normal intensive and disabled sends nothing', () => {
    const serviceSource = fs.readFileSync(new URL('../src/services/smartNotificationService.ts', import.meta.url), 'utf8');
    const settingsSource = fs.readFileSync(new URL('../src/commands/settings.ts', import.meta.url), 'utf8');

    assert.match(serviceSource, /settings\.reminders_enabled === 0/);
    assert.match(serviceSource, /mode === 'off'/);
    assert.match(serviceSource, /if \(intensity === 'light'\) return 1/);
    assert.match(serviceSource, /if \(intensity === 'intensive'\) return 3/);
    assert.match(serviceSource, /if \(intensity === 'custom'\) return 24/);
    assert.match(serviceSource, /return 2/);
    assert.match(settingsSource, /🔔 \*الإشعارات\*/);
    assert.match(settingsSource, /notification_mode_light/);
    assert.match(settingsSource, /notification_interval_2/);
    assert.match(settingsSource, /review_plan_all_words_day/);
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

test('daily review plan notification opens training sessions and tracks progress', () => {
    const serviceSource = fs.readFileSync(new URL('../src/services/smartNotificationService.ts', import.meta.url), 'utf8');
    const commandSource = fs.readFileSync(new URL('../src/commands/smartNotifications.ts', import.meta.url), 'utf8');
    const trainSource = fs.readFileSync(new URL('../src/commands/train.ts', import.meta.url), 'utf8');
    const reviewPlanSource = fs.readFileSync(new URL('../src/repositories/reviewPlanRepository.ts', import.meta.url), 'utf8');

    assert.match(serviceSource, /buildReviewPlanNotification/);
    assert.match(serviceSource, /جلسة مراجعة/);
    assert.match(serviceSource, /train_plan_\$\{plan\.id\}/);
    assert.match(commandSource, /review_plan_cancel/);
    assert.match(trainSource, /startReviewPlanTraining/);
    assert.match(trainSource, /incrementReviewPlanProgress/);
    assert.match(reviewPlanSource, /reviewed_words = MIN\(total_words, reviewed_words \+ \?\)/);
});

test('training supports typing missing-letter hint and mixed question types', () => {
    const trainSource = fs.readFileSync(new URL('../src/commands/train.ts', import.meta.url), 'utf8');

    assert.match(trainSource, /typing_de/);
    assert.match(trainSource, /typing_ar/);
    assert.match(trainSource, /missing_letters/);
    assert.match(trainSource, /first_last_hint/);
    assert.match(trainSource, /example_context/);
    assert.match(trainSource, /pictogram_recall/);
    assert.match(trainSource, /normalizeAnswer/);
    assert.match(trainSource, /handleTypedTrainingAnswer/);
    assert.match(trainSource, /train_quick/);
    assert.match(trainSource, /train_mixed/);
});

test('training selection returns unique words when enough candidates exist', () => {
    const words = Array.from({ length: 150 }, (_, index) => ({
        wordId: index + 1,
        status: index % 5 === 0 ? 'learning' : 'new',
        wrongCount: index % 7 === 0 ? 2 : 0,
        correctCount: index % 7 === 0 ? 0 : 1,
        nextReview: index % 11 === 0 ? '2000-01-01T00:00:00.000Z' : null,
    }));
    const selected = selectTrainingWords(words, 10, 'mixed');
    assert.equal(selected.length, 10);
    assert.equal(new Set(selected.map(word => word.wordId)).size, 10);
});

test('training selection changes order across new sessions and prioritizes due hard words', () => {
    const words = Array.from({ length: 40 }, (_, index) => ({
        wordId: index + 1,
        status: index < 5 ? 'learning' : index < 10 ? 'reviewing' : 'new',
        wrongCount: index < 5 ? 3 : 0,
        correctCount: index < 5 ? 0 : 1,
        nextReview: index >= 5 && index < 10 ? '2000-01-01T00:00:00.000Z' : null,
    }));
    const runs = new Set(Array.from({ length: 6 }, () => selectTrainingWords(words, 10, 'mixed').map(word => word.wordId).join(',')));
    assert.ok(runs.size > 1);
    assert.ok(selectTrainingWords(words, 5, 'hard').every(word => word.reason === 'hard' || word.reason === 'due' || word.reason === 'repeat'));
    assert.ok(selectTrainingWords(words, 5, 'review').some(word => word.reason === 'due'));
});

test('training session validation catches duplicate word ids unless forced by low vocabulary', () => {
    const trainSource = fs.readFileSync(new URL('../src/commands/train.ts', import.meta.url), 'utf8');

    assert.match(trainSource, /validateTrainingSessionQuestions/);
    assert.match(trainSource, /availableUniqueWords/);
    assert.match(trainSource, /question\.word_id/);
    assert.match(trainSource, /question\.question_index === undefined/);
    assert.match(trainSource, /!question\.answer\?\.trim\(\)/);
    assert.match(trainSource, /duplicates === 0 \|\| availableUniqueWords < session\.questions\.length/);
});

test('training score tracks answered correct wrong counts and duplicate answers', () => {
    const trainSource = fs.readFileSync(new URL('../src/commands/train.ts', import.meta.url), 'utf8');

    assert.match(trainSource, /answeredCount/);
    assert.match(trainSource, /wrongCount/);
    assert.match(trainSource, /answeredQuestionIndexes/);
    assert.match(trainSource, /isQuestionAnswered\(session\.data, current\.question_index\)/);
    assert.match(trainSource, /markQuestionAnswered\(session\.data, current, isCorrect\)/);
    assert.match(trainSource, /Math\.round\(\(correct \/ total\) \* 100\)/);
    assert.doesNotMatch(trainSource, /6\/10|60%/);
});

test('typed training local grading handles German case and Arabic punctuation safely', () => {
    const graderSource = fs.readFileSync(new URL('../src/services/trainingAnswerGrader.ts', import.meta.url), 'utf8');

    assert.match(graderSource, /toLocaleLowerCase\('de-DE'\)/);
    assert.match(graderSource, /replace\(\/ß\/g, 'ss'\)/);
    assert.match(graderSource, /replace\(\/\[\\u064B-\\u065F\\u0670\]\/g, ''\)/);
    assert.match(graderSource, /replace\(\/\[أإآٱ\]\/g, 'ا'\)/);
    assert.match(graderSource, /replace\(\/ى\/g, 'ي'\)/);
    assert.match(graderSource, /replace\(\/ة\/g, 'ه'\)/);
    assert.match(graderSource, /correctWithoutParentheses === user/);
    assert.match(graderSource, /isSingleArabicToken\(correct\) && isSingleArabicToken\(user\)/);
});

test('typed training uses AI grading only after uncertain local check', () => {
    const trainSource = fs.readFileSync(new URL('../src/commands/train.ts', import.meta.url), 'utf8');
    const graderSource = fs.readFileSync(new URL('../src/services/trainingAnswerGrader.ts', import.meta.url), 'utf8');
    const aiTypes = fs.readFileSync(new URL('../src/services/ai/aiTypes.ts', import.meta.url), 'utf8');
    const aiUsage = fs.readFileSync(new URL('../src/services/ai/aiUsage.ts', import.meta.url), 'utf8');
    const prompts = fs.readFileSync(new URL('../src/services/ai/prompts.ts', import.meta.url), 'utf8');

    assert.match(trainSource, /gradeTrainingAnswer/);
    assert.match(graderSource, /gradeTrainingAnswerLocal/);
    assert.match(graderSource, /if \(local !== 'uncertain'\)/);
    assert.match(graderSource, /runAiTask<AiGradeResult>/);
    assert.match(graderSource, /confidence.*>= 0\.75/s);
    assert.match(graderSource, /verdict === 'almost'/);
    assert.match(graderSource, /source: 'fallback'/);
    assert.match(aiTypes, /grade_training_answer/);
    assert.match(aiUsage, /grade_training_answer:\s*50/);
    assert.match(prompts, /قيّم جواب تدريب كتابي/);
    assert.match(prompts, /لا تكن صارماً في capital letters/);
});

test('training text answers have priority over stale word edit and support flows', () => {
    const trainSource = fs.readFileSync(new URL('../src/commands/train.ts', import.meta.url), 'utf8');
    const addWordSource = fs.readFileSync(new URL('../src/commands/addword.ts', import.meta.url), 'utf8');
    const supportSource = fs.readFileSync(new URL('../src/commands/support.ts', import.meta.url), 'utf8');
    const startSource = fs.readFileSync(new URL('../src/commands/start.ts', import.meta.url), 'utf8');

    assert.match(addWordSource, /getBotSession\(ctx\.db, user\.user_id, 'train'\)/);
    assert.match(addWordSource, /return next\(\)/);
    assert.match(addWordSource, /getBotSession\(ctx\.db, user\.user_id, 'challenge'\)/);
    assert.match(supportSource, /getBotSession\(ctx\.db, user\.user_id, 'train'\)/);
    assert.match(startSource, /getBotSession\(ctx\.db, user\.user_id, 'train'\)/);
    assert.match(trainSource, /if \(current\.options\.length > 0\)/);
    assert.match(trainSource, /استخدم أزرار الإجابة الحالية/);
    assert.match(trainSource, /handleTypedTrainingAnswer\(ctx, current, ctx\.message\.text\)/);
    assert.doesNotMatch(trainSource, /return next\(\);\n\s*await handleTypedTrainingAnswer/);
});

test('starting training clears stale edit add and search sessions', () => {
    const trainSource = fs.readFileSync(new URL('../src/commands/train.ts', import.meta.url), 'utf8');

    assert.match(trainSource, /clearConflictingTextSessions/);
    assert.match(trainSource, /deleteBotSession\(ctx\.db, userId, 'word_edit'\)/);
    assert.match(trainSource, /deleteBotSession\(ctx\.db, userId, 'add_word'\)/);
    assert.match(trainSource, /deleteBotSession\(ctx\.db, userId, 'word_search'\)/);
});

test('word edit uses a dedicated session and shows current word values', () => {
    const addWordSource = fs.readFileSync(new URL('../src/commands/addword.ts', import.meta.url), 'utf8');
    const sessionSource = fs.readFileSync(new URL('../src/repositories/sessionRepository.ts', import.meta.url), 'utf8');
    const migrationSource = fs.readFileSync(new URL('../src/db/migrations/0016_word_edit_session_priority.sql', import.meta.url), 'utf8');

    assert.match(sessionSource, /'word_edit'/);
    assert.match(migrationSource, /word_edit/);
    assert.match(addWordSource, /interface WordEditSessionData/);
    assert.match(addWordSource, /saveBotSession<WordEditSessionData>\(ctx\.db, userId, 'word_edit', \{ wordId \}/);
    assert.match(addWordSource, /formatEditWordPrompt/);
    assert.match(addWordSource, /الألماني الحالي: \$\{word\.german\}/);
    assert.match(addWordSource, /العربي الحالي: \$\{word\.arabic\}/);
    assert.match(addWordSource, /المثال الحالي: \$\{word\.example\}/);
    assert.match(addWordSource, /\$\{word\.german\} = \$\{word\.arabic\}/);
    assert.match(addWordSource, /\$\{word\.german\},\$\{word\.arabic\},\$\{word\.example\}/);
});

test('word edit updates the same word id and invalid input repeats current values', () => {
    const addWordSource = fs.readFileSync(new URL('../src/commands/addword.ts', import.meta.url), 'utf8');
    const repositorySource = fs.readFileSync(new URL('../src/repositories/wordRepository.ts', import.meta.url), 'utf8');

    assert.match(addWordSource, /handleWordEditText\(ctx, user\.user_id, editSession\.data\.wordId, text\)/);
    assert.match(addWordSource, /const word = await getWordById\(ctx\.db, wordId\)/);
    assert.match(addWordSource, /word\.added_by !== userId/);
    assert.match(addWordSource, /updateWordForUser\(ctx\.db, userId, wordId/);
    assert.match(addWordSource, /showWordDetailPanel\(ctx, wordId, '✅ تم تعديل الكلمة\.'\)/);
    assert.match(addWordSource, /showEditWordPrompt\(ctx, userId, wordId, 'الصيغة غير صحيحة/);
    assert.match(repositorySource, /WHERE word_id = \? AND added_by = \?/);
});

test('cancel edit and navigation clear word edit sessions', () => {
    const addWordSource = fs.readFileSync(new URL('../src/commands/addword.ts', import.meta.url), 'utf8');
    const menuSource = fs.readFileSync(new URL('../src/commands/menu.ts', import.meta.url), 'utf8');

    assert.match(addWordSource, /cancel_word_edit_/);
    assert.match(addWordSource, /deleteBotSession\(ctx\.db, user\.user_id, 'word_edit'\)/);
    assert.match(addWordSource, /word_detail_/);
    assert.match(menuSource, /clearTrainingAndEditSessions/);
    assert.match(menuSource, /deleteBotSession\(ctx\.db, user\.user_id, 'word_edit'\)/);
    assert.match(menuSource, /deleteBotSession\(ctx\.db, user\.user_id, 'train'\)/);
});

test('user-facing operations end with useful navigation buttons', () => {
    const addWordSource = fs.readFileSync(new URL('../src/commands/addword.ts', import.meta.url), 'utf8');
    const uploadSource = fs.readFileSync(new URL('../src/commands/upload.ts', import.meta.url), 'utf8');
    const trainSource = fs.readFileSync(new URL('../src/commands/train.ts', import.meta.url), 'utf8');
    const aiSource = fs.readFileSync(new URL('../src/commands/aiCoach.ts', import.meta.url), 'utf8');
    const settingsSource = fs.readFileSync(new URL('../src/commands/settings.ts', import.meta.url), 'utf8');

    assert.match(addWordSource, /wordAddedKeyboard/);
    assert.match(addWordSource, /➕ إضافة كلمة أخرى/);
    assert.match(addWordSource, /📂 كلماتي/);
    assert.match(uploadSource, /📚 راجع الآن/);
    assert.match(uploadSource, /🏋️ تدريب/);
    assert.match(uploadSource, /📂 عرض الكلمات/);
    assert.match(trainSource, /trainingFinishedKeyboard/);
    assert.match(trainSource, /🔁 تدريب جديد/);
    assert.match(trainSource, /🔥 درّب الكلمات الغلط/);
    assert.match(aiSource, /showWordDetailPanel\(ctx, wordId, 'تم حفظ اقتراح الذكاء الاصطناعي ✅'\)/);
    assert.match(aiSource, /showWordDetailPanel\(ctx, wordId\)/);
    assert.match(settingsSource, /showNotificationSettings/);
});

test('period leaderboards use xp_events and champion snapshots', () => {
    const xpSource = fs.readFileSync(new URL('../src/services/xpLevels.ts', import.meta.url), 'utf8');
    const leaderboardSource = fs.readFileSync(new URL('../src/commands/leaderboard.ts', import.meta.url), 'utf8');
    const indexSource = fs.readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
    const migrationSource = fs.readFileSync(new URL('../src/db/migrations/0015_simplified_ux_notifications_training_sources.sql', import.meta.url), 'utf8');

    assert.match(xpSource, /INSERT INTO xp_events/);
    assert.match(xpSource, /getLeaderboardByPeriod/);
    assert.match(xpSource, /date\(x\.created_at\) = date\('now'\)/);
    assert.match(leaderboardSource, /leaderboard_daily/);
    assert.match(leaderboardSource, /leaderboard_weekly/);
    assert.match(leaderboardSource, /leaderboard_monthly/);
    assert.match(indexSource, /runLeaderboardChampionNotifications/);
    assert.match(indexSource, /leaderboard_snapshots/);
    assert.match(indexSource, /leaderboard_notifications_enabled/);
    assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS xp_events/);
    assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS leaderboard_snapshots/);
});

test('learning sources display by level and admin-only management exists', () => {
    const sourceCommand = fs.readFileSync(new URL('../src/commands/sources.ts', import.meta.url), 'utf8');
    const repositorySource = fs.readFileSync(new URL('../src/repositories/sourceRepository.ts', import.meta.url), 'utf8');
    const adminSource = fs.readFileSync(new URL('../src/commands/admin.ts', import.meta.url), 'utf8');
    const botSource = fs.readFileSync(new URL('../src/bot/bot.ts', import.meta.url), 'utf8');
    const migrationSource = fs.readFileSync(new URL('../src/db/migrations/0015_simplified_ux_notifications_training_sources.sql', import.meta.url), 'utf8');

    assert.match(botSource, /registerSourcesCommand/);
    assert.match(sourceCommand, /menu_sources/);
    assert.match(sourceCommand, /sources_level_\(A1\|A2\|B1\)/);
    assert.match(sourceCommand, /requireSourceAdmin/);
    assert.match(sourceCommand, /isAdminTelegramId/);
    assert.match(adminSource, /admin_sources/);
    assert.match(repositorySource, /getLearningSourcesByLevel/);
    assert.match(repositorySource, /createLearningSource/);
    assert.match(repositorySource, /updateLearningSource/);
    assert.match(repositorySource, /disableLearningSource/);
    assert.match(sourceCommand, /admin_source_edit_/);
    assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS learning_sources/);
});

test('source add flow uses isolated step sessions and does not route into words', () => {
    const sourceCommand = fs.readFileSync(new URL('../src/commands/sources.ts', import.meta.url), 'utf8');
    const addWordSource = fs.readFileSync(new URL('../src/commands/addword.ts', import.meta.url), 'utf8');
    const botSource = fs.readFileSync(new URL('../src/bot/bot.ts', import.meta.url), 'utf8');
    const sourceRepo = fs.readFileSync(new URL('../src/repositories/sourceRepository.ts', import.meta.url), 'utf8');
    const migrationSource = fs.readFileSync(new URL('../src/db/migrations/0017_sources_admin_users_profile_challenges.sql', import.meta.url), 'utf8');

    assert.match(sourceCommand, /admin_source_add/);
    assert.match(sourceCommand, /admin_source_edit/);
    assert.match(sourceCommand, /step: 'title'/);
    assert.match(sourceCommand, /step = data\.step === 'edit_title' \? 'preview' : 'url'/);
    assert.match(sourceCommand, /admin_source_level_\(A1\|A2\|B1\|General\)/);
    assert.match(sourceCommand, /admin_source_skip_description/);
    assert.match(sourceCommand, /admin_source_save/);
    assert.match(sourceCommand, /createLearningSource/);
    assert.doesNotMatch(sourceCommand, /createWordAndAssignToUser|addXp/);
    assert.ok(botSource.indexOf('registerSourcesCommand(bot)') < botSource.indexOf('registerAddWordCommand(bot)'));
    assert.match(addWordSource, /'admin_source_add'/);
    assert.match(addWordSource, /'admin_source_edit'/);
    assert.match(addWordSource, /return next\(\)/);
    assert.match(sourceRepo, /level IN \(\?, 'General'\)/);
    assert.match(migrationSource, /level TEXT NOT NULL CHECK \(level IN \('A1', 'A2', 'B1', 'General'\)\)/);
});

test('source add description preview validation and navigation are explicit', () => {
    const sourceCommand = fs.readFileSync(new URL('../src/commands/sources.ts', import.meta.url), 'utf8');

    assert.match(sourceCommand, /step === 'description' \|\| data\.step === 'edit_description'/);
    assert.match(sourceCommand, /data\.step = 'preview'/);
    assert.match(sourceCommand, /formatSourcePreview\(data\)/);
    assert.match(sourceCommand, /تخطي الوصف/);
    assert.match(sourceCommand, /بدون وصف/);
    assert.match(sourceCommand, /الرابط غير صالح\. أرسل رابط يبدأ بـ https:\/\//);
    assert.match(sourceCommand, /isValidSourceTitle/);
    assert.match(sourceCommand, /isValidSourceUrl/);
    assert.match(sourceCommand, /sourceSavedKeyboard/);
    assert.match(sourceCommand, /➕ إضافة مصدر آخر/);
    assert.match(sourceCommand, /📚 عرض المصادر/);
    assert.match(sourceCommand, /🛠 لوحة الأدمن/);
    assert.match(sourceCommand, /sourceCancelledKeyboard/);
    assert.match(sourceCommand, /📚 إدارة المصادر/);
    assert.match(sourceCommand, /admin_source_edit_title/);
    assert.match(sourceCommand, /admin_source_edit_url/);
    assert.match(sourceCommand, /admin_source_edit_level/);
    assert.match(sourceCommand, /admin_source_edit_description/);
    assert.match(sourceCommand, /ctx\.answerCallbackQuery\(\)/);
    assert.doesNotMatch(sourceCommand, /parse_mode: 'Markdown', reply_markup: sourcePreviewKeyboard/);
});

test('profile rename is isolated from add-word and returns to profile', () => {
    const profileSource = fs.readFileSync(new URL('../src/commands/profile.ts', import.meta.url), 'utf8');
    const addWordSource = fs.readFileSync(new URL('../src/commands/addword.ts', import.meta.url), 'utf8');
    const sessionSource = fs.readFileSync(new URL('../src/repositories/sessionRepository.ts', import.meta.url), 'utf8');

    assert.match(profileSource, /✏️ تعديل الاسم/);
    assert.match(profileSource, /profile_rename_start/);
    assert.match(profileSource, /saveBotSession\(ctx\.db, user\.user_id, 'profile_rename'/);
    assert.match(profileSource, /sanitizeProfileName/);
    assert.match(profileSource, /https\?:/);
    assert.match(profileSource, /renameUser/);
    assert.match(profileSource, /showProfile\(ctx\)/);
    assert.match(addWordSource, /'profile_rename'/);
    assert.match(sessionSource, /profile_rename/);
});

test('admin users have pagination detail actions soft delete and audit logs', () => {
    const adminSource = fs.readFileSync(new URL('../src/commands/admin.ts', import.meta.url), 'utf8');
    const userRepo = fs.readFileSync(new URL('../src/repositories/userRepository.ts', import.meta.url), 'utf8');
    const migrationSource = fs.readFileSync(new URL('../src/db/migrations/0017_sources_admin_users_profile_challenges.sql', import.meta.url), 'utf8');

    assert.match(adminSource, /bot\.callbackQuery\(\/\^admin_user_/);
    assert.match(adminSource, /showAdminUserDetail/);
    assert.match(adminSource, /admin_user_confirm_reset_xp/);
    assert.match(adminSource, /admin_user_do_\(reset_xp\|reset_streak\|delete_words\|delete_user\)/);
    assert.match(adminSource, /canModerateTarget/);
    assert.match(adminSource, /target\.user_id === adminUserId/);
    assert.match(adminSource, /isAdminTelegramId\(ctx\.env, target\.telegram_user_id/);
    assert.match(adminSource, /deleteAllWordsForUser/);
    assert.match(adminSource, /activateSupporterForHours/);
    assert.match(adminSource, /admin_private_message/);
    assert.match(userRepo, /softDeleteUser/);
    assert.match(userRepo, /is_deleted = 1/);
    assert.match(userRepo, /logAdminAction/);
    assert.match(userRepo, /resetUserXp/);
    assert.match(userRepo, /resetUserStreak/);
    assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS admin_actions/);
});

test('deleted users re-register and active users drive challenges', () => {
    const userRepo = fs.readFileSync(new URL('../src/repositories/userRepository.ts', import.meta.url), 'utf8');
    const botSource = fs.readFileSync(new URL('../src/bot/bot.ts', import.meta.url), 'utf8');
    const challengeSource = fs.readFileSync(new URL('../src/commands/challenge.ts', import.meta.url), 'utf8');
    const challengeRepo = fs.readFileSync(new URL('../src/repositories/challengeRepository.ts', import.meta.url), 'utf8');

    assert.match(userRepo, /getUserByTelegramIdIncludingDeleted/);
    assert.match(userRepo, /existing\?\.is_deleted/);
    assert.match(userRepo, /is_deleted = 0/);
    assert.match(botSource, /updateUserLastActive/);
    assert.match(userRepo, /last_active_at >= datetime\('now', '-7 days'\)/);
    assert.match(userRepo, /COALESCE\(u\.is_banned, 0\) = 0/);
    assert.match(userRepo, /COALESCE\(u\.is_deleted, 0\) = 0/);
    assert.match(challengeSource, /تحدي جديد!/);
    assert.match(challengeSource, /▶️ حل التحدي/);
    assert.match(challengeSource, /hasOpenChallengeBetween/);
    assert.match(challengeRepo, /waiting_opponent/);
    assert.match(challengeRepo, /expired/);
    assert.doesNotMatch(challengeSource, /قبول|رفض|accepted|rejected|pending_acceptance/);
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
    const callbackSource = fs.readFileSync(new URL('../src/bot/callbacks.ts', import.meta.url), 'utf8');
    assert.match(source, /ctx\.callbackQuery/);
    assert.match(source, /safeAnswerCallback/);
    assert.match(source, /ctx\.answerCallbackQuery =/);
    assert.match(source, /showCallbackError/);
    assert.match(callbackSource, /safeCallback/);
    assert.match(callbackSource, /await ctx\.answerCallbackQuery\(\)\.catch\(\(\) => \{\}\)/);
    assert.match(callbackSource, /حدث خطأ بسيط/);
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
    assert.match(routerSource, /cloudflareAiProvider/);
    assert.match(routerSource, /geminiProvider/);
    assert.match(routerSource, /kimiProvider/);
    assert.match(routerSource, /groqCloudProvider/);
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

test('AI word improvement rejects unrelated examples and suspicious pronunciation', () => {
    assert.equal(validateExampleSuggestion({
        german: 'Auto',
        result: {
            example_de: 'Ich bin froh.',
            example_ar: 'أنا سعيد.',
            pronunciation_latin: 'ikh bin froh',
            pronunciation_ar: 'إخ بن فروه',
            level: 'A1',
        },
    }), false);

    assert.equal(validateExampleSuggestion({
        german: 'Auto',
        result: {
            example_de: 'Ich habe ein Auto.',
            example_ar: 'لدي سيارة.',
            pronunciation_latin: 'OW-toh',
            pronunciation_ar: 'آوتو',
            level: 'A1',
        },
    }), true);

    assert.equal(validateExampleSuggestion({
        german: 'richtig gut in Schuss',
        result: {
            example_de: 'Das Auto ist richtig gut in Schuss.',
            example_ar: 'السيارة بحالة جيدة جداً.',
            pronunciation_latin: 'RIKH-tikh goot in shoos',
            pronunciation_ar: 'رِشتِش گوت إِن شوس',
            level: 'B1',
        },
    }), true);

    assert.equal(hasSuspiciousPronunciation('Auto', 'إخ بن فروه'), true);
    assert.equal(exampleContainsGerman('Straße', 'Die Strasse ist lang.'), true);
});

test('AI word improvement validates cached provider results before display or save', () => {
    const routerSource = fs.readFileSync(new URL('../src/services/ai/aiRouter.ts', import.meta.url), 'utf8');
    const cacheSource = fs.readFileSync(new URL('../src/services/ai/aiCache.ts', import.meta.url), 'utf8');
    const aiSource = fs.readFileSync(new URL('../src/commands/aiCoach.ts', import.meta.url), 'utf8');
    const promptsSource = fs.readFileSync(new URL('../src/services/ai/prompts.ts', import.meta.url), 'utf8');
    const validationSource = fs.readFileSync(new URL('../src/services/ai/aiValidation.ts', import.meta.url), 'utf8');

    assert.match(promptsSource, /example_de يجب أن يحتوي german الأصلي/);
    assert.match(promptsSource, /pronunciation_latin يجب أن يكون لفظ german الأصلي فقط/);
    assert.match(promptsSource, /pronunciation_ar يجب أن يكون مبنياً صوتياً على pronunciation_latin/);
    assert.match(validationSource, /Math\.ceil\(tokens\.length \* 0\.6\)/);
    assert.match(validationSource, /hasSuspiciousPronunciation/);
    assert.match(routerSource, /options\.validateResult/);
    assert.match(routerSource, /deleteCachedAiResult/);
    assert.match(routerSource, /safeProviderWarn\('cache', 'BAD_RESPONSE'\)/);
    assert.match(routerSource, /safeProviderWarn\(provider\.name, 'BAD_RESPONSE'\)/);
    assert.match(cacheSource, /DELETE FROM ai_cache WHERE task_type = \? AND input_hash = \?/);
    assert.match(aiSource, /validateExampleSuggestion/);
    assert.match(aiSource, /currentWord\.german !== session\.data\.german/);
    assert.match(aiSource, /لم أستطع توليد اقتراح مناسب/);
});

test('AI payloads avoid Telegram identity and private user data', () => {
    const aiSource = fs.readFileSync(new URL('../src/commands/aiCoach.ts', import.meta.url), 'utf8');
    const runCalls = [...aiSource.matchAll(/runAiTask<[\s\S]*?\{ userId: [\s\S]*?\}/g)].map(match => match[0]).join('\n');

    assert.doesNotMatch(runCalls, /telegram_id|telegram_user_id|username|display_name|support_proof|payment|file_id/i);
    assert.match(runCalls, /german/);
    assert.match(runCalls, /arabic/);
    assert.match(aiSource, /correctAnswer/);
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
    assert.match(aiSource, /bot\.command\('ai_debug_full'/);
    assert.match(aiSource, /isAdminTelegramId\(ctx\.env, ctx\.from\?\.id\)/);
    assert.match(aiSource, /غير مصرح لك باستخدام هذا الأمر/);
    assert.match(aiSource, /buildAiDebugReport\(ctx\.env, \{ full: true \}\)/);
    assert.match(debugSource, /keys: \$\{provider\.keys\}/);
    assert.doesNotMatch(debugSource, /GEMINI_API_KEYS.*\+|KIMI_API_KEYS.*\+|GROK_API_KEYS.*\+/);
});

test('AI debug marks providers without keys as SKIPPED_NO_KEY', () => {
    const debugSource = fs.readFileSync(new URL('../src/services/ai/aiDebug.ts', import.meta.url), 'utf8');

    assert.match(debugSource, /hasProviderKey/);
    assert.match(debugSource, /SKIPPED_NO_KEY/);
    assert.match(debugSource, /SKIPPED_NO_BINDING/);
    assert.match(debugSource, /SKIPPED_NO_KEY/);
    assert.match(debugSource, /gemini/);
    assert.match(debugSource, /kimi/);
    assert.match(debugSource, /groqCloud/);
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
    const groqCloudSource = fs.readFileSync(new URL('../src/services/ai/providers/groqCloudProvider.ts', import.meta.url), 'utf8');
    const debugSource = fs.readFileSync(new URL('../src/services/ai/aiDebug.ts', import.meta.url), 'utf8');

    assert.match(geminiSource, /generativelanguage\.googleapis\.com\/v1beta\/models\/\$\{model\}:generateContent/);
    assert.match(geminiSource, /gemini-2\.0-flash/);
    assert.match(geminiSource, /candidates\?\.\[0\]\?\.content\?\.parts/);
    assert.match(kimiSource, /https:\/\/api\.moonshot\.ai\/v1\/chat\/completions/);
    assert.match(groqCloudSource, /https:\/\/api\.groq\.com\/openai\/v1\/chat\/completions/);
    assert.match(groqCloudSource, /Authorization: `Bearer \$\{key\}`/);
    assert.match(groqCloudSource, /role: 'system'/);
    assert.match(groqCloudSource, /role: 'user', content: prompt/);
    assert.match(groqCloudSource, /max_tokens: options\.maxTokens \?\? 300/);
    assert.match(kimiSource, /choices\?\.\[0\]\?\.message\?\.content/);
    assert.match(groqCloudSource, /extractOpenAiCompatibleText/);
    assert.match(debugSource, /Reply with OK/);
    assert.match(debugSource, /raw_text_test_status/);
    assert.match(debugSource, /json_test_status/);
    assert.match(debugSource, /endpoint_type/);
    assert.match(debugSource, /GroqCloud/);
    assert.match(debugSource, /groq_openai_compatible/);
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

test('AI rate limit and GroqCloud bad request diagnostics are safe', () => {
    const routerSource = fs.readFileSync(new URL('../src/services/ai/aiRouter.ts', import.meta.url), 'utf8');
    const groqCloudSource = fs.readFileSync(new URL('../src/services/ai/providers/groqCloudProvider.ts', import.meta.url), 'utf8');
    const debugSource = fs.readFileSync(new URL('../src/services/ai/aiDebug.ts', import.meta.url), 'utf8');
    const errorsSource = fs.readFileSync(new URL('../src/services/ai/aiErrors.ts', import.meta.url), 'utf8');
    const wranglerSource = fs.readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');

    assert.match(routerSource, /AI_RATE_LIMITED/);
    assert.match(routerSource, /rateLimitedProviders\+\+/);
    assert.match(routerSource, /خدمة الذكاء الصناعي وصلت حد الاستخدام حالياً\. جرّب لاحقاً\./);
    assert.match(groqCloudSource, /readSafeErrorMessage\(response\)/);
    assert.match(groqCloudSource, /safeMessage/);
    assert.match(debugSource, /safe_message/);
    assert.match(errorsSource, /slice\(0, 200\)/);
    assert.match(errorsSource, /Bearer \[redacted\]/);
    assert.match(wranglerSource, /AI_PROVIDER_ORDER = "cloudflareAi,groqCloud,mistral,openrouter,gemini"/);
    assert.match(wranglerSource, /GROK_MODEL = "llama-3\.1-8b-instant"/);
});

test('AI configuration uses GroqCloud endpoint only', () => {
    const routerSource = fs.readFileSync(new URL('../src/services/ai/aiRouter.ts', import.meta.url), 'utf8');
    const debugSource = fs.readFileSync(new URL('../src/services/ai/aiDebug.ts', import.meta.url), 'utf8');
    const groqCloudSource = fs.readFileSync(new URL('../src/services/ai/providers/groqCloudProvider.ts', import.meta.url), 'utf8');
    const kimiSource = fs.readFileSync(new URL('../src/services/ai/providers/kimiProvider.ts', import.meta.url), 'utf8');
    const allAiSource = routerSource + debugSource + groqCloudSource;

    assert.match(routerSource, /cloudflareAi,groqCloud,mistral,openrouter,gemini/);
    assert.match(routerSource, /name === 'groqCloud'/);
    assert.match(groqCloudSource, /api\.groq\.com\/openai\/v1\/chat\/completions/);
    assert.match(groqCloudSource, /extractOpenAiCompatibleText/);
    assert.match(kimiSource, /choices\?\.\[0\]\?\.message\?\.content/);
    assert.match(debugSource, /GroqCloud/);
    assert.doesNotMatch(allAiSource, /api\.x\.ai/);
});

test('Kimi rate limit debug skips second test and retries once', () => {
    const kimiSource = fs.readFileSync(new URL('../src/services/ai/providers/kimiProvider.ts', import.meta.url), 'utf8');
    const debugSource = fs.readFileSync(new URL('../src/services/ai/aiDebug.ts', import.meta.url), 'utf8');
    const utilsSource = fs.readFileSync(new URL('../src/services/ai/providers/providerUtils.ts', import.meta.url), 'utf8');

    assert.match(kimiSource, /https:\/\/api\.moonshot\.ai\/v1\/chat\/completions/);
    assert.match(kimiSource, /Authorization: `Bearer \$\{key\}`/);
    assert.match(kimiSource, /role: 'system'/);
    assert.match(kimiSource, /role: 'user', content: prompt/);
    assert.match(kimiSource, /max_tokens: maxTokens \?\? 300/);
    assert.match(kimiSource, /if \(response\.status === 429\)/);
    assert.equal((kimiSource.match(/requestKimi\(key, model, prompt, options\.maxTokens\)/g) ?? []).length, 2);
    assert.match(debugSource, /SKIPPED_AFTER_RATE_LIMIT/);
    assert.match(debugSource, /raw\.errorType === 'RATE_LIMIT'/);
    assert.match(utilsSource, /timeoutMs = 10000/);
});

test('AI router starts with Cloudflare AI and keeps Kimi out of current order', () => {
    const routerSource = fs.readFileSync(new URL('../src/services/ai/aiRouter.ts', import.meta.url), 'utf8');
    const wranglerSource = fs.readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');

    assert.match(wranglerSource, /AI_PROVIDER_ORDER = "cloudflareAi,groqCloud,mistral,openrouter,gemini"/);
    assert.doesNotMatch(wranglerSource.match(/AI_PROVIDER_ORDER = "([^"]+)"/)?.[1] ?? '', /kimi/);
    assert.doesNotMatch(wranglerSource.match(/AI_PROVIDER_ORDER = "([^"]+)"/)?.[1] ?? '', /cohere/);
    assert.doesNotMatch(wranglerSource.match(/AI_PROVIDER_ORDER = "([^"]+)"/)?.[1] ?? '', /zai/);
    assert.match(routerSource, /cloudflareAi: cloudflareAiProvider/);
    assert.match(routerSource, /groqCloud: groqCloudProvider/);
    assert.match(routerSource, /return \{ status: 'ok', result, provider: provider\.name/);
    assert.ok(routerSource.indexOf("return { status: 'ok', result, provider: provider.name") < routerSource.indexOf("return { status: 'AI_UNAVAILABLE' }"));
});

test('Cloudflare AI provider uses Workers AI binding without API keys', () => {
    const providerSource = fs.readFileSync(new URL('../src/services/ai/providers/cloudflareAiProvider.ts', import.meta.url), 'utf8');
    const routerSource = fs.readFileSync(new URL('../src/services/ai/aiRouter.ts', import.meta.url), 'utf8');
    const debugSource = fs.readFileSync(new URL('../src/services/ai/aiDebug.ts', import.meta.url), 'utf8');
    const modelsSource = fs.readFileSync(new URL('../src/models/index.ts', import.meta.url), 'utf8');
    const wranglerSource = fs.readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');

    assert.match(providerSource, /env\.AI\.run\(model/);
    assert.match(providerSource, /extractCloudflareAiText/);
    assert.match(providerSource, /@cf\/meta\/llama-3\.1-8b-instruct/);
    assert.match(routerSource, /if \(providerName === 'cloudflareAi'\) return Boolean\(env\.AI\?\.run\)/);
    assert.match(debugSource, /keys: provider\.name === 'cloudflareAi' \? 'not required'/);
    assert.match(debugSource, /Cloudflare AI/);
    assert.match(debugSource, /cloudflare_workers_ai/);
    assert.match(modelsSource, /AI\?: \{ run\(model: string, input: unknown\): Promise<unknown> \}/);
    assert.match(wranglerSource, /\[ai\]\s+binding = "AI"/);
    assert.match(wranglerSource, /CLOUDFLARE_AI_MODEL = "@cf\/meta\/llama-3\.1-8b-instruct"/);
});

test('Cloudflare AI fallback order keeps GroqCloud available after bad JSON', () => {
    const routerSource = fs.readFileSync(new URL('../src/services/ai/aiRouter.ts', import.meta.url), 'utf8');
    const debugSource = fs.readFileSync(new URL('../src/services/ai/aiDebug.ts', import.meta.url), 'utf8');

    assert.match(routerSource, /safeProviderWarn\(provider\.name, 'BAD_JSON'\)/);
    assert.match(routerSource, /continue;/);
    assert.ok(routerSource.indexOf('cloudflareAi,groqCloud,mistral,openrouter,gemini') >= 0);
    assert.match(debugSource, /cloudflareAi/);
    assert.match(debugSource, /groqCloud/);
});

test('new AI providers use the requested endpoints and models', () => {
    const openRouterSource = fs.readFileSync(new URL('../src/services/ai/providers/openRouterProvider.ts', import.meta.url), 'utf8');
    const zaiSource = fs.readFileSync(new URL('../src/services/ai/providers/zaiProvider.ts', import.meta.url), 'utf8');
    const mistralSource = fs.readFileSync(new URL('../src/services/ai/providers/mistralProvider.ts', import.meta.url), 'utf8');
    const cohereSource = fs.readFileSync(new URL('../src/services/ai/providers/cohereProvider.ts', import.meta.url), 'utf8');
    const wranglerSource = fs.readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');

    assert.match(openRouterSource, /https:\/\/openrouter\.ai\/api\/v1\/chat\/completions/);
    assert.match(openRouterSource, /HTTP-Referer/);
    assert.match(openRouterSource, /X-Title/);
    assert.match(openRouterSource, /openrouter\/free/);
    assert.match(zaiSource, /https:\/\/api\.z\.ai\/api\/paas\/v4\/chat\/completions/);
    assert.match(zaiSource, /env\.ZAI_BASE_URL/);
    assert.match(zaiSource, /glm-4\.5-air/);
    assert.match(mistralSource, /https:\/\/api\.mistral\.ai\/v1\/chat\/completions/);
    assert.match(mistralSource, /mistral-small-latest/);
    assert.match(cohereSource, /https:\/\/api\.cohere\.com\/v2\/chat/);
    assert.match(cohereSource, /command-r7b-12-2024/);
    assert.match(wranglerSource, /OPENROUTER_MODEL = "openrouter\/free"/);
    assert.match(wranglerSource, /ZAI_MODEL = "glm-4\.5-air"/);
    assert.match(wranglerSource, /MISTRAL_MODEL = "mistral-small-latest"/);
    assert.match(wranglerSource, /COHERE_MODEL = "command-r7b-12-2024"/);
});

test('new AI providers extract text safely from their response structures', () => {
    const openRouterSource = fs.readFileSync(new URL('../src/services/ai/providers/openRouterProvider.ts', import.meta.url), 'utf8');
    const zaiSource = fs.readFileSync(new URL('../src/services/ai/providers/zaiProvider.ts', import.meta.url), 'utf8');
    const mistralSource = fs.readFileSync(new URL('../src/services/ai/providers/mistralProvider.ts', import.meta.url), 'utf8');
    const cohereSource = fs.readFileSync(new URL('../src/services/ai/providers/cohereProvider.ts', import.meta.url), 'utf8');
    const kimiSource = fs.readFileSync(new URL('../src/services/ai/providers/kimiProvider.ts', import.meta.url), 'utf8');

    assert.match(openRouterSource, /extractOpenAiCompatibleText/);
    assert.match(zaiSource, /extractOpenAiCompatibleText/);
    assert.match(mistralSource, /extractOpenAiCompatibleText/);
    assert.match(kimiSource, /choices\?\.\[0\]\?\.message\?\.content/);
    assert.match(cohereSource, /message\?: \{ content\?: string \| Array/);
    assert.match(cohereSource, /value\.message\.content\.map/);
    assert.match(cohereSource, /BAD_RESPONSE/);
});

test('AI router and debug include the expanded provider order without Kimi', () => {
    const routerSource = fs.readFileSync(new URL('../src/services/ai/aiRouter.ts', import.meta.url), 'utf8');
    const debugSource = fs.readFileSync(new URL('../src/services/ai/aiDebug.ts', import.meta.url), 'utf8');
    const wranglerSource = fs.readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
    const providerOrder = wranglerSource.match(/AI_PROVIDER_ORDER = "([^"]+)"/)?.[1] ?? '';

    assert.equal(providerOrder, 'cloudflareAi,groqCloud,mistral,openrouter,gemini');
    assert.doesNotMatch(providerOrder, /kimi/);
    assert.doesNotMatch(providerOrder, /cohere/);
    assert.doesNotMatch(providerOrder, /zai/);
    assert.match(routerSource, /openrouter: openRouterProvider/);
    assert.match(routerSource, /zai: zaiProvider/);
    assert.match(routerSource, /mistral: mistralProvider/);
    assert.match(routerSource, /cohere: cohereProvider/);
    assert.match(debugSource, /Active providers/);
    assert.match(debugSource, /Configured but inactive providers/);
    assert.match(debugSource, /options\.full \? allDebugProviders\(env\) : activeDebugProviders\(env\)/);
    assert.match(debugSource, /inactiveDebugProviders\(env, activeNames\)/);
    assert.match(debugSource, /OpenRouter/);
    assert.match(debugSource, /Z\.ai/);
    assert.match(debugSource, /Mistral/);
    assert.match(debugSource, /Cohere/);
    assert.match(debugSource, /openrouter_chat_completions/);
    assert.match(debugSource, /zai_chat_completions/);
    assert.match(debugSource, /mistral_chat_completions/);
    assert.match(debugSource, /cohere_chat_v2/);
});

test('safe AI error messages redact known secret patterns', () => {
    assert.doesNotMatch(sanitizeErrorMessage('bad gsk_abcdefghijklmnopqrstuvwxyz123456'), /gsk_/);
    assert.doesNotMatch(sanitizeErrorMessage('bad sk-abcdefghijklmnopqrstuvwxyz123456'), /sk-/);
    assert.doesNotMatch(sanitizeErrorMessage('bad AIzaabcdefghijklmnopqrstuvwxyz123456'), /AIza/);
    assert.doesNotMatch(sanitizeErrorMessage('bad <ak-abcdefghijklmnopqrstuvwxyz123456>'), /ak-/);
    assert.match(sanitizeErrorMessage('bad <ak-abcdefghijklmnopqrstuvwxyz123456>'), /<redacted>/);
});

test('quality migration adds pronunciation latin adaptive stats and notification metadata', () => {
    const migrationSource = fs.readFileSync(new URL('../src/db/migrations/0019_quality_training_notifications_wordlist_ai.sql', import.meta.url), 'utf8');
    const schemaSource = fs.readFileSync(new URL('../src/db/schema.sql', import.meta.url), 'utf8');

    assert.match(migrationSource, /ALTER TABLE words ADD COLUMN pronunciation_latin/);
    assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS word_learning_stats/);
    assert.match(migrationSource, /UNIQUE\(user_id, word_id\)/);
    assert.match(migrationSource, /ALTER TABLE notification_events ADD COLUMN prompt_type/);
    assert.match(migrationSource, /idx_word_learning_stats_user_hard/);
    assert.match(migrationSource, /idx_notification_events_user_word_created/);
    assert.match(schemaSource, /pronunciation_latin TEXT DEFAULT NULL/);
    assert.match(schemaSource, /prompt_type TEXT/);
    assert.match(schemaSource, /selected_reason TEXT/);
    assert.match(schemaSource, /question_type TEXT/);
});

test('adaptive review marks hard words and weights typing mistakes more heavily', () => {
    const multipleChoiceWrong = calculateDifficultyScore({
        seenCount: 4,
        correctCount: 1,
        wrongCount: 3,
        lapseCount: 1,
        consecutiveWrong: 1,
        questionType: 'multiple_choice',
        previous: 0.2,
        isCorrect: false,
        sourceImpact: 1,
    });
    const typingWrong = calculateDifficultyScore({
        seenCount: 4,
        correctCount: 1,
        wrongCount: 3,
        lapseCount: 1,
        consecutiveWrong: 1,
        questionType: 'typing_de',
        previous: 0.2,
        isCorrect: false,
        sourceImpact: 1,
    });

    assert.ok(typingWrong > multipleChoiceWrong);
    assert.equal(shouldBeHard({ wrongCount: 3, lapseCount: 0, consecutiveWrong: 0, consecutiveCorrect: 0, difficultyScore: 0.2 }), true);
    assert.equal(shouldBeHard({ wrongCount: 3, lapseCount: 0, consecutiveWrong: 0, consecutiveCorrect: 4, difficultyScore: 0.2 }), false);
});

test('word list db check and fallback query are wired safely', () => {
    const adminSource = fs.readFileSync(new URL('../src/commands/admin.ts', import.meta.url), 'utf8');
    const addWordSource = fs.readFileSync(new URL('../src/commands/addword.ts', import.meta.url), 'utf8');
    const repositorySource = fs.readFileSync(new URL('../src/repositories/wordRepository.ts', import.meta.url), 'utf8');

    assert.match(adminSource, /admin_db_check/);
    assert.match(adminSource, /PRAGMA table_info\(words\)/);
    assert.match(adminSource, /missing column: words\.\$\{column\}/);
    assert.match(addWordSource, /words:list\|words_list\|word_list\|manage_words:list/);
    assert.match(addWordSource, /words:page:/);
    assert.match(addWordSource, /wordListErrorKeyboard\(Boolean\(isAdmin\)\)/);
    assert.match(repositorySource, /WORD_SELECT_COLUMNS_SAFE/);
    assert.doesNotMatch(adminSource, /SELECT \* FROM users/);
});

test('AI explanation and pronunciation quality validation are wired', () => {
    const aiSource = fs.readFileSync(new URL('../src/commands/aiCoach.ts', import.meta.url), 'utf8');
    const promptsSource = fs.readFileSync(new URL('../src/services/ai/prompts.ts', import.meta.url), 'utf8');
    const validationSource = fs.readFileSync(new URL('../src/services/ai/aiValidation.ts', import.meta.url), 'utf8');

    assert.match(promptsSource, /pronunciation_latin/);
    assert.match(promptsSource, /Stille Nacht/);
    assert.match(validationSource, /validateAiExplanation/);
    assert.match(validationSource, /pronunciationArabicMismatchesLatin/);
    assert.match(aiSource, /validateAiExplanation/);
    assert.match(aiSource, /الجواب الصحيح هو:/);
    assert.match(aiSource, /Latin: \$\{result\.pronunciation_latin\}/);
    assert.match(aiSource, /pronunciation_latin: result\.pronunciation_latin/);
});

test('notifications use adaptive-style word selection metadata without AI selection', () => {
    const serviceSource = fs.readFileSync(new URL('../src/services/smartNotificationService.ts', import.meta.url), 'utf8');
    const commandSource = fs.readFileSync(new URL('../src/commands/smartNotifications.ts', import.meta.url), 'utf8');

    assert.match(serviceSource, /export async function selectNotificationWord/);
    assert.match(serviceSource, /selectRecentWrongWord/);
    assert.match(serviceSource, /word_learning_stats/);
    assert.match(serviceSource, /selected_reason/);
    assert.match(serviceSource, /question_type/);
    assert.match(serviceSource, /inferSelectedReason/);
    assert.match(commandSource, /updateWordLearningAfterAnswer/);
    assert.doesNotMatch(serviceSource, /runAiTask/);
});
