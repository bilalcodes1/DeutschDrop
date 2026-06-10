import assert from 'node:assert/strict';
import test from 'node:test';
import { expandArabicQuery, expandGermanQuery, normalizeArabicSearch, normalizeGermanSearch, buildFtsQuery } from '../dist/services/searchNormalization.js';

test('normalize German handles umlauts and case', () => {
    assert.equal(normalizeGermanSearch('Groß'), 'gross');
    assert.equal(normalizeGermanSearch('Straße'), 'strasse');
    assert.equal(normalizeGermanSearch('Mädchen'), 'maedchen');
    assert.equal(normalizeGermanSearch('Hau'), 'hau');
});

test('normalize Arabic handles diacritics and tatweel', () => {
    assert.equal(normalizeArabicSearch('بَيْت'), 'بيت');
    assert.equal(normalizeArabicSearch('البيــت'), 'البيت');
    assert.equal(normalizeArabicSearch('أكل'), 'اكل');
    assert.equal(normalizeArabicSearch('إلى'), 'الي');
});

test('query expansion expands german combinations', () => {
    const madchen = expandGermanQuery('madchen');
    assert.ok(madchen.includes('madchen'));
    assert.ok(madchen.includes('maedchen'));
});

test('query expansion expands arabic AL', () => {
    const albait = expandArabicQuery('البيت');
    assert.ok(albait.includes('البيت'));
    assert.ok(albait.includes('بيت'));
});

test('buildFtsQuery generates safe queries', () => {
    const fts = buildFtsQuery('madchen البيت');
    
    // It should have AND for the two tokens
    assert.ok(fts.includes(' AND '));
    assert.ok(fts.includes('german_search : ("maedchen"* OR "madchen"*)') || fts.includes('german_search : ("madchen"* OR "maedchen"*)'));
    assert.ok(fts.includes('arabic_search : ("بيت"* OR "البيت"*)') || fts.includes('arabic_search : ("البيت"* OR "بيت"*)'));
});

test('buildFtsQuery rejects empty or long queries', () => {
    assert.equal(buildFtsQuery(''), '');
    assert.equal(buildFtsQuery('   '), '');
    const longString = 'a'.repeat(81);
    assert.equal(buildFtsQuery(longString), '');
});

// Since testing DB logic directly needs SQLite mock, we test the logic via the generated queries in buildFtsQuery which drives FTS MATCH
