import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { parseWordCsv } from '../dist/services/csvParser.js';
import { calculateNextReview } from '../dist/services/srs.js';
import { getLevelFromXp, getProgressToNextLevel } from '../dist/services/xpMath.js';
import { buildArasaacImageUrl, normalizeArasaacResults, searchEducationalPictograms } from '../dist/services/pictogramSearch.js';

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
