import type { D1Database } from '@cloudflare/workers-types';
import type { Word } from '../models';
import { queryAll, queryOne, run } from '../db/queries';
import { addXp, getTotalXp } from './xpLevels';
import { getRequiredVisualForWord, type GameVisual } from './gameVisualService';

export const GAME_QUESTION_LIMIT = 100;
export const GAME_UI_VERSION = 'speech-rocket-emoji-v2';
export const GAME_MAX_ATTEMPTS = 3;
const GAME_SESSION_TTL_MINUTES = 30;

export interface PlayableCollection {
    id: number;
    owner_user_id: number;
    title: string;
    description: string | null;
    visibility: 'public' | 'private';
    owner_name: string | null;
    word_count: number;
}

export interface GameQuestion {
    questionIndex: number;
    wordId: number;
    visual: GameVisual;
    correctAnswer: string;
    answered?: boolean;
    isCorrect?: boolean;
    attemptsMade?: number;
    transcript?: string;
    alternatives?: string[];
    answerReason?: string;
}

export interface GameSessionData {
    mode: 'speech_rocket';
    speechLang: 'de-DE';
    collectionTitle: string;
    totalQuestions: number;
    totalWords: number;
    currentIndex: number;
    correctCount: number;
    completedWords: number;
    wrongCount: number;
    failedAttempts: number;
    attemptsByWord: Record<string, number>;
    streak: number;
    bestStreak: number;
    heightMeters: number;
    score: number;
    gameOver: boolean;
    gameWon: boolean;
    questions: GameQuestion[];
    startedAt: string;
    finishedAt?: string;
    failedQuestion?: GameQuestion;
    xpGained?: number;
}

export interface GameSessionRecord {
    token_hash: string;
    user_id: number;
    collection_id: number;
    session_data: string;
    finished: number;
    xp_awarded: number;
    created_at: string;
    expires_at: string;
}

export interface PublicGameQuestion {
    questionIndex: number;
    visualEmoji: string;
    attemptsLeft: number;
    timeLimit: number;
    timeLimitSeconds: number;
}

export interface PublicGameState {
    mode: 'speech_rocket';
    speechLang: 'de-DE';
    collectionTitle: string;
    totalQuestions: number;
    totalWords: number;
    currentIndex: number;
    correctCount: number;
    completedWords: number;
    wrongCount: number;
    failedAttempts: number;
    attemptsUsed: number;
    score: number;
    heightMeters: number;
    gameOver: boolean;
    gameWon: boolean;
    finished: boolean;
    xpAwarded: boolean;
    xpGained: number;
    currentQuestion: PublicGameQuestion | null;
    failedQuestion?: {
        failedVisualEmoji: string;
        correctAnswer: string;
        correctPronunciationText: string;
        heightMeters: number;
    };
}

export class MissingGameVisualError extends Error {
    constructor(
        public readonly word: Pick<Word, 'word_id' | 'german' | 'arabic'>,
        public readonly collectionId: number
    ) {
        super('missing_visual');
    }
}

export async function countPlayableGameCollections(db: D1Database, userId: number): Promise<number> {
    const row = await queryOne<{ count: number }>(
        db,
        `SELECT COUNT(*) AS count
         FROM (
            SELECT c.id
            FROM word_collections c
            INNER JOIN users u ON u.user_id = c.owner_user_id
            INNER JOIN word_collection_items i ON i.collection_id = c.id
            WHERE c.is_deleted = 0
              AND COALESCE(u.is_banned, 0) = 0
              AND COALESCE(u.is_deleted, 0) = 0
              AND (c.owner_user_id = ? OR c.visibility = 'public')
            GROUP BY c.id
            HAVING COUNT(i.word_id) > 0
         ) playable`,
        [userId]
    );
    return row?.count ?? 0;
}

