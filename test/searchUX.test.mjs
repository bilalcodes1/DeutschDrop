import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { handleGlobalSearchInput } from '../dist/commands/search.js';
import { mainMenuKeyboard } from '../dist/commands/menu.js';
import { saveBotSession } from '../dist/repositories/sessionRepository.js';
import fs from 'node:fs';
import path from 'node:path';

class MockD1 {
    constructor() {
        this.db = new Database(':memory:');
    }
    
    exec(sql) {
        this.db.exec(sql);
    }

    prepare(query) {
        return {
            bind: (...params) => {
                return {
                    all: async () => ({ results: this.db.prepare(query).all(...params) }),
                    first: async () => this.db.prepare(query).get(...params) || null,
                    run: async () => { this.db.prepare(query).run(...params); return { success: true }; }
                };
            }
        };
    }
}

test('1. Main menu keyboard has global search button', () => {
    const kb = mainMenuKeyboard();
    const searchBtn = kb.inline_keyboard.flat().find(b => b.text === '🔎 بحث');
    assert.ok(searchBtn, 'Search button exists in main menu');
    assert.equal(searchBtn.callback_data, 'global_search_start', 'Callback data is correct');
});

test('2. Middleware Order in bot.ts - add_word must run before global_search', () => {
    const botTsPath = path.join(process.cwd(), 'src/bot/bot.ts');
    const content = fs.readFileSync(botTsPath, 'utf8');

    const addWordIndex = content.indexOf('registerAddWordCommand(bot)');
    const searchIndex = content.indexOf('registerSearchCommand(bot)');

    assert.ok(addWordIndex > 0, 'registerAddWordCommand exists in bot.ts');
    assert.ok(searchIndex > 0, 'registerSearchCommand exists in bot.ts');
    assert.ok(addWordIndex < searchIndex, 'registerAddWordCommand must be registered BEFORE registerSearchCommand');
});

test('3. handleGlobalSearchInput correctly processes sessions and query length limits', async () => {
    const mockDb = new MockD1();
    mockDb.exec(`
        CREATE TABLE users (user_id INTEGER PRIMARY KEY, telegram_user_id INTEGER, telegram_id INTEGER, is_deleted INTEGER DEFAULT 0, first_name TEXT);
        CREATE TABLE bot_sessions (session_id TEXT PRIMARY KEY, user_id INTEGER, type TEXT, data TEXT, expires_at TEXT);
    `);
    
    mockDb.db.prepare("INSERT INTO users (user_id, telegram_user_id, telegram_id, first_name) VALUES (1, 12345, 12345, 'Test')").run();

    let replies = [];
    const mockCtx = {
        from: { id: 12345 },
        me: { username: 'TestBot' },
        db: mockDb,
        reply: async (msg, options) => { replies.push({ msg, options }); }
    };

    let handled = await handleGlobalSearchInput(mockCtx, 'test');
    assert.equal(handled, false, 'Should return false when no global_search session is active');

    await saveBotSession(mockDb, 1, 'global_search', { searchType: 'my_words', page: 1 });

    handled = await handleGlobalSearchInput(mockCtx, '   ');
    assert.equal(handled, true, 'Should handle empty input');
    assert.ok(replies.some(r => r.msg.includes('⚠️ لا يمكن أن يكون نص البحث فارغاً.')), 'Should show empty text warning');

    handled = await handleGlobalSearchInput(mockCtx, 'a'.repeat(81));
    assert.equal(handled, true, 'Should handle long input');
    assert.ok(replies.some(r => r.msg.includes('⚠️ نص البحث طويل جداً (أقصى حد 80 حرف).')), 'Should show long text warning');
});

test('4. searchCollections output contains correct callback_data and no deep links', async () => {
    const searchTsPath = path.join(process.cwd(), 'src/commands/search.ts');
    const content = fs.readFileSync(searchTsPath, 'utf8');
    
    // 1. Verify we don't have deep link for collection in searchCollections
    assert.ok(!content.includes('start=col_'), 'search.ts must not contain deep link start=col_ for collections');
    
    // 2. Verify we use correct callback format
    assert.ok(content.includes('collection:view:${c.id}:page:1'), 'search.ts must contain the correct inline button callback for collections');
    assert.ok(content.includes('collection:view:${session.data.collectionId}:page:1'), 'search.ts must contain the correct inline button callback for in_collection search');
});

test('5. searchUsers normalization strips diacritics and emojis', async () => {
    const { normalizeUserSearchText } = await import('../dist/services/searchNormalization.js');
    
    assert.equal(normalizeUserSearchText('بَيْت'), 'بيت', 'Should strip arabic diacritics');
    assert.equal(normalizeUserSearchText('مُحَمَّد'), 'محمد', 'Should strip arabic diacritics and shadda');
    assert.equal(normalizeUserSearchText('أحمد'), 'احمد', 'Should normalize alef');
    assert.equal(normalizeUserSearchText('User 💻'), 'user 💻', 'Should allow emoji');
    assert.equal(normalizeUserSearchText('K'), 'k', 'Should handle single letter');
    assert.equal(normalizeUserSearchText('уо'), 'yo', 'Should map cyrillic homoglyphs');
    assert.equal(normalizeUserSearchText('УО'), 'yo', 'Should map upper cyrillic homoglyphs');
    assert.equal(normalizeUserSearchText(null), '', 'Should handle null');
});

