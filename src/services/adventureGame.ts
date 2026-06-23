export type AdventureMode = 'image_speech' | 'arabic_speech' | 'listen_repeat' | 'smart_mix' | 'hard_words' | 'boss';
export type AdventureDifficulty = 'easy' | 'normal' | 'hard';
export type AdventureSource = 'collection' | 'hard_words' | 'due_review' | 'smart_mix';
export type AdventureSpeechResult = 'correct' | 'near' | 'incorrect' | 'technical_failure';

export interface AdventureModeConfig {
    mode: AdventureMode;
    label: string;
    requiresImages: boolean;
}

export interface AdventureDifficultyConfig {
    difficulty: AdventureDifficulty;
    hearts: number;
    nearRetries: number;
    timeMultiplier: number;
    scoreMultiplier: number;
}

export interface AdventureWorldConfig {
    world: number;
    key: string;
    title: string;
    emoji: string;
    themeClass: string;
    unlockStars: number;
    bossName: string;
    bossHealth: number;
}

export interface AdventureRoundState {
    source: AdventureSource;
    collectionId?: number;
    mode: AdventureMode;
    difficulty: AdventureDifficulty;
    totalQuestions: number;
    currentIndex: number;
    score: number;
    hearts: number;
    combo: number;
    bestCombo: number;
    hintsUsed: number;
    retryQueue: number[];
    wrongWords: number[];
    recoveredWords: number[];
    bossHealth: number;
    playerHealth: number;
    world: number;
    stage: number;
    rewardIdempotencyKey: string;
}

export interface ScoreInput {
    difficulty: AdventureDifficulty;
    firstAttempt: boolean;
    responseMs: number;
    hinted: boolean;
    hardWord: boolean;
    combo: number;
}

export interface ScoreResult {
    base: number;
    difficultyBonus: number;
    speedBonus: number;
    firstAttemptBonus: number;
    noHintBonus: number;
    hardWordBonus: number;
    comboBonus: number;
    total: number;
}

export const ADVENTURE_MODES: AdventureModeConfig[] = [
    { mode: 'image_speech', label: '🖼 صورة ← نطق ألماني', requiresImages: true },
    { mode: 'arabic_speech', label: '🇮🇶 عربي ← نطق ألماني', requiresImages: false },
    { mode: 'listen_repeat', label: '🎧 اسمع ← كرر النطق', requiresImages: false },
    { mode: 'smart_mix', label: '🧠 خليط ذكي', requiresImages: false },
    { mode: 'hard_words', label: '🔥 مواجهة الكلمات الصعبة', requiresImages: false },
    { mode: 'boss', label: '👹 زعيم المرحلة', requiresImages: false },
];

export const ADVENTURE_DIFFICULTIES: Record<AdventureDifficulty, AdventureDifficultyConfig> = {
    easy: { difficulty: 'easy', hearts: 5, nearRetries: 1, timeMultiplier: 1.35, scoreMultiplier: 1 },
    normal: { difficulty: 'normal', hearts: 3, nearRetries: 0, timeMultiplier: 1, scoreMultiplier: 1.25 },
    hard: { difficulty: 'hard', hearts: 2, nearRetries: 0, timeMultiplier: 0.78, scoreMultiplier: 1.6 },
};

export const ADVENTURE_WORLDS: AdventureWorldConfig[] = [
    { world: 1, key: 'sea', title: 'أعماق البحر', emoji: '🌊', themeClass: 'theme-sea', unlockStars: 0, bossName: 'أخطبوط المفردات', bossHealth: 5 },
    { world: 2, key: 'island', title: 'الجزيرة', emoji: '🌴', themeClass: 'theme-island', unlockStars: 6, bossName: 'سلطعون المقالات', bossHealth: 6 },
    { world: 3, key: 'volcano', title: 'البركان', emoji: '🌋', themeClass: 'theme-volcano', unlockStars: 12, bossName: 'تنين التصريف', bossHealth: 7 },
    { world: 4, key: 'ice', title: 'عالم الجليد', emoji: '❄️', themeClass: 'theme-ice', unlockStars: 18, bossName: 'دب النطق', bossHealth: 8 },
    { world: 5, key: 'space', title: 'الفضاء', emoji: '🌌', themeClass: 'theme-space', unlockStars: 24, bossName: 'مذنب الجمل', bossHealth: 9 },
    { world: 6, key: 'castle', title: 'القلعة الألمانية', emoji: '🏰', themeClass: 'theme-castle', unlockStars: 30, bossName: 'حارس القلعة', bossHealth: 10 },
];

export function getAdventureModeConfig(mode: AdventureMode): AdventureModeConfig {
    return ADVENTURE_MODES.find(item => item.mode === mode) ?? ADVENTURE_MODES[0];
}

export function getAdventureDifficultyConfig(difficulty: AdventureDifficulty): AdventureDifficultyConfig {
    return ADVENTURE_DIFFICULTIES[difficulty] ?? ADVENTURE_DIFFICULTIES.normal;
}

export function getAdventureWorld(world: number): AdventureWorldConfig {
    return ADVENTURE_WORLDS.find(item => item.world === world) ?? ADVENTURE_WORLDS[0];
}

