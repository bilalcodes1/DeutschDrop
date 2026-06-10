import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { searchUserWords, searchCollectionWords, searchCollections } from '../dist/repositories/searchRepository.js';

// Mock D1 Database wrapping better-sqlite3
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
                    all: async () => {
                        const stmt = this.db.prepare(query);
                        const results = stmt.all(...params);
                        return { results };
                    }
                };
            }
        };
    }
}

test('searchUserWords repository tests with FTS5', async () => {
    const d1 = new MockD1();
    
    // Setup schema
    d1.exec(`
        CREATE TABLE words (word_id INTEGER PRIMARY KEY, german TEXT, arabic TEXT, example TEXT, example_ar TEXT, pronunciation_ar TEXT, pronunciation_latin TEXT, level INTEGER, is_hard INTEGER, added_by INTEGER, created_at TEXT, updated_at TEXT, german_search TEXT, arabic_search TEXT, example_search TEXT);
        CREATE VIRTUAL TABLE words_fts USING fts5(word_id UNINDEXED, german_search, arabic_search);
        
        CREATE TRIGGER words_after_insert_fts AFTER INSERT ON words BEGIN
            INSERT INTO words_fts (word_id, german_search, arabic_search) VALUES (new.word_id, new.german_search, new.arabic_search);
        END;
        CREATE TRIGGER words_after_delete_fts AFTER DELETE ON words BEGIN
            DELETE FROM words_fts WHERE word_id = old.word_id;
        END;
        CREATE TRIGGER words_after_update_fts AFTER UPDATE ON words BEGIN
            DELETE FROM words_fts WHERE word_id = old.word_id;
            INSERT INTO words_fts (word_id, german_search, arabic_search) VALUES (new.word_id, new.german_search, new.arabic_search);
        END;
    `);

    // Insert data (triggers will populate words_fts)
    const insertStmt = d1.db.prepare('INSERT INTO words (word_id, added_by, german, arabic, german_search, arabic_search) VALUES (?, ?, ?, ?, ?, ?)');
    insertStmt.run(1, 1, 'Mädchen', 'فتاة', 'maedchen', 'فتاه');
    insertStmt.run(2, 1, 'Haus', 'بَيْت', 'haus', 'بيت');
    insertStmt.run(3, 1, 'Straße', 'شارع', 'strasse', 'شارع');
    insertStmt.run(4, 2, 'Haus', 'بَيْت', 'haus', 'بيت'); // User 2's word
    
    // Test: searchUserWords يرجع Haus عند Hau (Partial search)
    const res1 = await searchUserWords(d1, 1, 'Hau', 10, 0);
    assert.equal(res1.length, 1);
    assert.equal(res1[0].word_id, 2);

    // Test: searchUserWords يرجع Straße عند strasse
    const res2 = await searchUserWords(d1, 1, 'strasse', 10, 0);
    assert.equal(res2.length, 1);
    assert.equal(res2[0].word_id, 3);

    // Test: searchUserWords يرجع Mädchen عند madchen (Expansion)
    const res3 = await searchUserWords(d1, 1, 'madchen', 10, 0);
    assert.equal(res3.length, 1);
    assert.equal(res3[0].word_id, 1);

    // Test: searchUserWords يرجع بيت عند البيــت (Arabic Expansion)
    const res4 = await searchUserWords(d1, 1, 'البيــت', 10, 0);
    assert.equal(res4.length, 1);
    assert.equal(res4[0].word_id, 2);

    // Test: searchUserWords يحترم userId
    const res5 = await searchUserWords(d1, 2, 'Haus', 10, 0);
    assert.equal(res5.length, 1);
    assert.equal(res5[0].word_id, 4); // should only return word 4 for user 2
});

test('searchCollections and searchCollectionWords respect privacy and ownership', async () => {
    const d1 = new MockD1();
    
    d1.exec(`
        CREATE TABLE users (user_id INTEGER PRIMARY KEY, first_name TEXT);
        CREATE TABLE word_collections (id INTEGER PRIMARY KEY, owner_user_id INTEGER, title TEXT, description TEXT, visibility TEXT, is_deleted INTEGER, created_at TEXT);
        CREATE TABLE word_collection_items (id INTEGER PRIMARY KEY, collection_id INTEGER, word_id INTEGER);
        CREATE TABLE words (word_id INTEGER PRIMARY KEY, added_by INTEGER, german TEXT, arabic TEXT, german_search TEXT, arabic_search TEXT, example TEXT, example_ar TEXT, pronunciation_ar TEXT, pronunciation_latin TEXT, level INTEGER, is_hard INTEGER, created_at TEXT, updated_at TEXT);
        CREATE VIRTUAL TABLE words_fts USING fts5(word_id UNINDEXED, german_search, arabic_search);
        
        CREATE TRIGGER words_after_insert_fts AFTER INSERT ON words BEGIN
            INSERT INTO words_fts (word_id, german_search, arabic_search) VALUES (new.word_id, new.german_search, new.arabic_search);
        END;
    `);

    // Setup User 1 (owner) and User 2 (other)
    d1.db.prepare(`INSERT INTO users (user_id, first_name) VALUES (1, 'User1')`).run();
    d1.db.prepare(`INSERT INTO users (user_id, first_name) VALUES (2, 'User2')`).run();

    // Setup Collections
    d1.db.prepare(`INSERT INTO word_collections (id, owner_user_id, title, description, visibility, is_deleted) VALUES (1, 1, 'Public Col', 'Desc', 'public', 0)`).run();
    d1.db.prepare(`INSERT INTO word_collections (id, owner_user_id, title, description, visibility, is_deleted) VALUES (2, 1, 'Private Col', 'Desc', 'private', 0)`).run();

    // Setup Word and Item
    d1.db.prepare(`INSERT INTO words (word_id, added_by, german_search, arabic_search) VALUES (1, 1, 'haus', 'بيت')`).run();
    d1.db.prepare(`INSERT INTO word_collection_items (id, collection_id, word_id) VALUES (1, 2, 1)`).run(); // Word in private collection
    d1.db.prepare(`INSERT INTO word_collection_items (id, collection_id, word_id) VALUES (2, 1, 1)`).run(); // Word in public collection

    // Test: searchCollections لا يعرض private collection لغير المالك
    const colsForUser2 = await searchCollections(d1, 2, 'Col', 10, 0);
    assert.equal(colsForUser2.length, 1);
    assert.equal(colsForUser2[0].id, 1); // Only Public Col

    const colsForUser1 = await searchCollections(d1, 1, 'Col', 10, 0);
    assert.equal(colsForUser1.length, 2); // Owner sees both

    // Test: searchCollectionWords يحترم collection_id and privacy
    const wordsForUser2Private = await searchCollectionWords(d1, 2, 2, 'Haus', 10, 0);
    assert.equal(wordsForUser2Private.length, 0); // Cannot search private collection of another user

    const wordsForUser2Public = await searchCollectionWords(d1, 1, 2, 'Haus', 10, 0);
    assert.equal(wordsForUser2Public.length, 1); // Can search public collection
    assert.equal(wordsForUser2Public[0].word_id, 1);
});