export async function getPlayableGameCollections(db: D1Database, userId: number, limit: number, offset: number): Promise<PlayableCollection[]> {
    return queryAll<PlayableCollection>(
        db,
        `SELECT c.id,
                c.owner_user_id,
                c.title,
                c.description,
                c.visibility,
                COALESCE(u.display_name, u.name) AS owner_name,
                COUNT(i.word_id) AS word_count
         FROM word_collections c
         INNER JOIN users u ON u.user_id = c.owner_user_id
         INNER JOIN word_collection_items i ON i.collection_id = c.id
         WHERE c.is_deleted = 0
           AND COALESCE(u.is_banned, 0) = 0
           AND COALESCE(u.is_deleted, 0) = 0
           AND (c.owner_user_id = ? OR c.visibility = 'public')
         GROUP BY c.id
         HAVING COUNT(i.word_id) > 0
         ORDER BY CASE WHEN c.owner_user_id = ? THEN 0 ELSE 1 END, c.updated_at DESC, c.id DESC
         LIMIT ? OFFSET ?`,
        [userId, userId, limit, offset]
    );
}

export async function canUseCollectionForGame(db: D1Database, userId: number, collectionId: number): Promise<PlayableCollection | null> {
    return queryOne<PlayableCollection>(
        db,
        `SELECT c.id,
                c.owner_user_id,
                c.title,
                c.description,
                c.visibility,
                COALESCE(u.display_name, u.name) AS owner_name,
                COUNT(i.word_id) AS word_count
         FROM word_collections c
         INNER JOIN users u ON u.user_id = c.owner_user_id
         LEFT JOIN word_collection_items i ON i.collection_id = c.id
         WHERE c.id = ?
           AND c.is_deleted = 0
           AND COALESCE(u.is_banned, 0) = 0
           AND COALESCE(u.is_deleted, 0) = 0
           AND (c.owner_user_id = ? OR c.visibility = 'public')
         GROUP BY c.id`,
        [collectionId, userId]
    );
}

export async function createGameSession(db: D1Database, userId: number, collectionId: number): Promise<{ token: string; collection: PlayableCollection; totalQuestions: number }> {
    const collection = await canUseCollectionForGame(db, userId, collectionId);
    if (!collection) throw new Error('collection_not_allowed');
    if ((collection.word_count ?? 0) <= 0) throw new Error('collection_empty');

    const words = await getCollectionWordsForGame(db, userId, collectionId, GAME_QUESTION_LIMIT);
    if (words.length === 0) throw new Error('collection_empty');

    const missingVisuals = await findMissingVisualsForCollection(db, userId, collectionId, GAME_QUESTION_LIMIT);
    if (missingVisuals[0]) throw new MissingGameVisualError(missingVisuals[0], collectionId);

    const questions = await buildQuestions(db, words);
    const data: GameSessionData = {
        mode: 'speech_rocket',
        speechLang: 'de-DE',
        collectionTitle: collection.title,
        totalQuestions: questions.length,
        totalWords: questions.length,
        currentIndex: 0,
        correctCount: 0,
        completedWords: 0,
        wrongCount: 0,
        failedAttempts: 0,
        attemptsByWord: {},
        streak: 0,
        bestStreak: 0,
        heightMeters: 0,
        score: 0,
        gameOver: false,
        gameWon: false,
        questions,
        startedAt: new Date().toISOString(),
    };

    const token = createToken();
    const tokenHash = await hashToken(token);
    await run(
        db,
        `INSERT INTO game_sessions (token_hash, user_id, collection_id, session_data, finished, xp_awarded, expires_at)
         VALUES (?, ?, ?, ?, 0, 0, datetime('now', '+${GAME_SESSION_TTL_MINUTES} minutes'))`,
        [tokenHash, userId, collectionId, JSON.stringify(data)]
    );

    return { token, collection, totalQuestions: questions.length };
}

export async function getPublicGameState(db: D1Database, token: string): Promise<PublicGameState> {
    const session = await requireValidSession(db, token);
    return toPublicState(session);
}

