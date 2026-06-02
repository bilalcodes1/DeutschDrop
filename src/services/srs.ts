// =====================================================
// Spaced Repetition System (SM-2 Algorithm)
// =====================================================

export interface SrsInput {
    easeFactor: number;
    interval: number;
    repetitions: number;
    correctCount: number;
    wrongCount: number;
}

export interface SrsOutput {
    easeFactor: number;
    interval: number;
    repetitions: number;
    nextReview: string; // ISO date string
    status: 'new' | 'learning' | 'reviewing' | 'mastered';
}

/**
 * Calculate the next review date based on SM-2 algorithm
 * with modifications for difficulty rating.
 */
export function calculateNextReview(
    input: SrsInput,
    isCorrect: boolean,
    difficulty: 'easy' | 'medium' | 'hard'
): SrsOutput {
    let easeFactor = input.easeFactor;
    let interval = input.interval;
    let repetitions = input.repetitions;

    if (!isCorrect) {
        // Reset on wrong answer
        repetitions = 0;
        interval = 1;
        // Reduce ease factor
        easeFactor = Math.max(1.3, easeFactor - 0.2);
        return buildOutput(easeFactor, interval, repetitions, 'learning');
    }

    // Adjust ease factor based on difficulty rating
    if (difficulty === 'easy') {
        easeFactor += 0.15;
    } else if (difficulty === 'hard') {
        easeFactor -= 0.15;
    }
    easeFactor = Math.max(1.3, easeFactor);

    repetitions += 1;

    if (repetitions === 1) {
        interval = 1;
    } else if (repetitions === 2) {
        interval = 3;
    } else {
        interval = Math.round(interval * easeFactor);
    }

    // Cap max interval at 180 days
    interval = Math.min(interval, 180);

    // Determine status based on repetitions and interval
    let status: 'new' | 'learning' | 'reviewing' | 'mastered';
    if (repetitions < 2) {
        status = 'learning';
    } else if (repetitions < 5) {
        status = 'reviewing';
    } else {
        status = 'mastered';
    }

    return buildOutput(easeFactor, interval, repetitions, status);
}

function buildOutput(
    easeFactor: number,
    interval: number,
    repetitions: number,
    status: 'new' | 'learning' | 'reviewing' | 'mastered'
): SrsOutput {
    const now = new Date();
    const nextReview = new Date(now);
    nextReview.setDate(now.getDate() + interval);

    return {
        easeFactor: Math.round(easeFactor * 100) / 100,
        interval,
        repetitions,
        nextReview: nextReview.toISOString(),
        status,
    };
}

/**
 * Get words distribution for training mode.
 * Returns weighted selection: 50% weak, 30% medium, 20% strong.
 */
export function selectTrainingWords(
    words: Array<{ wordId: number; status: string; wrongCount: number; correctCount: number }>,
    count: number
): Array<{ wordId: number; status: string }> {
    const weak = words.filter(w => w.status === 'learning' || w.wrongCount > w.correctCount);
    const medium = words.filter(w => w.status === 'reviewing');
    const strong = words.filter(w => w.status === 'mastered');

    const result: Array<{ wordId: number; status: string }> = [];

    // Fill 50% from weak
    const weakCount = Math.ceil(count * 0.5);
    result.push(...shuffle(weak).slice(0, weakCount).map(w => ({ wordId: w.wordId, status: w.status })));

    // Fill 30% from medium
    const mediumCount = Math.ceil(count * 0.3);
    result.push(...shuffle(medium).slice(0, mediumCount).map(w => ({ wordId: w.wordId, status: w.status })));

    // Fill 20% from strong
    const strongCount = Math.ceil(count * 0.2);
    result.push(...shuffle(strong).slice(0, strongCount).map(w => ({ wordId: w.wordId, status: w.status })));

    // If any bucket is empty, fill from remaining words
    const selectedIds = new Set(result.map(r => r.wordId));
    for (const w of words) {
        if (result.length >= count) break;
        if (!selectedIds.has(w.wordId)) {
            result.push({ wordId: w.wordId, status: w.status });
        }
    }

    return shuffle(result).slice(0, count);
}

function shuffle<T>(array: T[]): T[] {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}
