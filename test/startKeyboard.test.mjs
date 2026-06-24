import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import Database from 'better-sqlite3';
import {
    deleteAllBotSessionsForUser,
    getBotSession,
    saveBotSession,
} from '../dist/repositories/sessionRepository.js';
import { persistentStartKeyboard } from '../dist/bot/startKeyboard.js';

const root = new URL('../', import.meta.url);

function readProjectFile(path) {
    return fs.readFileSync(new URL(path, root), 'utf8');
}

class MockD1 {
    constructor(sqlite) {
        this.sqlite = sqlite;
    }

    prepare(sql) {
        const sqlite = this.sqlite;
        return {
            bind(...params) {
                return {
                    first() {
                        return Promise.resolve(sqlite.prepare(sql).get(...params) ?? null);
                    },
                    all() {
                        return Promise.resolve({ results: sqlite.prepare(sql).all(...params) });
                    },
                    run() {
                        const info = sqlite.prepare(sql).run(...params);
                        return Promise.resolve({ success: true, meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) } });
                    },
                };
            },
        };
    }
}

function createSessionDb() {
    const sqlite = new Database(':memory:');
    sqlite.exec(`
        CREATE TABLE bot_sessions (
            session_id TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            type TEXT NOT NULL,
            data TEXT NOT NULL,
            expires_at DATETIME NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX idx_bot_sessions_user_type ON bot_sessions(user_id, type);
        CREATE INDEX idx_bot_sessions_expires_at ON bot_sessions(expires_at);
    `);
    return new MockD1(sqlite);
}

test('START ReplyKeyboard markup has the exact Telegram shape', () => {
    assert.deepEqual(persistentStartKeyboard(), {
        keyboard: [[{ text: '🚀 START' }]],
        resize_keyboard: true,
        is_persistent: true,
        one_time_keyboard: false,
        input_field_placeholder: 'اضغط START للعودة للقائمة',
    });
});