test('6. User Search logic and privacy (Short query, hidden fields, admin vs normal)', async () => {
    const mockDb = new MockD1();
    mockDb.exec(`
        CREATE TABLE users (
            user_id INTEGER PRIMARY KEY, telegram_user_id INTEGER, telegram_id INTEGER,
            is_deleted INTEGER DEFAULT 0, first_name TEXT, last_name TEXT, 
            username TEXT, telegram_username TEXT, name TEXT, display_name TEXT
        );
        CREATE TABLE bot_sessions (session_id TEXT PRIMARY KEY, user_id INTEGER, type TEXT, data TEXT, expires_at TEXT);
    `);
    
    // User 1: Has emoji, no username
    mockDb.db.prepare(`INSERT INTO users (user_id, telegram_user_id, telegram_id, display_name) VALUES (1, 111, 111, 'Ali 💻')`).run();
    // User 2: display_name is Ali, but username is kay_hidden
    mockDb.db.prepare(`INSERT INTO users (user_id, telegram_user_id, telegram_id, display_name, username) VALUES (2, 222, 222, 'Omar', 'kay_hidden')`).run();
    // User 3: display_name is yo
    mockDb.db.prepare(`INSERT INTO users (user_id, telegram_user_id, telegram_id, display_name) VALUES (3, 333, 333, 'yo')`).run();
    // User 4: Admin
    mockDb.db.prepare(`INSERT INTO users (user_id, telegram_user_id, telegram_id) VALUES (999, 999, 999)`).run();

    await saveBotSession(mockDb, 1, 'global_search', { searchType: 'user', page: 1 });
    await saveBotSession(mockDb, 999, 'global_search', { searchType: 'user', page: 1 });

    const mockCtxNormalUser = {
        from: { id: 111 },
        env: { ADMIN_TELEGRAM_IDS: '999' },
        db: mockDb,
        reply: async (msg, options) => { mockCtxNormalUser.lastReply = { msg, options }; }
    };

    const mockCtxAdmin = {
        from: { id: 999 },
        env: { ADMIN_TELEGRAM_IDS: '999' },
        db: mockDb,
        reply: async (msg, options) => { mockCtxAdmin.lastReply = { msg, options }; }
    };

    // 1. Normal user query "k" is rejected
    await handleGlobalSearchInput(mockCtxNormalUser, 'k');
    assert.ok(mockCtxNormalUser.lastReply.msg.includes('اكتب حرفين على الأقل'), 'Should reject single letter');

    // 2. Normal user query "yo" finds yo in display_name (latin) and cyrillic
    await handleGlobalSearchInput(mockCtxNormalUser, 'yo');
    assert.ok(mockCtxNormalUser.lastReply.msg.includes('yo'), 'Should find yo');
    
    // Test cyrillic user 'уо' found with 'yo'
    mockDb.db.prepare(`INSERT INTO users (user_id, telegram_user_id, telegram_id, display_name) VALUES (4, 444, 444, 'уо')`).run();
    await handleGlobalSearchInput(mockCtxNormalUser, 'yo');
    assert.ok(mockCtxNormalUser.lastReply.msg.includes('уо'), 'Should find cyrillic уо with yo');

    // Test cyrillic user 'kаy' found with 'kay'
    mockDb.db.prepare(`INSERT INTO users (user_id, telegram_user_id, telegram_id, display_name) VALUES (5, 555, 555, 'kаy')`).run(); // 'а' is cyrillic
    await handleGlobalSearchInput(mockCtxNormalUser, 'kay');
    assert.ok(mockCtxNormalUser.lastReply.msg.includes('kаy'), 'Should find cyrillic kаy with kay');
    
    // 3. Normal user searching "kay" does NOT find user with username "kay_hidden" (Omar)
    await handleGlobalSearchInput(mockCtxNormalUser, 'kay');
    assert.ok(!mockCtxNormalUser.lastReply.msg.includes('Omar'), 'Should not find hidden username');
    
    // 4. Admin searching "kay" DOES find user with username "kay_hidden"
    await handleGlobalSearchInput(mockCtxAdmin, 'kay');
    assert.ok(mockCtxAdmin.lastReply.msg.includes('kay_hidden'), 'Admin should find by username');

    // 5. Normal user output privacy
    await handleGlobalSearchInput(mockCtxNormalUser, 'ali');
    const normalMsg = mockCtxNormalUser.lastReply.msg;
    assert.ok(!normalMsg.includes('ID:'), 'Normal user must not see ID');
    assert.ok(!normalMsg.includes('UID:'), 'Normal user must not see UID');
    assert.ok(!normalMsg.includes('@'), 'Normal user must not see username');
    assert.ok(!normalMsg.includes('Telegram'), 'Normal user must not see Telegram info');

    // 6. Admin output privacy
    await handleGlobalSearchInput(mockCtxAdmin, 'ali');
    const adminMsg = mockCtxAdmin.lastReply.msg;
    assert.ok(adminMsg.includes('🔐 وضع الأدمن'), 'Admin must see admin label');
    assert.ok(adminMsg.includes('UID: 1'), 'Admin must see UID');
    assert.ok(adminMsg.includes('ID: 111'), 'Admin must see Telegram ID');
});