export async function answerGameQuestion(
    db: D1Database,
    token: string,
    questionIndex: number,
    transcript: string,
    alternatives: string[] = [],
    answerReason = 'speech'
): Promise<PublicGameState & { correct: boolean; tryAgain?: boolean; attemptsLeft?: number; correctAnswer?: string }> {
    const session = await requireValidSession(db, token);
    if (session.finished === 1) {
        const state = toPublicState(session);
        return { ...state, correct: false, correctAnswer: state.failedQuestion?.correctAnswer };
    }

    const data = parseSessionData(session);
    normalizeGameData(data);
    if (questionIndex !== data.currentIndex) throw new Error('question_mismatch');
    const question = data.questions[data.currentIndex];
    if (!question) throw new Error('question_not_found');

    const spokenAnswers = [transcript, ...alternatives].filter(Boolean);
    const correct = spokenAnswers.some(answer => isAcceptedGermanAnswer(answer, question.correctAnswer));
    question.attemptsMade = Math.min(GAME_MAX_ATTEMPTS, (question.attemptsMade ?? 0) + 1);
    data.attemptsByWord[String(question.wordId)] = question.attemptsMade;
    question.transcript = transcript;
    question.alternatives = alternatives.slice(0, 3);
    question.answerReason = answerReason.slice(0, 40);
    question.isCorrect = correct;
    if (correct) {
        question.answered = true;
        data.correctCount += 1;
        data.completedWords = data.correctCount;
        data.streak += 1;
        data.bestStreak = Math.max(data.bestStreak, data.streak);
        data.heightMeters += heightGainForCorrect(data.correctCount, data.streak);
        data.score = calculateGameScore(data.heightMeters, data.correctCount);
        data.currentIndex += 1;
        data.gameWon = data.currentIndex >= data.questions.length;
    } else {
        data.wrongCount += 1;
        data.failedAttempts += 1;
        const attemptsLeft = Math.max(0, GAME_MAX_ATTEMPTS - question.attemptsMade);
        if (attemptsLeft > 0) {
            await updateSessionData(db, session.token_hash, data, 0, session.xp_awarded);
            const updated: GameSessionRecord = { ...session, session_data: JSON.stringify(data), finished: 0 };
            return {
                ...toPublicState(updated),
                correct: false,
                tryAgain: true,
                attemptsLeft,
            };
        }

        question.answered = true;
        data.streak = 0;
        data.gameOver = true;
        data.gameWon = false;
        data.failedQuestion = question;
        data.finishedAt = new Date().toISOString();
    }

    const finished = data.gameOver || data.currentIndex >= data.questions.length ? 1 : 0;
    if (data.currentIndex >= data.questions.length && !data.gameOver) data.gameWon = true;
    if (finished) data.finishedAt = new Date().toISOString();
    await updateSessionData(db, session.token_hash, data, finished, session.xp_awarded);

    const updated: GameSessionRecord = { ...session, session_data: JSON.stringify(data), finished };
    return {
        ...toPublicState(updated),
        correct,
        ...(correct ? {} : { correctAnswer: question.correctAnswer }),
    };
}

export async function restartGameSession(db: D1Database, token: string): Promise<{ token: string; totalQuestions: number }> {
    const session = await requireValidSession(db, token);
    const data = parseSessionData(session);
    normalizeGameData(data);
    const isTerminal = session.finished === 1 || data.gameOver || data.currentIndex >= data.totalQuestions;
    if (isTerminal && session.xp_awarded === 0) {
        await finishGameSession(db, token);
    } else if (!isTerminal && session.xp_awarded === 0) {
        data.finishedAt = new Date().toISOString();
        data.xpGained = 0;
        await updateSessionData(db, session.token_hash, data, 1, 1);
    }
    const next = await createGameSession(db, session.user_id, session.collection_id);
    return { token: next.token, totalQuestions: next.totalQuestions };
}

export async function finishGameSession(db: D1Database, token: string): Promise<PublicGameState> {
    const session = await requireValidSession(db, token);
    const data = parseSessionData(session);
    normalizeGameData(data);
    if (data.currentIndex < data.questions.length && session.finished !== 1) {
        data.finishedAt = new Date().toISOString();
    }

    if (session.xp_awarded === 1) {
        return toPublicState(session);
    }

    const completedWords = data.completedWords ?? data.correctCount;
    const xpBase = calculateGameXp(completedWords, data.heightMeters);
    let xpGained = 0;
    const claimed = await run(
        db,
        `UPDATE game_sessions
         SET finished = 1, xp_awarded = 1, session_data = ?
         WHERE token_hash = ? AND xp_awarded = 0`,
        [JSON.stringify(data), session.token_hash]
    );

    if (getChanges(claimed) > 0 && xpBase > 0) {
        const before = await getTotalXp(db, session.user_id);
        await addXp(db, session.user_id, xpBase, {
            reason: 'collection_game',
            sourceType: 'collection_game',
            sourceId: String(session.collection_id),
            metadata: {
                collection_id: session.collection_id,
                correct_count: data.correctCount,
                total_count: data.totalQuestions,
                total_words: data.totalWords ?? data.totalQuestions,
                completed_words: completedWords,
                failed_word_id: data.failedQuestion?.wordId ?? null,
                height_meters: data.heightMeters,
                score: calculateGameScore(data.heightMeters, data.correctCount),
                attempts_used: Object.values(data.attemptsByWord ?? {}).reduce((sum, value) => sum + Number(value || 0), 0),
                mode: 'speech_rocket',
                game_session: session.token_hash,
            },
            allowDailyCap: true,
        });
        const after = await getTotalXp(db, session.user_id);
        xpGained = Math.max(0, after - before);
    }

    data.xpGained = xpGained;
    data.finishedAt = data.finishedAt ?? new Date().toISOString();
    await updateSessionData(db, session.token_hash, data, 1, 1);
    return toPublicState({ ...session, session_data: JSON.stringify(data), finished: 1, xp_awarded: 1 });
}