export function createInitialAdventureState(input: {
    source: AdventureSource;
    collectionId?: number;
    mode: AdventureMode;
    difficulty: AdventureDifficulty;
    totalQuestions: number;
    world?: number;
    stage?: number;
    rewardIdempotencyKey: string;
}): AdventureRoundState {
    const difficulty = getAdventureDifficultyConfig(input.difficulty);
    const world = getAdventureWorld(input.world ?? 1);
    return {
        source: input.source,
        collectionId: input.collectionId,
        mode: input.mode,
        difficulty: input.difficulty,
        totalQuestions: Math.max(1, input.totalQuestions),
        currentIndex: 0,
        score: 0,
        hearts: difficulty.hearts,
        combo: 0,
        bestCombo: 0,
        hintsUsed: 0,
        retryQueue: [],
        wrongWords: [],
        recoveredWords: [],
        bossHealth: input.mode === 'boss' ? world.bossHealth : 0,
        playerHealth: difficulty.hearts,
        world: world.world,
        stage: Math.max(1, input.stage ?? 1),
        rewardIdempotencyKey: input.rewardIdempotencyKey,
    };
}

export function calculateAdventureScore(input: ScoreInput): ScoreResult {
    const config = getAdventureDifficultyConfig(input.difficulty);
    const base = 100;
    const difficultyBonus = Math.round(base * (config.scoreMultiplier - 1));
    const speedBonus = input.responseMs <= 3000 ? 25 : input.responseMs <= 6000 ? 12 : 0;
    const firstAttemptBonus = input.firstAttempt ? 20 : 0;
    const noHintBonus = input.hinted ? 0 : 15;
    const hardWordBonus = input.hardWord ? 25 : 0;
    const comboBonus = Math.min(120, Math.max(0, input.combo) * 5);
    return {
        base,
        difficultyBonus,
        speedBonus,
        firstAttemptBonus,
        noHintBonus,
        hardWordBonus,
        comboBonus,
        total: base + difficultyBonus + speedBonus + firstAttemptBonus + noHintBonus + hardWordBonus + comboBonus,
    };
}

export function applyAdventureSpeechResult(
    state: AdventureRoundState,
    wordId: number,
    result: AdventureSpeechResult,
    options: { firstAttempt: boolean; hinted: boolean; responseMs: number; hardWord?: boolean; shieldActive?: boolean } = {
        firstAttempt: true,
        hinted: false,
        responseMs: 0,
    }
): { state: AdventureRoundState; pointsDelta: number; retryQueued: boolean; recovered: boolean; bossDamage: number } {
    const next: AdventureRoundState = {
        ...state,
        retryQueue: [...state.retryQueue],
        wrongWords: [...state.wrongWords],
        recoveredWords: [...state.recoveredWords],
    };
    if (result === 'technical_failure') {
        return { state: next, pointsDelta: 0, retryQueued: false, recovered: false, bossDamage: 0 };
    }
    if (result === 'near') {
        return { state: next, pointsDelta: 0, retryQueued: false, recovered: false, bossDamage: 0 };
    }
    if (result === 'incorrect') {
        next.combo = 0;
        if (!options.shieldActive) {
            next.hearts = Math.max(0, next.hearts - 1);
            next.playerHealth = Math.max(0, next.playerHealth - 1);
        }
        if (!next.wrongWords.includes(wordId)) next.wrongWords.push(wordId);
        queueRetryWord(next, wordId);
        return { state: next, pointsDelta: 0, retryQueued: true, recovered: false, bossDamage: 0 };
    }

    next.combo += 1;
    next.bestCombo = Math.max(next.bestCombo, next.combo);
    const score = calculateAdventureScore({
        difficulty: next.difficulty,
        firstAttempt: options.firstAttempt,
        hinted: options.hinted,
        responseMs: options.responseMs,
        hardWord: Boolean(options.hardWord),
        combo: next.combo,
    });
    next.score += score.total;
    const recovered = next.wrongWords.includes(wordId) && !next.recoveredWords.includes(wordId);
    if (recovered) next.recoveredWords.push(wordId);
    const bossDamage = next.mode === 'boss'
        ? Math.max(1, options.firstAttempt ? 2 : 1) - (options.hinted ? 1 : 0)
        : 0;
    if (bossDamage > 0) next.bossHealth = Math.max(0, next.bossHealth - bossDamage);
    return { state: next, pointsDelta: score.total, retryQueued: false, recovered, bossDamage };
}

export function queueRetryWord(state: AdventureRoundState, wordId: number): void {
    if (state.retryQueue.includes(wordId)) return;
    state.retryQueue.push(wordId);
}

export function shouldServeRetryQuestion(state: AdventureRoundState, questionsSinceWrong: number): boolean {
    return state.retryQueue.length > 0 && questionsSinceWrong >= 2;
}

export function popRetryWord(state: AdventureRoundState): number | null {
    return state.retryQueue.shift() ?? null;
}

export function calculateAdventureStars(accuracyPercent: number, bestCombo: number, heartsLeft: number): 0 | 1 | 2 | 3 {
    if (accuracyPercent >= 95 && bestCombo >= 10 && heartsLeft > 0) return 3;
    if (accuracyPercent >= 80 && heartsLeft > 0) return 2;
    if (accuracyPercent >= 50) return 1;
    return 0;
}

export function isArticleNearMiss(answer: string, correct: string, difficulty: AdventureDifficulty): boolean {
    const normalizedAnswer = normalizeGerman(answer);
    const normalizedCorrect = normalizeGerman(correct);
    if (normalizedAnswer === normalizedCorrect) return false;
    const withoutArticle = normalizedCorrect.replace(/^(der|die|das)\s+/, '').trim();
    return normalizedAnswer === withoutArticle && difficulty === 'easy';
}

function normalizeGerman(value: string): string {
    return value
        .trim()
        .replace(/[!?.,;:]/g, ' ')
        .replace(/\s+/g, ' ')
        .toLocaleLowerCase('de-DE')
        .replace(/ä/g, 'ae')
        .replace(/ö/g, 'oe')
        .replace(/ü/g, 'ue')
        .replace(/ß/g, 'ss')
        .trim();
}
