import type { D1Database, ExecutionContext } from '@cloudflare/workers-types';
import type { Env, User, Word } from '../models';
import { queryAll, queryOne, run } from '../db/queries';
import { addXp, getTotalXp } from './xpLevels';
import { getVisualForWord, getRequiredVisualForWord, type GameVisual } from './gameVisualService';
import { pickWinnerByScoreAndDuration } from '../repositories/challengeRepository';
import { displayUserName, sendTelegramMessage, sendTemporaryTelegramMessage } from './notifications';

export const GAME_NOTIFICATION_DELETE_AFTER_SECONDS = 10;
export const GAME_QUESTION_LIMIT = 100;
export const GAME_UI_VERSION = 'underwater-worm-v2';
export const GAME_MAX_ATTEMPTS = 3;
const GAME_NO_SPEECH_GRACE_COUNT = 1;
const GAME_SESSION_TTL_MINUTES = 30;
const GAME_CHALLENGE_TTL_HOURS = 24;

export type GameChallengeSourceType = 'mine' | 'opponent' | 'mixed';
export type GameChallengeRole = 'creator' | 'opponent';

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
    arabicMeaning: string;
    correctAnswer: string;
    answered?: boolean;
    isCorrect?: boolean;
    attemptsMade?: number;
    noSpeechCount?: number;
    transcript?: string;
    interimTranscript?: string;
    alternatives?: string[];
    confidence?: number;
    answerReason?: string;
}

