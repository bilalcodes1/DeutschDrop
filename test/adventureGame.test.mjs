import assert from 'node:assert/strict';
import test from 'node:test';
import {
    ADVENTURE_MODES,
    ADVENTURE_WORLDS,
    applyAdventureSpeechResult,
    calculateAdventureScore,
    calculateAdventureStars,
    createInitialAdventureState,
    getAdventureDifficultyConfig,
    getAdventureModeConfig,
    getAdventureWorld,
    isArticleNearMiss,
    popRetryWord,
    queueRetryWord,
    shouldServeRetryQuestion,
} from '../dist/services/adventureGame.js';

function state(overrides = {}) {
    return createInitialAdventureState({
        source: 'collection',
        collectionId: 10,
        mode: 'image_speech',
        difficulty: 'normal',
        totalQuestions: 10,
        rewardIdempotencyKey: 'test-key',
        ...overrides,
    });
}

test('adventure modes include all requested gameplay modes', () => {
    assert.deepEqual(ADVENTURE_MODES.map(item => item.mode), ['image_speech', 'arabic_speech', 'listen_repeat', 'smart_mix', 'hard_words', 'boss']);
});

test('image speech mode requires selected images', () => {
    assert.equal(getAdventureModeConfig('image_speech').requiresImages, true);
    assert.equal(getAdventureModeConfig('arabic_speech').requiresImages, false);
});

test('difficulty changes hearts and score multiplier', () => {
    assert.equal(getAdventureDifficultyConfig('easy').hearts, 5);
    assert.equal(getAdventureDifficultyConfig('normal').hearts, 3);
    assert.equal(getAdventureDifficultyConfig('hard').hearts, 2);
    assert.ok(getAdventureDifficultyConfig('hard').scoreMultiplier > getAdventureDifficultyConfig('easy').scoreMultiplier);
});

test('world config contains six themed worlds', () => {
    assert.equal(ADVENTURE_WORLDS.length, 6);
    assert.deepEqual(ADVENTURE_WORLDS.map(item => item.key), ['sea', 'island', 'volcano', 'ice', 'space', 'castle']);
});

test('initial adventure state stores source mode difficulty and reward key', () => {
    const round = state({ mode: 'boss', difficulty: 'hard', rewardIdempotencyKey: 'boss-1' });
    assert.equal(round.mode, 'boss');
    assert.equal(round.difficulty, 'hard');
    assert.equal(round.source, 'collection');
    assert.equal(round.rewardIdempotencyKey, 'boss-1');
    assert.equal(round.hearts, 2);
});

test('boss state starts with boss and player health', () => {
    const round = state({ mode: 'boss', world: 2 });
    assert.equal(round.bossHealth, getAdventureWorld(2).bossHealth);
    assert.equal(round.playerHealth, getAdventureDifficultyConfig('normal').hearts);
});

test('correct answer increases combo score and best combo', () => {
    const result = applyAdventureSpeechResult(state(), 101, 'correct', { firstAttempt: true, hinted: false, responseMs: 1200 });
    assert.equal(result.state.combo, 1);
    assert.equal(result.state.bestCombo, 1);
    assert.ok(result.pointsDelta > 0);
    assert.equal(result.state.score, result.pointsDelta);
});

test('correct answer after hint gives fewer points than no hint', () => {
    const clean = applyAdventureSpeechResult(state(), 101, 'correct', { firstAttempt: true, hinted: false, responseMs: 1200 });
    const hinted = applyAdventureSpeechResult(state(), 101, 'correct', { firstAttempt: true, hinted: true, responseMs: 1200 });
    assert.ok(clean.pointsDelta > hinted.pointsDelta);
});

test('hard word gives extra points', () => {
    const normal = calculateAdventureScore({ difficulty: 'normal', firstAttempt: true, responseMs: 1000, hinted: false, hardWord: false, combo: 1 });
    const hard = calculateAdventureScore({ difficulty: 'normal', firstAttempt: true, responseMs: 1000, hinted: false, hardWord: true, combo: 1 });
    assert.ok(hard.total > normal.total);
});

