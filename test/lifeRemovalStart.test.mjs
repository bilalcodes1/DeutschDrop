import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import Database from 'better-sqlite3';
import { persistentStartKeyboard } from '../dist/bot/startKeyboard.js';

const root = new URL('../', import.meta.url);

function readProjectFile(path) {
    return fs.readFileSync(new URL(path, root), 'utf8');
}

function projectFileExists(path) {
    return fs.existsSync(new URL(path, root));
}

function listMigrationFiles() {
    return fs.readdirSync(new URL('src/db/migrations/', root))
        .filter((file) => file.endsWith('.sql'))
        .sort();
}

function tableExists(db, table) {
    return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

test('Life sentence runtime files and registrations are removed', () => {
    const removedFiles = [
        'src/commands/life.ts',
        'src/services/lifeSentences.ts',
        'src/repositories/lifeSentenceRepository.ts',
        'src/commands/adminModeration.ts',
        'src/repositories/lifeModerationRepository.ts',
    ];
    for (const file of removedFiles) {
        assert.equal(projectFileExists(file), false, `${file} should be deleted`);
    }

    const botSource = readProjectFile('src/bot/bot.ts');
    assert.doesNotMatch(botSource, /registerLifeCommand|registerAdminModerationCommand/);
    assert.match(botSource, /registerDisabledLifeCompatibility/);
});

test('Life menu, gate checks, sessions, admin moderation, and AI tasks are absent from active source', () => {
    const menuSource = readProjectFile('src/commands/menu.ts');
    const adminSource = readProjectFile('src/commands/admin.ts');
    const sessionSource = readProjectFile('src/repositories/sessionRepository.ts');
    const aiTypes = readProjectFile('src/services/ai/aiTypes.ts');
    const aiUsage = readProjectFile('src/services/ai/aiUsage.ts');
    const prompts = readProjectFile('src/services/ai/prompts.ts');

    assert.doesNotMatch(menuSource, /life:menu|مواقف الحياة|جملة اليوم|gate_enabled/);
    assert.doesNotMatch(adminSource, /adm:mod|مركز الإشراف|admin_moderation/);
    assert.doesNotMatch(sessionSource, /awaiting_life|life_training|life_search|admin_moderation/);
    assert.doesNotMatch(aiTypes, /generate_life_sentence|validate_life_sentence/);
    assert.doesNotMatch(aiUsage, /generate_life_sentence|validate_life_sentence/);
    assert.doesNotMatch(prompts, /محول دقيق من موقف عربي حقيقي|اختراع أشخاص أو أسباب أو أماكن أو مشاعر/);

    for (const file of ['src/commands/train.ts', 'src/commands/learn.ts', 'src/commands/game.ts', 'src/commands/goethe.ts']) {
        const source = readProjectFile(file);
        assert.doesNotMatch(source, /ensureLifeGateOrShow|gate_enabled|life_daily_gate/);
    }
});

test('old Life callbacks return disabled panel without querying Life tables', () => {
    const source = readProjectFile('src/commands/disabledLife.ts');
    assert.match(source, /bot\.callbackQuery\(\^?\/\^life/);
    assert.match(source, /bot\.callbackQuery\(\^?\/\^adm:/);
    assert.match(source, /تم إيقاف نظام الجمل/);
    assert.match(source, /menu_main/);
    assert.doesNotMatch(source, /life_sentences|life_user_settings|admin_moderation_actions/);
});

test('final schema has no Life tables while migration 0047 removes only Life-owned data', () => {
    const schema = readProjectFile('src/db/schema.sql');
    const migration = readProjectFile('src/db/migrations/0047_remove_life_sentences.sql');

    for (const token of ['life_sentences', 'life_user_settings', 'life_daily_gate', 'life_sentence_reports', 'admin_moderation_actions']) {
        assert.doesNotMatch(schema, new RegExp(token));
        assert.match(migration, new RegExp(`DROP TABLE IF EXISTS ${token}`));
    }
    assert.doesNotMatch(migration, /DROP TABLE IF EXISTS users|DROP TABLE IF EXISTS words|DROP TABLE IF EXISTS xp_transactions|DROP TABLE IF EXISTS image_assets|DROP TABLE IF EXISTS adventure_progress/);
    assert.match(migration, /DELETE FROM ai_cache WHERE task_type IN \('generate_life_sentence', 'validate_life_sentence'\)/);
    assert.match(migration, /DELETE FROM bot_sessions WHERE type LIKE 'life_%' OR type LIKE 'awaiting_life_%'/);
});

test('migration 0047 preserves general bot data while removing Life data', () => {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE users (user_id INTEGER PRIMARY KEY, display_name TEXT);
        CREATE TABLE words (word_id INTEGER PRIMARY KEY, german TEXT, added_by INTEGER);
        CREATE TABLE word_collections (id INTEGER PRIMARY KEY, owner_user_id INTEGER, title TEXT);
        CREATE TABLE xp_transactions (transaction_id INTEGER PRIMARY KEY, user_id INTEGER, final_amount INTEGER, reason TEXT);
        CREATE TABLE image_assets (asset_id INTEGER PRIMARY KEY, owner_user_id INTEGER, provider TEXT);
        CREATE TABLE adventure_progress (id INTEGER PRIMARY KEY, user_id INTEGER, world TEXT, stage INTEGER);
        CREATE TABLE ai_cache (id INTEGER PRIMARY KEY, task_type TEXT);
        CREATE TABLE ai_usage (id INTEGER PRIMARY KEY, user_id INTEGER, task_type TEXT);
        CREATE TABLE bot_sessions (id INTEGER PRIMARY KEY, user_id INTEGER, type TEXT, data TEXT, expires_at TEXT);

        CREATE TABLE life_sentences (id INTEGER PRIMARY KEY, user_id INTEGER);
        CREATE TABLE life_user_settings (user_id INTEGER PRIMARY KEY);
        CREATE TABLE life_sentence_keywords (id INTEGER PRIMARY KEY, life_sentence_id INTEGER);
        CREATE TABLE life_daily_gate (id INTEGER PRIMARY KEY, user_id INTEGER);
        CREATE TABLE life_sentence_copies (id INTEGER PRIMARY KEY, source_sentence_id INTEGER);
        CREATE TABLE life_sentence_reports (id INTEGER PRIMARY KEY, sentence_id INTEGER);
        CREATE TABLE admin_moderation_actions (id INTEGER PRIMARY KEY, target_sentence_id INTEGER);

        INSERT INTO users VALUES (1, 'Bilal');
        INSERT INTO words VALUES (10, 'Haus', 1);
        INSERT INTO word_collections VALUES (20, 1, 'A1');
        INSERT INTO xp_transactions VALUES (30, 1, 5, 'correct_train');
        INSERT INTO image_assets VALUES (40, 1, 'manual_upload');
        INSERT INTO adventure_progress VALUES (50, 1, 'sea', 1);
        INSERT INTO ai_cache VALUES (1, 'generate_life_sentence'), (2, 'classify_level');
        INSERT INTO ai_usage VALUES (1, 1, 'validate_life_sentence'), (2, 1, 'generate_pronunciation');
        INSERT INTO bot_sessions VALUES (1, 1, 'awaiting_life_input', '{}', '2099-01-01'), (2, 1, 'train', '{}', '2099-01-01');
        INSERT INTO life_sentences VALUES (1, 1);
        INSERT INTO life_user_settings VALUES (1);
        INSERT INTO life_sentence_keywords VALUES (1, 1);
        INSERT INTO life_daily_gate VALUES (1, 1);
        INSERT INTO life_sentence_copies VALUES (1, 1);
        INSERT INTO life_sentence_reports VALUES (1, 1);
        INSERT INTO admin_moderation_actions VALUES (1, 1);
    `);

    db.exec(readProjectFile('src/db/migrations/0047_remove_life_sentences.sql'));

    for (const table of ['life_sentences', 'life_user_settings', 'life_sentence_keywords', 'life_daily_gate', 'life_sentence_copies', 'life_sentence_reports', 'admin_moderation_actions']) {
        assert.equal(tableExists(db, table), false, `${table} should be removed`);
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM users').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM words').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM word_collections').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM xp_transactions').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM image_assets').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM adventure_progress').get().count, 1);
    assert.deepEqual(db.prepare('SELECT task_type FROM ai_cache ORDER BY id').all().map((row) => row.task_type), ['classify_level']);
    assert.deepEqual(db.prepare('SELECT task_type FROM ai_usage ORDER BY id').all().map((row) => row.task_type), ['generate_pronunciation']);
    assert.deepEqual(db.prepare('SELECT type FROM bot_sessions ORDER BY id').all().map((row) => row.type), ['train']);
});

test('all migrations apply locally through 0047 and final database has no Life tables', () => {
    const db = new Database(':memory:');
    for (const file of listMigrationFiles()) {
        db.exec(readProjectFile(`src/db/migrations/${file}`));
    }

    for (const table of ['users', 'words', 'xp_transactions', 'word_collections', 'image_assets', 'adventure_progress']) {
        assert.equal(tableExists(db, table), true, `${table} should remain`);
    }
    for (const table of ['life_sentences', 'life_user_settings', 'life_daily_gate', 'life_sentence_reports', 'admin_moderation_actions']) {
        assert.equal(tableExists(db, table), false, `${table} should not remain`);
    }
});

test('persistent START reply keyboard is centralized and not removed', () => {
    const keyboardSource = readProjectFile('src/bot/startKeyboard.ts');
    const startSource = readProjectFile('src/commands/start.ts');
    const botSource = readProjectFile('src/bot/bot.ts');
    const allRuntimeSource = [
        'src/bot/bot.ts',
        'src/bot/startKeyboard.ts',
        'src/commands/start.ts',
        'src/commands/menu.ts',
        'src/commands/train.ts',
        'src/commands/addword.ts',
        'src/commands/game.ts',
    ].map(readProjectFile).join('\n');

    assert.deepEqual(persistentStartKeyboard(), {
        keyboard: [[{ text: '🚀 START' }]],
        resize_keyboard: true,
        is_persistent: true,
        one_time_keyboard: false,
        input_field_placeholder: 'اضغط START للعودة للقائمة',
    });
    assert.match(keyboardSource, /START_BUTTON_TEXT = '🚀 START'/);
    assert.match(keyboardSource, /export async function ensurePersistentStartKeyboard/);
    assert.match(keyboardSource, /START_KEYBOARD_READY_TEXT = '🚀 زر الرجوع السريع جاهز'/);
    assert.match(keyboardSource, /keyboard: \[\[\{ text: START_BUTTON_TEXT \}\]\]/);
    assert.match(keyboardSource, /resize_keyboard: true/);
    assert.match(keyboardSource, /is_persistent: true/);
    assert.match(keyboardSource, /one_time_keyboard: false/);
    assert.match(keyboardSource, /ctx\.reply\(START_KEYBOARD_READY_TEXT/);
    assert.match(startSource, /bot\.hears\(START_BUTTON_TEXT/);
    assert.match(startSource, /deleteAllBotSessionsForUser\(ctx\.db, user\.user_id\)/);
    assert.match(startSource, /ensurePersistentStartKeyboard\(ctx, user\.user_id, \{ force: Boolean\(options\.forceKeyboard\) \}\)/);
    assert.match(botSource, /text === START_BUTTON_TEXT/);
    assert.doesNotMatch(allRuntimeSource, /remove_keyboard|ReplyKeyboardRemove/);
});

test('/start and START share the same entry flow and preserve onboarding routing', () => {
    const startSource = readProjectFile('src/commands/start.ts');
    const commandIndex = startSource.indexOf("bot.command('start'");
    const hearsIndex = startSource.indexOf('bot.hears(START_BUTTON_TEXT');
    const textHandlerIndex = startSource.indexOf("bot.on('message:text'");

    assert.ok(commandIndex >= 0);
    assert.ok(hearsIndex > commandIndex);
    assert.ok(textHandlerIndex > hearsIndex);
    assert.match(startSource, /await handleStartEntry\(ctx\)/g);
    assert.match(startSource, /saveBotSession<NameSessionData>\(ctx\.db, user\.user_id, 'register'/);
    assert.match(startSource, /showLevelSelection\(ctx/);
    assert.match(startSource, /showMainMenu\(ctx\)/);
    assert.match(startSource, /user\.is_banned/);
});

test('/menu and /help install the persistent START keyboard for returning users', () => {
    const menuSource = readProjectFile('src/commands/menu.ts');
    const settingsSource = readProjectFile('src/commands/settings.ts');
    const keyboardSource = readProjectFile('src/bot/startKeyboard.ts');
    const sessionSource = readProjectFile('src/repositories/sessionRepository.ts');

    assert.match(menuSource, /bot\.command\('menu'/);
    assert.match(menuSource, /bot\.command\('help'/);
    assert.match(menuSource, /ensureStartKeyboardForCurrentUser\(ctx\)/);
    assert.match(menuSource, /await showMainMenu\(ctx\)/);
    assert.match(settingsSource, /level_set_\(A1\|A2\|B1\)/);
    assert.match(settingsSource, /ensurePersistentStartKeyboard\(ctx, user\.user_id, \{ force: true \}\)/);
    assert.match(keyboardSource, /getBotSession\(ctx\.db, userId, START_KEYBOARD_SESSION_TYPE\)/);
    assert.match(keyboardSource, /if \(userId && !options\.force\)/);
    assert.match(keyboardSource, /if \(existing\) return false/);
    assert.match(sessionSource, /type <> \?/);
    assert.match(sessionSource, /'start_keyboard'/);
});

test('main menu keeps InlineKeyboard separate from START ReplyKeyboard', () => {
    const menuSource = readProjectFile('src/commands/menu.ts');
    const wordPanelSource = readProjectFile('src/commands/wordPanel.ts');
    const startSource = readProjectFile('src/commands/start.ts');

    assert.match(menuSource, /export function mainMenuKeyboard\(isAdmin: boolean = false\): InlineKeyboard/);
    assert.match(menuSource, /await replaceWithText\(ctx, await mainMenuText\(ctx\), mainMenuKeyboard\(isAdmin\), 'Markdown'\)/);
    assert.doesNotMatch(menuSource, /persistentStartKeyboard\(\)/);
    assert.match(wordPanelSource, /ctx\.editMessageText\(text/);
    assert.doesNotMatch(wordPanelSource, /persistentStartKeyboard|START_BUTTON_TEXT/);
    assert.match(startSource, /await ensurePersistentStartKeyboard\(ctx, user\.user_id, \{ force: Boolean\(options\.forceKeyboard\) \}\)[\s\S]*await showMainMenu\(ctx\)/);
});

test('regressions for image upload and game routes stay present after Life removal', () => {
    const validationSource = readProjectFile('src/services/imageSearch/imageValidationService.ts');
    const manualUploadSource = readProjectFile('src/services/imageSearch/manualUploadImageService.ts');
    const imageRoutes = readProjectFile('src/game/routes.ts');
    const gameSource = readProjectFile('src/commands/game.ts');

    assert.match(validationSource, /detectSupportedImageMime/);
    assert.match(validationSource, /application\/octet-stream/);
    assert.match(validationSource, /image\/jpg/);
    assert.match(manualUploadSource, /selectBestTelegramPhotoSize/);
    assert.match(imageRoutes, /\/game\/api\/session/);
    assert.match(gameSource, /game:menu/);
});
