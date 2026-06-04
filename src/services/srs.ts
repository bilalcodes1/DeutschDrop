// =====================================================
// Spaced Repetition System (SM-2 Algorithm)
// =====================================================

const REVIEW_INTERVALS_DAYS = [1, 3, 7, 14, 30, 90, 180];

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
        interval = 0;
        // Reduce ease factor
        easeFactor = Math.max(1.3, easeFactor - 0.2);
        return buildOutput(easeFactor, interval, repetitions, 'learning', 'hour');
    }

    // Adjust ease factor based on difficulty rating
    if (difficulty === 'easy') {
        easeFactor += 0.15;
    } else if (difficulty === 'hard') {
        easeFactor -= 0.15;
    }
    easeFactor = Math.max(1.3, easeFactor);

    repetitions += 1;

    interval = REVIEW_INTERVALS_DAYS[Math.min(repetitions - 1, REVIEW_INTERVALS_DAYS.length - 1)];

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
    status: 'new' | 'learning' | 'reviewing' | 'mastered',
    delay: 'day' | 'hour' = 'day'
): SrsOutput {
    const now = new Date();
    const nextReview = new Date(now);
    if (delay === 'hour') {
        nextReview.setHours(now.getHours() + 1);
    } else {
        nextReview.setDate(now.getDate() + interval);
    }

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
export type TrainingSelectionMode = 'mixed' | 'typing' | 'missing' | 'de_ar' | 'ar_de' | 'hard' | 'exam' | 'plan' | 'review';

export interface TrainingWordCandidate {
    wordId: number;
    status: string;
    wrongCount: number;
    correctCount: number;
    nextReview?: string | null;
}

export interface SelectedTrainingWord {
    wordId: number;
    status: string;
    reason: 'due' | 'hard' | 'wrong' | 'new' | 'exam' | 'fallback' | 'repeat';
}

export function selectTrainingWords(
    words: TrainingWordCandidate[],
    count: number,
    mode: TrainingSelectionMode = 'mixed'
): SelectedTrainingWord[] {
    if (count <= 0 || words.length === 0) return [];

    const result: SelectedTrainingWord[] = [];
    const selectedIds = new Set<number>();
    const now = Date.now();

    const addBucket = (bucket: TrainingWordCandidate[], reason: SelectedTrainingWord['reason'], limit: number): void => {
        for (const word of shuffle(bucket)) {
            if (result.length >= count || result.filter(item => item.reason === reason).length >= limit) break;
            if (selectedIds.has(word.wordId)) continue;
            selectedIds.add(word.wordId);
            result.push({ wordId: word.wordId, status: word.status, reason });
        }
    };

    const due = words.filter(w => w.nextReview && new Date(w.nextReview).getTime() <= now);
    const hard = words.filter(isHardWord);
    const wrong = words.filter(w => w.wrongCount > 0 && !hard.some(h => h.wordId === w.wordId));
    const fresh = words.filter(w => w.status === 'new' || (w.correctCount === 0 && w.wrongCount === 0));
    const fallback = shuffle(words);

    if (mode === 'hard') {
        addBucket(hard, 'hard', count);
    } else if (mode === 'exam') {
        addBucket([...words].sort((a, b) => (b.wrongCount * 2 - b.correctCount) - (a.wrongCount * 2 - a.correctCount)), 'exam', count);
    } else if (mode === 'review' || mode === 'plan') {
        addBucket(due, 'due', Math.ceil(count * 0.7));
        addBucket(hard, 'hard', Math.ceil(count * 0.3));
    } else {
        addBucket(due, 'due', Math.ceil(count * 0.35));
        addBucket(hard, 'hard', Math.ceil(count * 0.25));
        addBucket(wrong, 'wrong', Math.ceil(count * 0.2));
        addBucket(fresh, 'new', Math.ceil(count * 0.25));
    }

    addBucket(fallback, 'fallback', count);

    if (result.length < count && words.length > 0) {
        const repeatPool = shuffle(result.length > 0
            ? result.map(item => words.find(word => word.wordId === item.wordId)).filter((word): word is TrainingWordCandidate => Boolean(word))
            : words);
        let i = 0;
        while (result.length < count) {
            const word = repeatPool[i % repeatPool.length];
            result.push({ wordId: word.wordId, status: word.status, reason: 'repeat' });
            i++;
        }
    }

    return shuffle(result).slice(0, count);
}

export function isHardWord(word: { wrongCount: number; correctCount: number; status: string }): boolean {
    return word.wrongCount >= 2 || word.wrongCount > word.correctCount || word.status === 'learning';
}

function shuffle<T>(array: T[]): T[] {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}