export interface GameSessionData {
    mode: 'speech_rocket';
    speechLang: 'de-DE';
    collectionTitle: string;
    challengeId?: number;
    challengeRole?: GameChallengeRole;
    opponentUserId?: number;
    challengeSourceType?: GameChallengeSourceType;
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
    finishReason?: string;
    finishNotificationSent?: boolean;
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

export interface GameChallengeRecord {
    challenge_id: number;
    creator_user_id: number;
    opponent_user_id: number;
    source_type: GameChallengeSourceType;
    collection_id: number | null;
    collection_title: string | null;
    word_ids_json: string;
    question_count: number;
    status: 'pending' | 'in_progress' | 'completed' | 'expired' | 'cancelled';
    created_at: string;
    expires_at: string;
    completed_at: string | null;
    creator_session_hash: string | null;
    opponent_session_hash: string | null;
    creator_score: number;
    opponent_score: number;
    creator_completed_words: number;
    opponent_completed_words: number;
    creator_height_meters: number;
    opponent_height_meters: number;
    creator_duration_ms: number | null;
    opponent_duration_ms: number | null;
    creator_xp_gained: number;
    opponent_xp_gained: number;
    winner_user_id: number | null;
}

export interface PublicGameQuestion {
    questionIndex: number;
    visualEmoji: string;
    arabicMeaning: string;
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
    durationMs: number;
    isChallenge: boolean;
    currentQuestion: PublicGameQuestion | null;
    failedQuestion?: {
        failedVisualEmoji: string;
        failedArabicMeaning: string;
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
              AND c.owner_user_id = ?
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
           AND c.owner_user_id = ?
         GROUP BY c.id
         HAVING COUNT(i.word_id) > 0
         ORDER BY c.updated_at DESC, c.id DESC
         LIMIT ? OFFSET ?`,
        [userId, limit, offset]
    );
}

export async function countOwnGameCollections(db: D1Database, userId: number): Promise<number> {
    const row = await queryOne<{ count: number }>(
        db,
        `SELECT COUNT(*) AS count
         FROM word_collections
         WHERE owner_user_id = ? AND is_deleted = 0`,
        [userId]
    );
    return row?.count ?? 0;
}

export async function countOpponentPublicGameCollections(db: D1Database, opponentUserId: number): Promise<number> {
    const row = await queryOne<{ count: number }>(
        db,
        `SELECT COUNT(*) AS count
         FROM (
            SELECT c.id
            FROM word_collections c
            INNER JOIN users u ON u.user_id = c.owner_user_id
            INNER JOIN word_collection_items i ON i.collection_id = c.id
            WHERE c.owner_user_id = ?
              AND c.visibility = 'public'
              AND c.is_deleted = 0
              AND COALESCE(u.is_banned, 0) = 0
              AND COALESCE(u.is_deleted, 0) = 0
            GROUP BY c.id
            HAVING COUNT(i.word_id) > 0
         ) playable`,
        [opponentUserId]
    );
    return row?.count ?? 0;
}

export async function getOpponentPublicGameCollections(db: D1Database, opponentUserId: number, limit: number, offset: number): Promise<PlayableCollection[]> {
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
         WHERE c.owner_user_id = ?
           AND c.visibility = 'public'
           AND c.is_deleted = 0
           AND COALESCE(u.is_banned, 0) = 0
           AND COALESCE(u.is_deleted, 0) = 0
         GROUP BY c.id
         HAVING COUNT(i.word_id) > 0
         ORDER BY c.updated_at DESC, c.id DESC
         LIMIT ? OFFSET ?`,
        [opponentUserId, limit, offset]
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
           AND c.owner_user_id = ?
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

    return createGameSessionFromWords(db, userId, collection, words);
}

async function createGameSessionFromWords(
    db: D1Database,
    userId: number,
    collection: PlayableCollection,
    words: Word[],
    challenge?: { challengeId: number; role: GameChallengeRole; opponentUserId: number; sourceType: GameChallengeSourceType }
): Promise<{ token: string; tokenHash: string; collection: PlayableCollection; totalQuestions: number }> {
    const questions = await buildQuestions(db, words);
    const data: GameSessionData = {
        mode: 'speech_rocket',
        speechLang: 'de-DE',
        collectionTitle: collection.title,
        challengeId: challenge?.challengeId,
        challengeRole: challenge?.role,
        opponentUserId: challenge?.opponentUserId,
        challengeSourceType: challenge?.sourceType,
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
        [tokenHash, userId, collection.id, JSON.stringify(data)]
    );

    return { token, tokenHash, collection, totalQuestions: questions.length };
}

export async function getPublicGameState(db: D1Database, token: string): Promise<PublicGameState> {
    const session = await requireValidSession(db, token);
    return toPublicState(session);
}

export async function createGameChallenge(
    db: D1Database,
    creatorUserId: number,
    opponentUserId: number,
    sourceType: GameChallengeSourceType,
    collectionId: number
): Promise<{ challengeId: number; collection: PlayableCollection; opponent: Pick<User, 'user_id' | 'telegram_id' | 'display_name' | 'name'>; totalQuestions: number }> {
    const opponent = await queryOne<Pick<User, 'user_id' | 'telegram_id' | 'display_name' | 'name' | 'is_banned' | 'is_deleted'>>(
        db,
        `SELECT user_id, telegram_id, display_name, name, COALESCE(is_banned, 0) AS is_banned, COALESCE(is_deleted, 0) AS is_deleted
         FROM users
         WHERE user_id = ? AND display_name IS NOT NULL`,
        [opponentUserId]
    );
    if (!opponent || opponent.user_id === creatorUserId || opponent.is_banned || opponent.is_deleted) {
        throw new Error('game_challenge_opponent_unavailable');
    }

    const collection = sourceType === 'opponent'
        ? await canUseOpponentCollectionForGame(db, opponentUserId, collectionId)
        : await canUseCollectionForGame(db, creatorUserId, collectionId);
    if (!collection) throw new Error('collection_not_allowed');
    if ((collection.word_count ?? 0) <= 0) throw new Error('collection_empty');

    const words = sourceType === 'mixed'
        ? await getMixedGameChallengeWords(db, creatorUserId, opponentUserId, collectionId)
        : await getCollectionWordsForGameByCollectionOwner(db, collection.owner_user_id, collectionId, GAME_QUESTION_LIMIT);
    const selected = capGameWords(shuffle(words));
    if (selected.length === 0) throw new Error('collection_empty');
    const result = await run(
        db,
        `INSERT INTO game_challenges (
            creator_user_id, opponent_user_id, source_type, collection_id, collection_title,
            word_ids_json, question_count, status, expires_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now', '+${GAME_CHALLENGE_TTL_HOURS} hours'))`,
        [
            creatorUserId,
            opponentUserId,
            sourceType,
            collection.id,
            collection.title,
            JSON.stringify(selected.map(word => word.word_id)),
            selected.length,
        ]
    );
    const challengeId = (result.meta as { last_row_id?: number })?.last_row_id ?? 0;
    return { challengeId, collection, opponent, totalQuestions: selected.length };
}

export async function startGameChallengeForUser(
    db: D1Database,
    challengeId: number,
    userId: number
): Promise<{ token: string; collectionTitle: string; challenge: GameChallengeRecord; role: GameChallengeRole; totalQuestions: number }> {
    const challenge = await getGameChallenge(db, challengeId);
    if (!challenge || !['pending', 'in_progress'].includes(challenge.status)) throw new Error('game_challenge_unavailable');
    if (new Date(challenge.expires_at).getTime() <= Date.now()) throw new Error('expired_token');

    const role: GameChallengeRole | null = challenge.creator_user_id === userId
        ? 'creator'
        : challenge.opponent_user_id === userId
            ? 'opponent'
            : null;
    if (!role) throw new Error('game_challenge_unavailable');
    if (role === 'creator' && challenge.creator_duration_ms !== null) throw new Error('game_challenge_completed');
    if (role === 'opponent' && challenge.opponent_duration_ms !== null) throw new Error('game_challenge_completed');

    const wordIds = parseWordIds(challenge.word_ids_json);
    const words = await getWordsByIdsForGame(db, wordIds);
    if (words.length === 0) throw new Error('collection_empty');
    const collection: PlayableCollection = {
        id: challenge.collection_id ?? 0,
        owner_user_id: role === 'creator' ? challenge.creator_user_id : challenge.opponent_user_id,
        title: challenge.collection_title ?? 'تحدي دودة البحر',
        description: null,
        visibility: 'private',
        owner_name: null,
        word_count: words.length,
    };
    const opponentUserId = role === 'creator' ? challenge.opponent_user_id : challenge.creator_user_id;
    const session = await createGameSessionFromWords(db, userId, collection, words, {
        challengeId,
        role,
        opponentUserId,
        sourceType: challenge.source_type,
    });

    await run(
        db,
        role === 'creator'
            ? `UPDATE game_challenges SET creator_session_hash = ?, status = 'in_progress', updated_at = datetime('now') WHERE challenge_id = ?`
            : `UPDATE game_challenges SET opponent_session_hash = ?, status = 'in_progress', updated_at = datetime('now') WHERE challenge_id = ?`,
        [session.tokenHash, challengeId]
    );
    const updated = await getGameChallenge(db, challengeId);
    return { token: session.token, collectionTitle: collection.title, challenge: updated ?? challenge, role, totalQuestions: session.totalQuestions };
}

export async function answerGameQuestion(
    db: D1Database,
    token: string,
    questionIndex: number,
    transcript: string,
    alternatives: string[] = [],
    answerReason = 'speech',
    confidence?: number,
    interimTranscript = ''
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

    const spokenAnswers = [transcript, ...alternatives, interimTranscript].map(normalizeRawTranscript).filter(Boolean);
    const safeReason = answerReason.slice(0, 40);
    const isNoSpeech = spokenAnswers.length === 0 && (safeReason === 'no_speech' || safeReason === 'speech_error');
    const correct = spokenAnswers.some(answer => isAcceptedGermanAnswer(answer, question.correctAnswer));
    question.answerReason = safeReason;
    question.confidence = normalizeConfidence(confidence);
    question.interimTranscript = interimTranscript.slice(0, 120);
    if (isNoSpeech) {
        question.noSpeechCount = (question.noSpeechCount ?? 0) + 1;
        if (question.noSpeechCount <= GAME_NO_SPEECH_GRACE_COUNT) {
            await updateSessionData(db, session.token_hash, data, 0, session.xp_awarded);
            const updated: GameSessionRecord = { ...session, session_data: JSON.stringify(data), finished: 0 };
            return {
                ...toPublicState(updated),
                correct: false,
                tryAgain: true,
                attemptsLeft: Math.max(0, GAME_MAX_ATTEMPTS - (question.attemptsMade ?? 0)),
            };
        }
    }
    question.attemptsMade = Math.min(GAME_MAX_ATTEMPTS, (question.attemptsMade ?? 0) + 1);
    data.attemptsByWord[String(question.wordId)] = question.attemptsMade;
    question.transcript = transcript;
    question.alternatives = alternatives.slice(0, 3);
    question.isCorrect = correct;
    if (correct) question.noSpeechCount = 0;
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
    if (data.challengeId) throw new Error('restart_not_allowed');
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

export async function finishGameSession(db: D1Database, token: string, env?: Env, finishReason = 'unknown', ctx?: ExecutionContext): Promise<PublicGameState> {
    const session = await requireValidSession(db, token);
    const data = parseSessionData(session);
    normalizeGameData(data);
    if (data.currentIndex < data.questions.length && session.finished !== 1) {
        data.finishedAt = new Date().toISOString();
    }
    data.finishReason = sanitizeFinishReason(finishReason);

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
        const isChallenge = Boolean(data.challengeId);
        await addXp(db, session.user_id, xpBase, {
            reason: isChallenge ? 'collection_game_challenge' : 'collection_game',
            sourceType: isChallenge ? 'collection_game_challenge' : 'collection_game',
            sourceId: isChallenge ? String(data.challengeId) : String(session.collection_id),
            metadata: {
                challenge_id: data.challengeId ?? null,
                opponent_user_id: data.opponentUserId ?? null,
                source_type: data.challengeSourceType ?? null,
                collection_id: session.collection_id,
                correct_count: data.correctCount,
                total_count: data.totalQuestions,
                total_words: data.totalWords ?? data.totalQuestions,
                completed_words: completedWords,
                failed_word_id: data.failedQuestion?.wordId ?? null,
                height_meters: data.heightMeters,
                score: calculateGameScore(data.heightMeters, data.correctCount),
                duration_ms: calculateDurationMs(data.startedAt, data.finishedAt ?? new Date().toISOString()),
                finish_reason: data.finishReason,
                result: data.challengeId ? 'pending' : null,
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
    if (getChanges(claimed) > 0 && env) {
        data.finishNotificationSent = true;
    }
    await updateSessionData(db, session.token_hash, data, 1, 1);
    if (getChanges(claimed) > 0 && data.challengeId && data.challengeRole) {
        await submitGameChallengeSessionResult(db, env, session, data, xpGained, ctx);
    } else if (getChanges(claimed) > 0 && env) {
        await sendGameFinishNotification(db, env, session.user_id, data, xpGained, ctx);
    }
    return toPublicState({ ...session, session_data: JSON.stringify(data), finished: 1, xp_awarded: 1 });
}

export async function getCollectionWordsForGame(db: D1Database, userId: number, collectionId: number, limit = GAME_QUESTION_LIMIT): Promise<Word[]> {
    return getCollectionWordsForGameByCollectionOwner(db, userId, collectionId, limit);
}

async function getCollectionWordsForGameByCollectionOwner(db: D1Database, ownerUserId: number, collectionId: number, limit = GAME_QUESTION_LIMIT): Promise<Word[]> {
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
           AND c.owner_user_id = ?
         ORDER BY i.position ASC, i.id ASC
         LIMIT ?`,
        [collectionId, ownerUserId, Math.max(1, Math.min(GAME_QUESTION_LIMIT, limit))]
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

async function canUseOpponentCollectionForGame(db: D1Database, opponentUserId: number, collectionId: number): Promise<PlayableCollection | null> {
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
           AND c.owner_user_id = ?
           AND c.visibility = 'public'
           AND c.is_deleted = 0
           AND COALESCE(u.is_banned, 0) = 0
           AND COALESCE(u.is_deleted, 0) = 0
         GROUP BY c.id`,
        [collectionId, opponentUserId]
    );
}

async function getMixedGameChallengeWords(db: D1Database, creatorUserId: number, opponentUserId: number, collectionId: number): Promise<Word[]> {
    const creatorWords = await getCollectionWordsForGameByCollectionOwner(db, creatorUserId, collectionId, Math.ceil(GAME_QUESTION_LIMIT / 2));
    const opponentWords = await queryAll<Word>(
        db,
        `SELECT DISTINCT w.*
         FROM word_collections c
         INNER JOIN word_collection_items i ON i.collection_id = c.id
         INNER JOIN words w ON w.word_id = i.word_id
         INNER JOIN users u ON u.user_id = c.owner_user_id
         WHERE c.owner_user_id = ?
           AND c.visibility = 'public'
           AND c.is_deleted = 0
           AND COALESCE(u.is_banned, 0) = 0
           AND COALESCE(u.is_deleted, 0) = 0
         ORDER BY c.updated_at DESC, i.position ASC
         LIMIT ?`,
        [opponentUserId, Math.floor(GAME_QUESTION_LIMIT / 2)]
    );
    const selected = [...creatorWords, ...opponentWords];
    const seen = new Set<number>();
    return selected.filter(word => {
        if (seen.has(word.word_id)) return false;
        seen.add(word.word_id);
        return true;
    });
}

async function getWordsByIdsForGame(db: D1Database, wordIds: number[]): Promise<Word[]> {
    const ids = capGameIds(wordIds.filter(Number.isFinite));
    if (ids.length === 0) return [];
    const rows = await queryAll<Word>(
        db,
        `SELECT * FROM words WHERE word_id IN (${ids.map(() => '?').join(',')})`,
        ids
    );
    const byId = new Map(rows.map(word => [word.word_id, word]));
    return ids.map(id => byId.get(id)).filter((word): word is Word => Boolean(word));
}

async function assertWordsHaveVisuals(db: D1Database, words: Word[], collectionId: number): Promise<void> {
    for (const word of words) {
        const visual = await getRequiredVisualForWord(db, word);
        if (!visual) throw new MissingGameVisualError(word, collectionId);
    }
}

export async function getGameChallenge(db: D1Database, challengeId: number): Promise<GameChallengeRecord | null> {
    return queryOne<GameChallengeRecord>(db, 'SELECT * FROM game_challenges WHERE challenge_id = ?', [challengeId]);
}

async function submitGameChallengeSessionResult(
    db: D1Database,
    env: Env | undefined,
    session: GameSessionRecord,
    data: GameSessionData,
    xpGained: number,
    ctx?: ExecutionContext
): Promise<void> {
    if (!data.challengeId || !data.challengeRole) return;
    const score = calculateGameScore(data.heightMeters, data.correctCount);
    const durationMs = calculateDurationMs(data.startedAt, data.finishedAt ?? new Date().toISOString());
    const completedWords = data.completedWords ?? data.correctCount;
    if (data.challengeRole === 'creator') {
        await run(
            db,
            `UPDATE game_challenges
             SET creator_session_hash = COALESCE(creator_session_hash, ?),
                 creator_score = ?,
                 creator_completed_words = ?,
                 creator_height_meters = ?,
                 creator_duration_ms = ?,
                 creator_xp_gained = ?,
                 status = CASE WHEN opponent_duration_ms IS NULL THEN 'in_progress' ELSE status END,
                 updated_at = datetime('now')
             WHERE challenge_id = ? AND creator_user_id = ? AND creator_duration_ms IS NULL`,
            [session.token_hash, score, completedWords, data.heightMeters, durationMs, xpGained, data.challengeId, session.user_id]
        );
    } else {
        await run(
            db,
            `UPDATE game_challenges
             SET opponent_session_hash = COALESCE(opponent_session_hash, ?),
                 opponent_score = ?,
                 opponent_completed_words = ?,
                 opponent_height_meters = ?,
                 opponent_duration_ms = ?,
                 opponent_xp_gained = ?,
                 status = CASE WHEN creator_duration_ms IS NULL THEN 'in_progress' ELSE status END,
                 updated_at = datetime('now')
             WHERE challenge_id = ? AND opponent_user_id = ? AND opponent_duration_ms IS NULL`,
            [session.token_hash, score, completedWords, data.heightMeters, durationMs, xpGained, data.challengeId, session.user_id]
        );
    }

    const challenge = await getGameChallenge(db, data.challengeId);
    if (!challenge) return;
    if (challenge.creator_duration_ms !== null && challenge.opponent_duration_ms !== null && challenge.status !== 'completed') {
        const winnerId = pickWinnerByScoreAndDuration(
            challenge.creator_user_id,
            challenge.creator_score,
            challenge.creator_duration_ms,
            challenge.opponent_user_id,
            challenge.opponent_score,
            challenge.opponent_duration_ms
        );
        const completed = await run(
            db,
            `UPDATE game_challenges
             SET winner_user_id = ?, status = 'completed', completed_at = datetime('now'), updated_at = datetime('now')
             WHERE challenge_id = ? AND status != 'completed'`,
            [winnerId, challenge.challenge_id]
        );
        if (getChanges(completed) > 0 && env) {
            const finalChallenge = await getGameChallenge(db, challenge.challenge_id);
            if (finalChallenge) await announceGameChallengeResult(db, env, finalChallenge, ctx);
        }
    } else if (env) {
        await notifyGameChallengeWaiting(db, env, session.user_id, data, xpGained, ctx);
    }
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
        const visual = await getVisualForWord(db, word);
        questions.push({
            questionIndex: index,
            wordId: word.word_id,
            visual,
            arabicMeaning: word.arabic,
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
    const finishedAt = data.finishedAt ?? new Date().toISOString();
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
        durationMs: calculateDurationMs(data.startedAt, finishedAt),
        isChallenge: Boolean(data.challengeId),
        currentQuestion: question ? publicQuestion(question) : null,
        failedQuestion: data.failedQuestion
            ? {
                failedVisualEmoji: data.failedQuestion.visual.value,
                failedArabicMeaning: data.failedQuestion.arabicMeaning ?? 'المعنى',
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
        arabicMeaning: question.arabicMeaning ?? 'المعنى',
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
    const normalizedAnswer = normalizeSpeechTranscript(answer);
    const normalizedCorrect = normalizeGermanSpeechAnswer(correctAnswer);
    const answerWithoutArticle = removeGermanArticle(normalizedAnswer);
    const correctWithoutArticle = removeGermanArticle(normalizedCorrect);
    const accepted = new Set([
        normalizedCorrect,
        correctWithoutArticle,
        ...safeSpeechVariants(correctWithoutArticle),
    ]);
    return accepted.has(normalizedAnswer) || accepted.has(answerWithoutArticle);
}

export function normalizeSpeechTranscript(answer: string): string {
    return normalizeGermanSpeechAnswer(answer);
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
        .replace(/ß/g, 'ss')
        .trim();
}

export function removeGermanArticle(value: string): string {
    return value.replace(/^(der|die|das)\s+/i, '').trim();
}

function normalizeRawTranscript(value: string): string {
    return String(value ?? '').trim().slice(0, 120);
}

function normalizeConfidence(value: number | undefined): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    return Math.max(0, Math.min(1, value));
}

function safeSpeechVariants(value: string): string[] {
    if (!value || value.length < 4) return [];
    const variants: string[] = [];
    if (value.endsWith('e')) variants.push(`${value}n`);
    return variants;
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

function capGameWords(words: Word[]): Word[] {
    return words.filter((_, index) => index < GAME_QUESTION_LIMIT);
}

function capGameIds(ids: number[]): number[] {
    return ids.filter((_, index) => index < GAME_QUESTION_LIMIT);
}

function calculateDurationMs(startedAt: string, finishedAt: string): number {
    const start = new Date(startedAt).getTime();
    const finish = new Date(finishedAt).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(finish)) return 0;
    return Math.max(0, finish - start);
}

function parseWordIds(raw: string): number[] {
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) return [];
        return capGameIds(parsed.map(Number).filter(Number.isFinite));
    } catch {
        return [];
    }
}

async function announceGameChallengeResult(db: D1Database, env: Env, challenge: GameChallengeRecord, ctx?: ExecutionContext): Promise<void> {
    const creator = await queryOne<Pick<User, 'telegram_id' | 'display_name' | 'name'>>(
        db,
        'SELECT telegram_id, display_name, name FROM users WHERE user_id = ?',
        [challenge.creator_user_id]
    );
    const opponent = await queryOne<Pick<User, 'telegram_id' | 'display_name' | 'name'>>(
        db,
        'SELECT telegram_id, display_name, name FROM users WHERE user_id = ?',
        [challenge.opponent_user_id]
    );
    if (!creator || !opponent) return;
    const winner = challenge.winner_user_id
        ? challenge.winner_user_id === challenge.creator_user_id
            ? displayUserName(creator)
            : displayUserName(opponent)
        : null;
    const resultReason = challenge.winner_user_id
        ? challenge.creator_score === challenge.opponent_score
            ? 'الوقت حسم النتيجة'
            : 'الفائز بالنقاط'
        : 'تعادل';
    const result = `⚔️ نتيجة تحدي دودة البحر #${challenge.challenge_id}\n\n` +
        `${displayUserName(creator)}: ${challenge.creator_score} نقطة | ${challenge.creator_completed_words}/${challenge.question_count} | ${formatMs(challenge.creator_duration_ms)} | +${challenge.creator_xp_gained} XP\n` +
        `${displayUserName(opponent)}: ${challenge.opponent_score} نقطة | ${challenge.opponent_completed_words}/${challenge.question_count} | ${formatMs(challenge.opponent_duration_ms)} | +${challenge.opponent_xp_gained} XP\n\n` +
        `${resultReason}\n` +
        (winner ? `🏆 الفائز: ${winner}` : '🤝 النتيجة تعادل');
    await sendTemporaryTelegramMessage(env, creator.telegram_id, result, GAME_NOTIFICATION_DELETE_AFTER_SECONDS, ctx).catch(() => {});
    await sendTemporaryTelegramMessage(env, opponent.telegram_id, result, GAME_NOTIFICATION_DELETE_AFTER_SECONDS, ctx).catch(() => {});
}

async function sendGameFinishNotification(
    db: D1Database,
    env: Env,
    userId: number,
    data: GameSessionData,
    xpGained: number,
    ctx?: ExecutionContext
): Promise<void> {
    const user = await queryOne<Pick<User, 'telegram_id'>>(db, 'SELECT telegram_id FROM users WHERE user_id = ?', [userId]);
    if (!user) return;
    const totalWords = data.totalWords ?? data.totalQuestions;
    const completedWords = data.completedWords ?? data.correctCount;
    const score = calculateGameScore(data.heightMeters, data.correctCount);
    const message = data.gameWon
        ? `🎉 مبروك! أكملت مجموعة الكلمات في لعبة الدودة.\n` +
            `✅ الكلمات المكتملة: ${completedWords} / ${totalWords}\n` +
            `⭐ النقاط المكتسبة: +${score}\n` +
            `💎 XP المكتسب: +${xpGained}\n` +
            `🐛 الدودة وصلت لأقصى طول!`
        : completedWords > 0
            ? `🌊 تم حفظ تقدمك في لعبة الدودة!\n` +
                `✅ الكلمات المكتملة: ${completedWords} / ${totalWords}\n` +
                `⭐ النقاط المكتسبة: +${score}\n` +
                `💎 XP المكتسب: +${xpGained}\n` +
                `🐛 طول الدودة: ${completedWords} مراحل\n` +
                `ارجع للعبة بأي وقت تكمل تحديك.`
            : `🌊 تم إغلاق لعبة الدودة.\nلم يتم تسجيل تقدم جديد هذه المرة.`;
    await sendTemporaryTelegramMessage(env, user.telegram_id, message, GAME_NOTIFICATION_DELETE_AFTER_SECONDS, ctx).catch(() => {});
}

async function notifyGameChallengeWaiting(
    db: D1Database,
    env: Env,
    userId: number,
    data: GameSessionData,
    xpGained: number,
    ctx?: ExecutionContext
): Promise<void> {
    const user = await queryOne<Pick<User, 'telegram_id'>>(db, 'SELECT telegram_id FROM users WHERE user_id = ?', [userId]);
    if (!user) return;
    const totalWords = data.totalWords ?? data.totalQuestions;
    const completedWords = data.completedWords ?? data.correctCount;
    const score = calculateGameScore(data.heightMeters, data.correctCount);
    const message = `⚔️ تم حفظ نتيجتك في تحدي الدودة!\n` +
        `✅ الكلمات المكتملة: ${completedWords} / ${totalWords}\n` +
        `⭐ النقاط: ${score}\n` +
        `💎 XP: +${xpGained}\n` +
        `⏳ بانتظار نتيجة الطرف الآخر...`;
    await sendTemporaryTelegramMessage(env, user.telegram_id, message, GAME_NOTIFICATION_DELETE_AFTER_SECONDS, ctx).catch(() => {});
}

function formatMs(value: number | null): string {
    if (value === null) return '-';
    const seconds = Math.max(0, Math.round(value / 1000));
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return minutes > 0 ? `${minutes}:${String(rest).padStart(2, '0')}` : `${rest}s`;
}

function sanitizeFinishReason(reason: string): string {
    const normalized = String(reason || 'unknown').trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
    return normalized || 'unknown';
}

function shuffle<T>(array: T[]): T[] {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
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
