import assert from 'node:assert/strict';
import test from 'node:test';
import { parseWordCsv } from '../dist/services/csvParser.js';
import { calculateNextReview } from '../dist/services/srs.js';
import { getLevelFromXp, getProgressToNextLevel } from '../dist/services/xpMath.js';

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