export async function getCollectionWordsForGame(db: D1Database, userId: number, collectionId: number, limit = GAME_QUESTION_LIMIT): Promise<Word[]> {
    return queryAll<Word>(
        db,
        `SELECT w.*
         FROM word_collection_items i
         INNER JOIN word_collections c ON c.id = i.collection_id
         INNER JOIN users u ON u.user_id = c.owner_user_id
         INNER JOIN words w ON w.word_id = i.word_id
         WHERE i.collection_id = ?
           AND c.is_deleted = 0
           AND COALESCE(u.is_banned, 0) = 0
           AND COALESCE(u.is_deleted, 0) = 0
           AND (c.owner_user_id = ? OR c.visibility = 'public')
         ORDER BY i.position ASC, i.id ASC
         LIMIT ?`,
        [collectionId, userId, Math.max(1, Math.min(GAME_QUESTION_LIMIT, limit))]
    );
}

export async function findMissingVisualsForCollection(db: D1Database, userId: number, collectionId: number, limit = GAME_QUESTION_LIMIT): Promise<Word[]> {
    const words = await getCollectionWordsForGame(db, userId, collectionId, limit);
    const missing: Word[] = [];
    for (const word of words) {
        const visual = await getRequiredVisualForWord(db, word);
        if (!visual) missing.push(word);
    }
    return missing;
}

export function calculateGameXp(completedWords: number, heightMeters: number): number {
    const safeCompleted = Math.max(0, completedWords);
    const heightBonus = Math.floor(Math.max(0, heightMeters) / 600);
    return Math.min(20, safeCompleted + Math.floor(safeCompleted / 5) + heightBonus);
}

async function requireValidSession(db: D1Database, token: string): Promise<GameSessionRecord> {
    if (!token) throw new Error('missing_token');
    const tokenHash = await hashToken(token);
    const session = await queryOne<GameSessionRecord>(
        db,
        `SELECT * FROM game_sessions WHERE token_hash = ?`,
        [tokenHash]
    );
    if (!session) throw new Error('invalid_token');
    const expiresAt = new Date(session.expires_at).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error('expired_token');
    return session;
}

async function buildQuestions(db: D1Database, words: Word[]): Promise<GameQuestion[]> {
    const questions: GameQuestion[] = [];
    for (const [index, word] of words.entries()) {
        const visual = await getRequiredVisualForWord(db, word);
        if (!visual) throw new MissingGameVisualError(word, 0);
        questions.push({
            questionIndex: index,
            wordId: word.word_id,
            visual,
            correctAnswer: word.german,
        });
    }
    return questions;
}

