import type { D1Database } from '@cloudflare/workers-types';
import type { Word } from '../models';
import { queryAll, queryOne, run } from '../db/queries';
import { addXp, getTotalXp } from './xpLevels';
import { getVisualForWord, type GameVisual } from './gameVisualService';

export const GAME_QUESTION_LIMIT = 10;
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
    prompt: string;
    visual: GameVisual;
    options: string[];
    correctAnswer: string;
    answered?: boolean;
    isCorrect?: boolean;
    userAnswer?: string;
}

export interface GameSessionData {
    collectionTitle: string;
    totalQuestions: number;
    currentIndex: number;
    correctCount: number;
    wrongCount: number;
    streak: number;
    bestStreak: number;
    questions: GameQuestion[];
    startedAt: string;
    finishedAt?: string;
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
    wordId: number;
    prompt: string;
    visual: GameVisual;
    options: string[];
}

export interface PublicGameState {
    collectionTitle: string;
    totalQuestions: number;
    currentIndex: number;
    correctCount: number;
    wrongCount: number;
    finished: boolean;
    xpAwarded: boolean;
    xpGained: number;
    question: PublicGameQuestion | null;
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

    const questions = await buildQuestions(db, words);
    const data: GameSessionData = {
        collectionTitle: collection.title,
        totalQuestions: questions.length,
        currentIndex: 0,
        correctCount: 0,
        wrongCount: 0,
        streak: 0,
        bestStreak: 0,
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

export async function answerGameQuestion(db: D1Database, token: string, questionIndex: number, answer: string): Promise<PublicGameState & { correct: boolean; correctAnswer: string }> {
    const session = await requireValidSession(db, token);
    if (session.finished === 1) {
        const state = toPublicState(session);
        return { ...state, correct: false, correctAnswer: '' };
    }

    const data = parseSessionData(session);
    if (questionIndex !== data.currentIndex) throw new Error('question_mismatch');
    const question = data.questions[data.currentIndex];
    if (!question) throw new Error('question_not_found');

    const correct = normalizeAnswer(answer) === normalizeAnswer(question.correctAnswer);
    question.answered = true;
    question.userAnswer = answer;
    question.isCorrect = correct;
    if (correct) {
        data.correctCount += 1;
        data.streak += 1;
        data.bestStreak = Math.max(data.bestStreak, data.streak);
    } else {
        data.wrongCount += 1;
        data.streak = 0;
    }
    data.currentIndex += 1;

    const finished = data.currentIndex >= data.questions.length ? 1 : 0;
    if (finished) data.finishedAt = new Date().toISOString();
    await updateSessionData(db, session.token_hash, data, finished, session.xp_awarded);

    const updated: GameSessionRecord = { ...session, session_data: JSON.stringify(data), finished };
    return { ...toPublicState(updated), correct, correctAnswer: question.correctAnswer };
}

export async function finishGameSession(db: D1Database, token: string): Promise<PublicGameState> {
    const session = await requireValidSession(db, token);
    const data = parseSessionData(session);
    if (data.currentIndex < data.questions.length && session.finished !== 1) {
        data.finishedAt = new Date().toISOString();
    }

    if (session.xp_awarded === 1) {
        return toPublicState(session);
    }

    const xpBase = calculateGameXp(data.correctCount, data.bestStreak);
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

export function calculateGameXp(correctCount: number, bestStreak: number): number {
    return Math.min(20, Math.max(0, correctCount) + Math.floor(Math.max(0, bestStreak) / 3));
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
    const questionWords = words.slice(0, GAME_QUESTION_LIMIT);
    const germanOptions = questionWords.map(word => word.german);
    const questions: GameQuestion[] = [];
    for (const [index, word] of questionWords.entries()) {
        const options = buildOptions(word.german, germanOptions);
        questions.push({
            questionIndex: index,
            wordId: word.word_id,
            prompt: word.arabic,
            visual: await getVisualForWord(db, word),
            options,
            correctAnswer: word.german,
        });
    }
    return questions;
}

function buildOptions(correct: string, allOptions: string[]): string[] {
    const unique = Array.from(new Set([correct, ...allOptions.filter(option => option !== correct)]));
    const selected = unique.slice(0, Math.min(4, unique.length));
    const offset = Math.abs(hashString(correct)) % Math.max(1, selected.length);
    return [...selected.slice(offset), ...selected.slice(0, offset)];
}

function toPublicState(session: GameSessionRecord): PublicGameState {
    const data = parseSessionData(session);
    const question = session.finished === 1 ? null : data.questions[data.currentIndex] ?? null;
    return {
        collectionTitle: data.collectionTitle,
        totalQuestions: data.totalQuestions,
        currentIndex: Math.min(data.currentIndex, data.totalQuestions),
        correctCount: data.correctCount,
        wrongCount: data.wrongCount,
        finished: session.finished === 1 || data.currentIndex >= data.totalQuestions,
        xpAwarded: session.xp_awarded === 1,
        xpGained: data.xpGained ?? 0,
        question: question ? publicQuestion(question) : null,
    };
}

function publicQuestion(question: GameQuestion): PublicGameQuestion {
    return {
        questionIndex: question.questionIndex,
        wordId: question.wordId,
        prompt: question.prompt,
        visual: question.visual,
        options: question.options,
    };
}

function parseSessionData(session: GameSessionRecord): GameSessionData {
    return JSON.parse(session.session_data) as GameSessionData;
}

async function updateSessionData(db: D1Database, tokenHash: string, data: GameSessionData, finished: number, xpAwarded: number): Promise<void> {
    await run(
        db,
        `UPDATE game_sessions SET session_data = ?, finished = ?, xp_awarded = ? WHERE token_hash = ?`,
        [JSON.stringify(data), finished, xpAwarded, tokenHash]
    );
}

function normalizeAnswer(answer: string): string {
    return answer.trim().replace(/\s+/g, ' ').toLocaleLowerCase('de-DE');
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

function hashString(value: string): number {
    let hash = 0;
    for (let index = 0; index < value.length; index++) {
        hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
    }
    return hash;
}