test('/start passes force=true so it can reinstall hidden keyboards', () => {
    const source = readProjectFile('src/commands/start.ts');
    assert.match(source, /bot\.command\('start'/);
    assert.match(source, /await handleStartEntry\(ctx, \{ forceKeyboard: true \}\)/);
});

test('/start deep-link compatibility also forces START keyboard reinstall', () => {
    const source = readProjectFile('src/commands/start.ts');
    assert.match(source, /payload\?\.startsWith\('life_'\)/);
    assert.match(source, /ensurePersistentStartKeyboard\(ctx, user\.user_id, \{ force: true \}\)/);
});

test('/menu forces START keyboard reinstall before showing Inline menu', () => {
    const source = readProjectFile('src/commands/menu.ts');
    assert.match(source, /bot\.command\('menu'/);
    assert.match(source, /await ensureStartKeyboardForCurrentUser\(ctx\)[\s\S]*await showMainMenu\(ctx\)/);
    assert.match(source, /ensurePersistentStartKeyboard\(ctx, user\?\.user_id, \{ force: true \}\)/);
});

test('/help forces START keyboard reinstall and sends help as a separate text message', () => {
    const source = readProjectFile('src/commands/menu.ts');
    assert.match(source, /bot\.command\('help'/);
    assert.match(source, /await ensureStartKeyboardForCurrentUser\(ctx\)[\s\S]*await ctx\.reply\(helpText\(\)\)/);
});

test('registration completion forces START keyboard reinstall', () => {
    const source = readProjectFile('src/commands/start.ts');
    assert.match(source, /completeUserRegistration\(ctx\.db, user\.user_id, displayName\)/);
    assert.match(source, /ensurePersistentStartKeyboard\(ctx, user\.user_id, \{ force: true \}\)[\s\S]*تم تسجيلك/);
});

test('level selection completion forces START keyboard reinstall', () => {
    const source = readProjectFile('src/commands/settings.ts');
    assert.match(source, /level_set_\(A1\|A2\|B1\)/);
    assert.match(source, /ensurePersistentStartKeyboard\(ctx, user\.user_id, \{ force: true \}\)/);
});

test('START button text uses shared entry flow without force reinstall', () => {
    const source = readProjectFile('src/commands/start.ts');
    assert.match(source, /bot\.hears\(START_BUTTON_TEXT, async \(ctx\) => \{\s*await handleStartEntry\(ctx\);/);
});

test('force=false skips duplicate install when marker exists', () => {
    const source = readProjectFile('src/bot/startKeyboard.ts');
    assert.match(source, /if \(userId && !options\.force\)/);
    assert.match(source, /if \(existing\) return false/);
});

test('force=true bypasses existing marker check and sends a new ReplyKeyboard message', () => {
    const source = readProjectFile('src/bot/startKeyboard.ts');
    assert.match(source, /options: EnsurePersistentStartKeyboardOptions = \{\}/);
    assert.match(source, /ctx\.reply\(START_KEYBOARD_READY_TEXT/);
    assert.match(source, /reply_markup: persistentStartKeyboard\(\)/);
});

test('main menu remains InlineKeyboard and is separate from ReplyKeyboard install', () => {
    const source = readProjectFile('src/commands/menu.ts');
    assert.match(source, /export function mainMenuKeyboard\(isAdmin: boolean = false\): InlineKeyboard/);
    assert.match(source, /await replaceWithText\(ctx, await mainMenuText\(ctx\), mainMenuKeyboard\(isAdmin\), 'Markdown'\)/);
    assert.doesNotMatch(source, /reply_markup: persistentStartKeyboard/);
});

test('editMessageText helper is not used to install START ReplyKeyboard', () => {
    const wordPanel = readProjectFile('src/commands/wordPanel.ts');
    const keyboard = readProjectFile('src/bot/startKeyboard.ts');
    assert.match(wordPanel, /ctx\.editMessageText\(text/);
    assert.doesNotMatch(wordPanel, /persistentStartKeyboard|START_BUTTON_TEXT|START_KEYBOARD_READY_TEXT/);
    assert.doesNotMatch(keyboard, /editMessageText|editMessageReplyMarkup/);
});

test('ordinary callbacks do not reinstall START keyboard on every navigation', () => {
    const source = readProjectFile('src/commands/menu.ts');
    const callbacksBlock = source.slice(source.indexOf('// Handle menu callbacks'), source.indexOf('async function ensureStartKeyboardForCurrentUser'));
    assert.doesNotMatch(callbacksBlock, /ensurePersistentStartKeyboard|ensureStartKeyboardForCurrentUser|persistentStartKeyboard/);
});

test('bot_sessions schema allows multiple session rows for one user', () => {
    const schema = readProjectFile('src/db/schema.sql');
    const block = schema.slice(schema.indexOf('CREATE TABLE IF NOT EXISTS bot_sessions'), schema.indexOf('CREATE TABLE IF NOT EXISTS daily_review_plans'));
    assert.match(block, /session_id TEXT PRIMARY KEY/);
    assert.match(block, /user_id INTEGER NOT NULL/);
    assert.doesNotMatch(block, /UNIQUE\(user_id\)|user_id INTEGER PRIMARY KEY/);
});

test('start_keyboard marker type is explicit and not a hidden training session', () => {
    const source = readProjectFile('src/repositories/sessionRepository.ts');
    assert.match(source, /'start_keyboard'/);
    assert.match(source, /sessionId\(userId, type\)/);
    assert.match(source, /DELETE FROM bot_sessions WHERE user_id = \? AND type <> \?/);
});

test('marker coexists with a training session', async () => {
    const db = createSessionDb();
    await saveBotSession(db, 1, 'start_keyboard', { installed: true });
    await saveBotSession(db, 1, 'train', { questionIndex: 0 });

    assert.equal((await getBotSession(db, 1, 'start_keyboard'))?.data.installed, true);
    assert.equal((await getBotSession(db, 1, 'train'))?.data.questionIndex, 0);
});

test('marker coexists with manual image upload session', async () => {
    const db = createSessionDb();
    await saveBotSession(db, 1, 'start_keyboard', { installed: true });
    await saveBotSession(db, 1, 'awaiting_manual_word_image_upload', { wordId: 10 });

    assert.equal((await getBotSession(db, 1, 'start_keyboard'))?.data.installed, true);
    assert.equal((await getBotSession(db, 1, 'awaiting_manual_word_image_upload'))?.data.wordId, 10);
});

test('START cleanup deletes temporary training session but preserves marker', async () => {
    const db = createSessionDb();
    await saveBotSession(db, 1, 'start_keyboard', { installed: true });
    await saveBotSession(db, 1, 'train', { questionIndex: 0 });

    await deleteAllBotSessionsForUser(db, 1);

    assert.equal((await getBotSession(db, 1, 'start_keyboard'))?.data.installed, true);
    assert.equal(await getBotSession(db, 1, 'train'), null);
});

test('START route does not award XP, update SRS, or record wrong answers', () => {
    const source = readProjectFile('src/commands/start.ts');
    assert.doesNotMatch(source, /addXp|recordReview|updateWordLearningAfterAnswer|wrongCount|isCorrect/);
});

test('middleware lets START through before session text handlers can grade it', () => {
    const botSource = readProjectFile('src/bot/bot.ts');
    const startSource = readProjectFile('src/commands/start.ts');
    const addWordSource = readProjectFile('src/commands/addword.ts');

    assert.match(botSource, /text === START_BUTTON_TEXT\) return next\(\)/);
    assert.ok(startSource.indexOf('bot.hears(START_BUTTON_TEXT') < startSource.indexOf("bot.on('message:text'"));
    assert.doesNotMatch(addWordSource, /START_BUTTON_TEXT/);
});

test('generic session checks do not treat start_keyboard as an active waiting flow', () => {
    const botSource = readProjectFile('src/bot/bot.ts');
    const addWordSource = readProjectFile('src/commands/addword.ts');
    const supportSource = readProjectFile('src/commands/support.ts');

    assert.match(botSource, /getBotSession\(ctx\.db, user\.user_id, 'register'\)/);
    assert.doesNotMatch(botSource, /getBotSession\(ctx\.db, user\.user_id, 'start_keyboard'\)/);
    assert.doesNotMatch(addWordSource, /start_keyboard/);
    assert.doesNotMatch(supportSource, /start_keyboard/);
});

test('runtime never removes the persistent START keyboard', () => {
    const runtimeSource = [
        'src/bot/startKeyboard.ts',
        'src/bot/bot.ts',
        'src/commands/start.ts',
        'src/commands/menu.ts',
        'src/commands/settings.ts',
        'src/commands/wordPanel.ts',
    ].map(readProjectFile).join('\n');
    assert.doesNotMatch(runtimeSource, /remove_keyboard|ReplyKeyboardRemove/);
});