function toPublicState(session: GameSessionRecord): PublicGameState {
    const data = parseSessionData(session);
    normalizeGameData(data);
    const question = session.finished === 1 || data.gameOver ? null : data.questions[data.currentIndex] ?? null;
    const completedWords = data.completedWords ?? data.correctCount;
    const totalWords = data.totalWords ?? data.totalQuestions;
    const score = data.score ?? calculateGameScore(data.heightMeters, data.correctCount);
    return {
        mode: 'speech_rocket',
        speechLang: 'de-DE',
        collectionTitle: data.collectionTitle,
        totalQuestions: data.totalQuestions,
        totalWords,
        currentIndex: Math.min(data.currentIndex, data.totalQuestions),
        correctCount: data.correctCount,
        completedWords,
        wrongCount: data.wrongCount,
        failedAttempts: data.failedAttempts ?? data.wrongCount,
        attemptsUsed: Object.values(data.attemptsByWord ?? {}).reduce((sum, value) => sum + Number(value || 0), 0),
        score,
        heightMeters: data.heightMeters,
        gameOver: data.gameOver,
        gameWon: data.gameWon ?? (!data.gameOver && data.currentIndex >= data.questions.length),
        finished: session.finished === 1 || data.gameOver || data.currentIndex >= data.totalQuestions,
        xpAwarded: session.xp_awarded === 1,
        xpGained: data.xpGained ?? 0,
        currentQuestion: question ? publicQuestion(question) : null,
        failedQuestion: data.failedQuestion
            ? {
                failedVisualEmoji: data.failedQuestion.visual.value,
                correctAnswer: data.failedQuestion.correctAnswer,
                correctPronunciationText: data.failedQuestion.correctAnswer,
                heightMeters: data.heightMeters,
            }
            : undefined,
    };
}

function publicQuestion(question: GameQuestion): PublicGameQuestion {
    const timeLimit = timeLimitForQuestion(question.questionIndex);
    return {
        questionIndex: question.questionIndex,
        visualEmoji: question.visual.value,
        attemptsLeft: Math.max(0, GAME_MAX_ATTEMPTS - (question.attemptsMade ?? 0)),
        timeLimit,
        timeLimitSeconds: timeLimit,
    };
}

function parseSessionData(session: GameSessionRecord): GameSessionData {
    return JSON.parse(session.session_data) as GameSessionData;
}

function normalizeGameData(data: GameSessionData): void {
    data.totalWords = data.totalWords ?? data.totalQuestions;
    data.completedWords = data.completedWords ?? data.correctCount;
    data.failedAttempts = data.failedAttempts ?? data.wrongCount ?? 0;
    data.attemptsByWord = data.attemptsByWord ?? {};
    data.score = data.score ?? calculateGameScore(data.heightMeters, data.correctCount);
    data.gameWon = data.gameWon ?? (!data.gameOver && data.currentIndex >= data.questions.length);
}

async function updateSessionData(db: D1Database, tokenHash: string, data: GameSessionData, finished: number, xpAwarded: number): Promise<void> {
    await run(
        db,
        `UPDATE game_sessions SET session_data = ?, finished = ?, xp_awarded = ? WHERE token_hash = ?`,
        [JSON.stringify(data), finished, xpAwarded, tokenHash]
    );
}

export function isAcceptedGermanAnswer(answer: string, correctAnswer: string): boolean {
    const normalizedAnswer = normalizeGermanSpeechAnswer(answer);
    const normalizedCorrect = normalizeGermanSpeechAnswer(correctAnswer);
    const correctWithoutArticle = stripGermanArticle(normalizedCorrect);
    return normalizedAnswer === normalizedCorrect || normalizedAnswer === correctWithoutArticle;
}

export function normalizeGermanSpeechAnswer(answer: string): string {
    return answer
        .trim()
        .replace(/[!?.,;:،؟]/g, ' ')
        .replace(/\s+/g, ' ')
        .toLocaleLowerCase('de-DE')
        .replace(/ä/g, 'ae')
        .replace(/ö/g, 'oe')
        .replace(/ü/g, 'ue')
        .replace(/ß/g, 'ss');
}

function stripGermanArticle(value: string): string {
    return value.replace(/^(der|die|das)\s+/i, '').trim();
}

function heightGainForCorrect(correctCount: number, streak: number): number {
    return 60 + Math.floor(correctCount / 3) * 10 + Math.floor(streak / 3) * 5;
}

function timeLimitForQuestion(questionIndex: number): number {
    return Math.max(7, 10 - Math.floor(questionIndex / 3));
}

function calculateGameScore(heightMeters: number, correctCount: number): number {
    return Math.max(0, heightMeters) + Math.max(0, correctCount) * 10;
}

function createToken(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return base64Url(bytes);
}

async function hashToken(token: string): Promise<string> {
    const bytes = new TextEncoder().encode(token);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function base64Url(bytes: Uint8Array): string {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function getChanges(result: { meta?: unknown }): number {
    return (result.meta as { changes?: number } | undefined)?.changes ?? 0;
}