test('combo gives deterministic bonus', () => {
    const low = calculateAdventureScore({ difficulty: 'normal', firstAttempt: true, responseMs: 1000, hinted: false, hardWord: false, combo: 1 });
    const high = calculateAdventureScore({ difficulty: 'normal', firstAttempt: true, responseMs: 1000, hinted: false, hardWord: false, combo: 5 });
    assert.ok(high.comboBonus > low.comboBonus);
});

test('incorrect answer resets combo and decrements hearts', () => {
    const round = applyAdventureSpeechResult(state(), 101, 'correct', { firstAttempt: true, hinted: false, responseMs: 1000 }).state;
    const result = applyAdventureSpeechResult(round, 102, 'incorrect');
    assert.equal(result.state.combo, 0);
    assert.equal(result.state.hearts, 2);
    assert.equal(result.retryQueued, true);
});

test('shield prevents one heart loss', () => {
    const result = applyAdventureSpeechResult(state(), 101, 'incorrect', { firstAttempt: false, hinted: false, responseMs: 0, shieldActive: true });
    assert.equal(result.state.hearts, 3);
    assert.equal(result.state.retryQueue.includes(101), true);
});

test('technical failure does not change hearts combo or retry queue', () => {
    const round = applyAdventureSpeechResult(state(), 101, 'correct', { firstAttempt: true, hinted: false, responseMs: 1000 }).state;
    const result = applyAdventureSpeechResult(round, 102, 'technical_failure');
    assert.equal(result.state.hearts, round.hearts);
    assert.equal(result.state.combo, round.combo);
    assert.deepEqual(result.state.retryQueue, []);
});

test('near result does not update SRS-like wrong state or hearts', () => {
    const result = applyAdventureSpeechResult(state({ difficulty: 'easy' }), 101, 'near');
    assert.equal(result.state.hearts, 5);
    assert.deepEqual(result.state.wrongWords, []);
    assert.deepEqual(result.state.retryQueue, []);
});

test('boss first try hit damages boss more than hinted hit', () => {
    const round = state({ mode: 'boss' });
    const clean = applyAdventureSpeechResult(round, 101, 'correct', { firstAttempt: true, hinted: false, responseMs: 1000 });
    const hinted = applyAdventureSpeechResult(round, 101, 'correct', { firstAttempt: true, hinted: true, responseMs: 1000 });
    assert.ok(clean.bossDamage > hinted.bossDamage);
});

test('recovered word is tracked after prior wrong word succeeds', () => {
    const wrong = applyAdventureSpeechResult(state(), 101, 'incorrect').state;
    const recovered = applyAdventureSpeechResult(wrong, 101, 'correct', { firstAttempt: false, hinted: false, responseMs: 2000 });
    assert.equal(recovered.recovered, true);
    assert.deepEqual(recovered.state.recoveredWords, [101]);
});

test('retry queue does not duplicate same word', () => {
    const round = state();
    queueRetryWord(round, 101);
    queueRetryWord(round, 101);
    assert.deepEqual(round.retryQueue, [101]);
});

test('retry queue waits at least two questions', () => {
    const round = state();
    queueRetryWord(round, 101);
    assert.equal(shouldServeRetryQuestion(round, 1), false);
    assert.equal(shouldServeRetryQuestion(round, 2), true);
});

test('retry pop returns queued word once', () => {
    const round = state();
    queueRetryWord(round, 101);
    assert.equal(popRetryWord(round), 101);
    assert.equal(popRetryWord(round), null);
});

test('article missing is near in easy mode only', () => {
    assert.equal(isArticleNearMiss('Auto', 'das Auto', 'easy'), true);
    assert.equal(isArticleNearMiss('Auto', 'das Auto', 'normal'), false);
    assert.equal(isArticleNearMiss('das Auto', 'das Auto', 'easy'), false);
});

test('star calculation rewards accuracy combo and surviving hearts', () => {
    assert.equal(calculateAdventureStars(96, 10, 1), 3);
    assert.equal(calculateAdventureStars(82, 4, 1), 2);
    assert.equal(calculateAdventureStars(55, 1, 0), 1);
    assert.equal(calculateAdventureStars(20, 0, 0), 0);
});
