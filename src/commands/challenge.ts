import { Bot, InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot/context';
import { createAsyncChallenge, getChallenge, getChallengeQuestions, hasOpenChallengeBetween, submitChallengeResult } from '../repositories/challengeRepository';
import { deleteBotSession, getBotSession, saveBotSession } from '../repositories/sessionRepository';
import { getChallengeCandidates, getUserByTelegramId } from '../repositories/userRepository';
import { getWordsForUserWithStatus } from '../repositories/wordRepository';
import { countCollectionsByUser, getCollectionById, getCollectionsByUser, getCollectionWords } from '../repositories/wordSharingRepository';
import { unlockAchievement } from '../services/achievements';
import { competitionNotificationsEnabled, displayUserName, sendTelegramMessage } from '../services/notifications';
import { addXp } from '../services/xpLevels';
import { evaluateWrittenAnswer, formatExpectedAnswers } from '../services/trainingAnswerMatcher';
import { mainMenuKeyboard } from './menu';
import { replaceWithText } from './wordPanel';
import { buildTrainingQuestion, questionLabel, type TrainingMode, type TrainingQuestion, type TrainingQuestionType } from './train';

type CollectionChallengeMode = 'multiple_choice' | 'mixed' | 'missing' | 'ar_de' | 'de_ar' | 'typing';

interface ChallengeQuestionData {
    word_id: number;
    prompt: string;
    answer: string;
    options: string[];
    direction: 'de_ar' | 'ar_de';
    type?: TrainingQuestionType;
    german?: string;
    helper?: string;
}

interface ChallengeSessionData {
    challengeId: number;
    questions: ChallengeQuestionData[];
    currentIndex: number;
    correctCount: number;
    startTime: number;
}

export function registerChallengeCommand(bot: Bot<BotContext>): void {
    bot.command('challenge', async (ctx) => showChallengeOptions(ctx));

    bot.callbackQuery('menu_challenge', async (ctx) => {
        await ctx.answerCallbackQuery();
        await showChallengeOptions(ctx);
    });

    bot.callbackQuery(/^challenge_source_(all|mixed)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        await showChallengeCountForSource(ctx, ctx.match[1] as 'all' | 'mixed');
    });

    bot.callbackQuery(/^challenge_source_(all|mixed)_(5|10|20)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        await showOpponentSelection(ctx, parseInt(ctx.match[2], 10), ctx.match[1] as 'all' | 'mixed');
    });

    bot.callbackQuery(/^challenge_create_(5|10|20)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        await showOpponentSelection(ctx, parseInt(ctx.match[1], 10), 'all');
    });

    bot.callbackQuery(/^challenge_opp_(5|10|20)_(\d+)(?::(all|mixed))?$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        await createChallenge(ctx, parseInt(ctx.match[1], 10), parseInt(ctx.match[2], 10), ctx.match[3] as 'all' | 'mixed' | undefined);
    });

    bot.callbackQuery(/^(?:collection_challenge_count_|train_collection_)(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const collectionId = Number(ctx.match[1]);
        await showCollectionChallengeModes(ctx, collectionId);
    });

    bot.callbackQuery(/^challenge_collections:page:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        await showChallengeCollections(ctx, Number(ctx.match[1]));
    });

    bot.callbackQuery(/^collection_challenge_count_(\d+)_(5|10|20)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        await showOpponentSelection(ctx, Number(ctx.match[2]), 'collection', Number(ctx.match[1]), 'multiple_choice');
    });

    bot.callbackQuery(/^collection_challenge_mode_(\d+)_(mc|mixed|missing|ar_de|de_ar|typing)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        await showCollectionChallengeCounts(ctx, Number(ctx.match[1]), collectionModeFromAlias(ctx.match[2]));
    });

    bot.callbackQuery(/^collection_challenge_count_(\d+)_(mc|mixed|missing|ar_de|de_ar|typing)_(5|10|20)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        await showOpponentSelection(ctx, Number(ctx.match[3]), 'collection', Number(ctx.match[1]), collectionModeFromAlias(ctx.match[2]));
    });

    bot.callbackQuery(/^challenge_collection_opp_(\d+)_(5|10|20)_(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        await createCollectionChallenge(ctx, Number(ctx.match[1]), Number(ctx.match[2]), Number(ctx.match[3]), 'multiple_choice');
    });

    bot.callbackQuery(/^challenge_collection_opp_(\d+)_(mc|mixed|missing|ar_de|de_ar|typing)_(5|10|20)_(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        await createCollectionChallenge(ctx, Number(ctx.match[1]), Number(ctx.match[3]), Number(ctx.match[4]), collectionModeFromAlias(ctx.match[2]));
    });

    bot.callbackQuery(/^challenge_start_(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        await startExistingChallenge(ctx, parseInt(ctx.match[1], 10));
    });

    bot.callbackQuery(/^challenge_history_(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        await showChallengeHistory(ctx, Number(ctx.match[1]));
    });

    bot.callbackQuery(/^challenge_ans_(\d+)_(\d+)_(correct|wrong)$/, async (ctx) => {
        const challengeId = parseInt(ctx.match[1], 10);
        const wordId = parseInt(ctx.match[2], 10);
        const isCorrect = ctx.match[3] === 'correct';
        await handleChallengeAnswer(ctx, challengeId, wordId, isCorrect);
    });

    bot.on('message:text', async (ctx, next) => {
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user || ctx.message.text.startsWith('/')) return next();
        const session = await getBotSession<ChallengeSessionData>(ctx.db, user.user_id, 'challenge');
        const current = session?.data.questions[session.data.currentIndex];
        if (!session || !current) return next();
        if (current.options.length > 0) {
            await ctx.reply('⚔️ عندك تحدي فعال. استخدم أزرار الإجابة الحالية أو اضغط 🏠 الرئيسية لإنهاء الجلسة.');
            return;
        }
        await handleTypedChallengeAnswer(ctx, current, ctx.message.text);
    });
}

async function showChallengeOptions(ctx: BotContext): Promise<void> {
    const user = await getCurrentUser(ctx);
    if (!user) return;

    const pending = await ctx.db.prepare(
        `SELECT c.challenge_id, c.question_count, u.display_name, u.name
         FROM async_challenges c
         INNER JOIN users u ON u.user_id = CASE WHEN c.creator_user_id = ? THEN c.opponent_user_id ELSE c.creator_user_id END
         WHERE (c.opponent_user_id = ? OR c.creator_user_id = ?)
           AND c.status IN ('waiting_opponent', 'in_progress')
           AND ((c.creator_user_id = ? AND c.creator_time_ms IS NULL) OR (c.opponent_user_id = ? AND c.opponent_time_ms IS NULL))
         ORDER BY c.created_at DESC
         LIMIT 5`
    ).bind(user.user_id, user.user_id, user.user_id, user.user_id, user.user_id).all<{ challenge_id: number; question_count: number; display_name: string | null; name: string }>();

    const keyboard = new InlineKeyboard()
        .text('📚 كلماتي كلها', 'challenge_source_all').row()
        .text('🎲 مختلط من الطرفين', 'challenge_source_mixed').row()
        .text('🗂 تحدي على مجموعة كلمات', 'challenge_collections:page:1').row()
        .text('🔥 الكلمات الصعبة', 'hard_words').row()
        .text('📜 سجل التحديات', 'challenge_history_0');

    for (const challenge of pending.results ?? []) {
        keyboard.row().text(
            `ابدأ تحدي ${displayUserName(challenge)} (${challenge.question_count})`,
            `challenge_start_${challenge.challenge_id}`
        );
    }

    keyboard.row().text('⬅️ رجوع', 'menu_main');

    await replaceWithText(ctx, '⚔️ *التحديات*\n\nاختر مصدر كلمات التحدي:', keyboard, 'Markdown');
}

async function showChallengeCollections(ctx: BotContext, page: number): Promise<void> {
    const user = await getCurrentUser(ctx);
    if (!user) return;
    const total = await countCollectionsByUser(ctx.db, user.user_id);
    const totalPages = Math.max(1, Math.ceil(total / 10));
    const safePage = Math.max(1, Math.min(page, totalPages));
    const collections = await getCollectionsByUser(ctx.db, user.user_id, 10, (safePage - 1) * 10);
    const text = collections.length === 0
        ? '🗂 تحدي على مجموعة كلمات\n\nلا توجد مجموعات بعد. أنشئ مجموعة من 📂 كلماتي.'
        : '🗂 تحدي على مجموعة كلمات\n\nاختر مجموعة، بعدها اختار عدد الأسئلة والمنافس:\n\n' +
            collections.map(item => `• ${item.title}\nكلمات: ${item.word_count ?? 0}`).join('\n\n');
    const keyboard = new InlineKeyboard();
    for (const collection of collections) {
        keyboard.text(`🗂 ${collection.title} (${collection.word_count ?? 0})`, `collection_challenge_count_${collection.id}`).row();
    }
    if (safePage > 1) keyboard.text('⬅️ السابق', `challenge_collections:page:${safePage - 1}`);
    if (safePage < totalPages) keyboard.text('التالي ➡️', `challenge_collections:page:${safePage + 1}`);
    if (safePage > 1 || safePage < totalPages) keyboard.row();
    keyboard.text('➕ إنشاء مجموعة', 'collections:create').row()
        .text('⬅️ رجوع', 'menu_challenge')
        .text('🏠 الرئيسية', 'menu_main');
    await replaceWithText(ctx, text, keyboard);
}

async function showCollectionChallengeModes(ctx: BotContext, collectionId: number): Promise<void> {
    await replaceWithText(ctx, 'اختر نوع تحدي المجموعة:', new InlineKeyboard()
        .text('✅ اختيارات', `collection_challenge_mode_${collectionId}_mc`).row()
        .text('🎲 مختلط', `collection_challenge_mode_${collectionId}_mixed`).row()
        .text('🧩 حروف ناقصة', `collection_challenge_mode_${collectionId}_missing`).row()
        .text('🇮🇶 عربي → ألماني', `collection_challenge_mode_${collectionId}_ar_de`).row()
        .text('🇩🇪 ألماني → عربي', `collection_challenge_mode_${collectionId}_de_ar`).row()
        .text('✍️ كتابة', `collection_challenge_mode_${collectionId}_typing`).row()
        .text('⬅️ رجوع', `collection:view:${collectionId}:page:1`)
        .text('🏠 الرئيسية', 'menu_main'));
}

async function showCollectionChallengeCounts(ctx: BotContext, collectionId: number, mode: CollectionChallengeMode): Promise<void> {
    const modeLabel = collectionChallengeModeLabel(mode);
    const alias = collectionModeAlias(mode);
    await replaceWithText(ctx, `اختر عدد أسئلة تحدي المجموعة:\n${modeLabel}`, new InlineKeyboard()
        .text('5', `collection_challenge_count_${collectionId}_${alias}_5`)
        .text('10', `collection_challenge_count_${collectionId}_${alias}_10`)
        .text('20', `collection_challenge_count_${collectionId}_${alias}_20`).row()
        .text('⬅️ رجوع', `collection_challenge_count_${collectionId}`)
        .text('🏠 الرئيسية', 'menu_main'));
}

async function showChallengeCountForSource(ctx: BotContext, source: 'all' | 'mixed'): Promise<void> {
    const label = source === 'mixed' ? 'مختلط تلقائي من الطرفين' : 'كلماتي كلها';
    await replaceWithText(ctx, `اختر عدد الأسئلة:\n${label}`, new InlineKeyboard()
        .text('5', `challenge_source_${source}_5`)
        .text('10', `challenge_source_${source}_10`)
        .text('20', `challenge_source_${source}_20`).row()
        .text('⬅️ رجوع', 'menu_challenge')
        .text('🏠 الرئيسية', 'menu_main'));
}

async function showOpponentSelection(ctx: BotContext, count: number, source: 'all' | 'mixed' | 'collection' = 'all', collectionId?: number, collectionMode: CollectionChallengeMode = 'multiple_choice'): Promise<void> {
    const user = await getCurrentUser(ctx);
    if (!user) return;

    const candidates = await getChallengeCandidates(ctx.db, user.user_id);
    if (candidates.length === 0) {
        await replaceWithText(ctx, 'لا يوجد مستخدم نشيط مناسب للتحدي حالياً. جرّب لاحقاً.', mainMenuKeyboard());
        return;
    }

    const first = candidates[Math.floor(Math.random() * candidates.length)];
    const modeAlias = collectionModeAlias(collectionMode);
    const randomCallback = source === 'collection' && collectionId
        ? `challenge_collection_opp_${collectionId}_${modeAlias}_${count}_${first.user_id}`
        : `challenge_opp_${count}_${first.user_id}:${source}`;
    const keyboard = new InlineKeyboard().text('🎲 منافس عشوائي', randomCallback).row();
    for (const candidate of candidates) {
        const callback = source === 'collection' && collectionId
            ? `challenge_collection_opp_${collectionId}_${modeAlias}_${count}_${candidate.user_id}`
            : `challenge_opp_${count}_${candidate.user_id}:${source}`;
        keyboard.text(candidate.display_name ?? candidate.name, callback).row();
    }
    keyboard.text('⬅️ رجوع', source === 'collection' && collectionId ? `collection_challenge_count_${collectionId}_${modeAlias}` : 'menu_challenge');
    const label = source === 'collection' ? `\nالنوع: ${collectionChallengeModeLabel(collectionMode)}` : '';
    await replaceWithText(ctx, `⚔️ اختر مستخدم للتحدي (${count} أسئلة):${label}`, keyboard);
}

async function showChallengeHistory(ctx: BotContext, page: number): Promise<void> {
    const user = await getCurrentUser(ctx);
    if (!user) return;
    const limit = 5;
    const rows = await ctx.db.prepare(
        `SELECT c.challenge_id, c.status, c.question_count, c.creator_score, c.opponent_score, c.created_at, c.completed_at,
                u.display_name, u.name
         FROM async_challenges c
         INNER JOIN users u ON u.user_id = CASE WHEN c.creator_user_id = ? THEN c.opponent_user_id ELSE c.creator_user_id END
         WHERE (c.creator_user_id = ? OR c.opponent_user_id = ?)
           AND c.status IN ('completed', 'expired', 'cancelled')
         ORDER BY c.created_at DESC
         LIMIT ? OFFSET ?`
    ).bind(user.user_id, user.user_id, user.user_id, limit, page * limit).all<{ challenge_id: number; status: string; question_count: number; creator_score: number; opponent_score: number; created_at: string; completed_at: string | null; display_name: string | null; name: string }>();

    const list = rows.results ?? [];
    const text = list.length === 0
        ? '📜 *سجل التحديات*\n\nلا يوجد سجل بعد.'
        : '📜 *سجل التحديات*\n\n' + list.map(item =>
            `#${item.challenge_id} ضد ${displayUserName(item)}\n${item.status} | ${item.creator_score}-${item.opponent_score} | ${item.question_count} أسئلة`
        ).join('\n\n');
    const keyboard = new InlineKeyboard();
    if (page > 0) keyboard.text('⬅️ السابق', `challenge_history_${page - 1}`);
    if (list.length === limit) keyboard.text('التالي ➡️', `challenge_history_${page + 1}`);
    if (page > 0 || list.length === limit) keyboard.row();
    keyboard.text('⬅️ رجوع', 'menu_challenge').text('🏠 الرئيسية', 'menu_main');
    await replaceWithText(ctx, text, keyboard, 'Markdown');
}

async function createChallenge(ctx: BotContext, count: number, opponentUserId: number, source: 'all' | 'mixed' = 'all'): Promise<void> {
    const user = await getCurrentUser(ctx);
    if (!user) return;

    const peer = await ctx.db.prepare('SELECT * FROM users WHERE user_id = ? AND display_name IS NOT NULL')
        .bind(opponentUserId)
        .first<typeof user>();
    if (!peer || peer.user_id === user.user_id) {
        await replaceWithText(ctx, '⚠️ هذا المستخدم غير متاح للتحدي.', mainMenuKeyboard());
        return;
    }

    if (peer.is_banned || peer.is_deleted) {
        await replaceWithText(ctx, '⚠️ هذا المستخدم غير متاح للتحدي.', mainMenuKeyboard());
        return;
    }

    if (await hasOpenChallengeBetween(ctx.db, user.user_id, peer.user_id)) {
        await replaceWithText(ctx, 'يوجد تحدي غير مكتمل بينكم. أكملوه أولاً.', mainMenuKeyboard());
        return;
    }

    const words = source === 'mixed'
        ? await getMixedChallengeWords(ctx, user.user_id, peer.user_id, count)
        : await getWordsForUserWithStatus(ctx.db, user.user_id);
    if (words.length < count) {
        await ctx.reply(`⚠️ تحتاج ${count} كلمات على الأقل لإنشاء التحدي.`, { reply_markup: mainMenuKeyboard() });
        return;
    }

    const questions = shuffle(words).slice(0, count).map((word, index) => {
        const direction: 'de_ar' | 'ar_de' = index % 2 === 0 ? 'de_ar' : 'ar_de';
        const answer = direction === 'de_ar' ? word.arabic : word.german;
        const prompt = direction === 'de_ar' ? word.german : word.arabic;
        const options = shuffle([answer, ...buildDistractors(words, word.word_id, direction, 2)]);
        return { word_id: word.word_id, prompt, answer, options, direction };
    });

    const challengeId = await createAsyncChallenge(ctx.db, user.user_id, peer.user_id, questions, {
        sourceType: source === 'mixed' ? 'mixed_users' : 'all_words',
        wordOrigin: source === 'mixed' ? questions.map(question => ({ word_id: question.word_id })) : undefined,
    });
    await saveBotSession<ChallengeSessionData>(ctx.db, user.user_id, 'challenge', {
        challengeId,
        questions,
        currentIndex: 0,
        correctCount: 0,
        startTime: Date.now(),
    }, 120);

    if (await competitionNotificationsEnabled(ctx.db, peer.user_id)) {
        await sendTelegramMessage(
            ctx.env,
            peer.telegram_id,
            `⚔️ تحدي جديد!\n\n${displayUserName(user)} تحداك في ${count} أسئلة.\nادخل وحل التحدي حتى نعرف الفائز.`,
            { inline_keyboard: [[{ text: '▶️ حل التحدي', callback_data: `challenge_start_${challengeId}` }]] }
        );
    }

    await replaceWithText(ctx, `⚔️ بدأ التحدي #${challengeId}. جاوب أسئلتك الآن.`, mainMenuKeyboard());
    await showChallengeQuestion(ctx, user.user_id);
}

async function createCollectionChallenge(ctx: BotContext, collectionId: number, count: number, opponentUserId: number, mode: CollectionChallengeMode = 'multiple_choice'): Promise<void> {
    const user = await getCurrentUser(ctx);
    if (!user) return;
    const peer = await ctx.db.prepare('SELECT * FROM users WHERE user_id = ? AND display_name IS NOT NULL AND COALESCE(is_banned, 0) = 0 AND COALESCE(is_deleted, 0) = 0')
        .bind(opponentUserId)
        .first<typeof user>();
    const collection = await getCollectionById(ctx.db, collectionId);
    if (!peer || !collection || (collection.visibility === 'private' && collection.owner_user_id !== user.user_id)) {
        await replaceWithText(ctx, '⚠️ هذا التحدي غير متاح.', mainMenuKeyboard());
        return;
    }
    const words = await getCollectionWords(ctx.db, collectionId, 100, 0);
    if (words.length < count) {
        await replaceWithText(ctx, `هذه المجموعة تحتوي ${words.length} كلمة فقط. اختر عدد أسئلة أقل أو أضف كلمات.`, new InlineKeyboard()
            .text('⬅️ رجوع', `collection:view:${collectionId}:page:1`)
            .text('🏠 الرئيسية', 'menu_main'));
        return;
    }
    if (requiresMultipleChoiceDistractors(mode) && words.length < 3) {
        await replaceWithText(ctx, 'هذا النوع يحتاج 3 كلمات على الأقل داخل المجموعة حتى تتكون خيارات كافية. جرّب كتابة أو أضف كلمات أكثر.', new InlineKeyboard()
            .text('✍️ كتابة', `collection_challenge_mode_${collectionId}_typing`).row()
            .text('⬅️ رجوع', `collection_challenge_count_${collectionId}`)
            .text('🏠 الرئيسية', 'menu_main'));
        return;
    }
    const questions = buildCollectionChallengeQuestions(words, count, mode);
    const challengeId = await createAsyncChallenge(ctx.db, user.user_id, peer.user_id, questions, {
        sourceType: 'collection',
        sourceId: collectionId,
        wordOrigin: questions.map(question => ({ word_id: question.word_id, collection_id: collectionId, mode, type: question.type ?? 'multiple_choice' })),
    });
    await saveBotSession<ChallengeSessionData>(ctx.db, user.user_id, 'challenge', {
        challengeId,
        questions,
        currentIndex: 0,
        correctCount: 0,
        startTime: Date.now(),
    }, 120);
    if (await competitionNotificationsEnabled(ctx.db, peer.user_id)) {
        await sendTelegramMessage(ctx.env, peer.telegram_id, `⚔️ تحدي مجموعة كلمات!\n\n${displayUserName(user)} تحداك على مجموعة: ${collection.title}`, {
            inline_keyboard: [[{ text: '▶️ حل التحدي', callback_data: `challenge_start_${challengeId}` }]],
        });
    }
    await replaceWithText(ctx, `⚔️ بدأ تحدي المجموعة #${challengeId}.\nالنوع: ${collectionChallengeModeLabel(mode)}`, mainMenuKeyboard());
    await showChallengeQuestion(ctx, user.user_id);
}

async function startExistingChallenge(ctx: BotContext, challengeId: number): Promise<void> {
    const user = await getCurrentUser(ctx);
    if (!user) return;

    const challenge = await getChallenge(ctx.db, challengeId);
    if (!challenge || (challenge.opponent_user_id !== user.user_id && challenge.creator_user_id !== user.user_id) || !['waiting_opponent', 'in_progress'].includes(challenge.status)) {
        await replaceWithText(ctx, '⚠️ هذا التحدي غير متاح.', mainMenuKeyboard());
        return;
    }
    if ((challenge.creator_user_id === user.user_id && challenge.creator_time_ms !== null) || (challenge.opponent_user_id === user.user_id && challenge.opponent_time_ms !== null)) {
        await replaceWithText(ctx, 'أنت أكملت هذا التحدي مسبقاً.', mainMenuKeyboard());
        return;
    }

    const rows = await getChallengeQuestions(ctx.db, challengeId);
    const questions = rows.map(row => ({
        word_id: row.word_id,
        prompt: row.prompt,
        answer: row.answer,
        ...parseStoredChallengeOptions(row.options),
        direction: row.direction,
    }));

    await saveBotSession<ChallengeSessionData>(ctx.db, user.user_id, 'challenge', {
        challengeId,
        questions,
        currentIndex: 0,
        correctCount: 0,
        startTime: Date.now(),
    }, 120);

    await showChallengeQuestion(ctx, user.user_id);
}

async function showChallengeQuestion(ctx: BotContext, userId: number, notice?: string): Promise<void> {
    const session = await getBotSession<ChallengeSessionData>(ctx.db, userId, 'challenge');
    if (!session || session.data.currentIndex >= session.data.questions.length) {
        if (session) await finishChallenge(ctx, userId, session.data);
        return;
    }

    const question = session.data.questions[session.data.currentIndex];
    const progress = `${session.data.currentIndex + 1}/${session.data.questions.length}`;
    const keyboard = new InlineKeyboard();
    for (const option of question.options) {
        keyboard.text(option, `challenge_ans_${session.data.challengeId}_${question.word_id}_${option === question.answer ? 'correct' : 'wrong'}`).row();
    }
    if (question.options.length === 0) {
        keyboard.text('🏠 الرئيسية', 'menu_main');
    }

    const label = challengeQuestionLabel(question);
    const helper = question.helper ? `\n\n${question.helper}` : '';
    await replaceWithText(ctx, `${notice ? `${notice}\n\n` : ''}⚔️ (${progress}) ${label}:\n\n*${question.prompt}*${helper}`, keyboard, 'Markdown');
}

async function handleChallengeAnswer(ctx: BotContext, challengeId: number, wordId: number, isCorrect: boolean): Promise<void> {
    const user = await getCurrentUser(ctx);
    if (!user) return;

    const session = await getBotSession<ChallengeSessionData>(ctx.db, user.user_id, 'challenge');
    const current = session?.data.questions[session.data.currentIndex];
    if (!session || session.data.challengeId !== challengeId || !current || current.word_id !== wordId) {
        await ctx.answerCallbackQuery('هذا ليس السؤال الحالي');
        return;
    }

    if (isCorrect) session.data.correctCount++;
    session.data.currentIndex++;
    await saveBotSession(ctx.db, user.user_id, 'challenge', session.data, 120);
    await ctx.answerCallbackQuery(isCorrect ? '✅ صحيح' : '❌ خطأ');
    await showChallengeQuestion(ctx, user.user_id, isCorrect ? '✅ صحيح' : `❌ خطأ\nالصحيح: *${current.answer}*`);
}

async function handleTypedChallengeAnswer(ctx: BotContext, current: ChallengeQuestionData, answerText: string): Promise<void> {
    const user = await getCurrentUser(ctx);
    if (!user) return;
    const session = await getBotSession<ChallengeSessionData>(ctx.db, user.user_id, 'challenge');
    if (!session || session.data.currentIndex >= session.data.questions.length) return;
    const active = session.data.questions[session.data.currentIndex];
    if (active.word_id !== current.word_id || active.options.length > 0) return;

    const evaluation = evaluateWrittenAnswer({
        userAnswer: answerText,
        expectedAnswer: active.answer,
        answerLanguage: active.direction === 'de_ar' ? 'ar' : 'de',
    });
    const isCorrect = evaluation.accepted;
    if (isCorrect) session.data.correctCount++;
    session.data.currentIndex++;
    await saveBotSession(ctx.db, user.user_id, 'challenge', session.data, 120);
    await showChallengeQuestion(
        ctx,
        user.user_id,
        isCorrect ? '✅ صحيح!' : `❌ خطأ\nجوابك: *${answerText.trim()}*\nالصحيح: *${formatExpectedAnswers(active.answer, active.direction === 'de_ar' ? 'ar' : 'de')}*`
    );
}

async function finishChallenge(ctx: BotContext, userId: number, session: ChallengeSessionData): Promise<void> {
    await deleteBotSession(ctx.db, userId, 'challenge');
    const timeMs = Date.now() - session.startTime;
    const challenge = await submitChallengeResult(ctx.db, session.challengeId, userId, session.correctCount, timeMs);
    if (!challenge) return;

    await addXp(ctx.db, userId, session.correctCount * 2, {
        reason: 'challenge_participation',
        sourceType: 'challenge',
        sourceId: challenge.challenge_id.toString(),
    });
    await replaceWithText(ctx, `✅ انتهى دورك في التحدي.\nنتيجتك: ${session.correctCount}/${session.questions.length}`, challengeDoneKeyboard());

    if (challenge.status === 'completed') {
        await announceChallengeResult(ctx, challenge);
    }
}

function challengeDoneKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
        .text('🔁 تحدي جديد', 'menu_challenge').row()
        .text('📜 سجل التحديات', 'challenge_history_0').row()
        .text('🏠 الرئيسية', 'menu_main');
}

async function announceChallengeResult(ctx: BotContext, challenge: NonNullable<Awaited<ReturnType<typeof getChallenge>>>): Promise<void> {
    const creator = await ctx.db.prepare('SELECT * FROM users WHERE user_id = ?').bind(challenge.creator_user_id).first<{ telegram_id: number; display_name: string | null; name: string }>();
    const opponent = await ctx.db.prepare('SELECT * FROM users WHERE user_id = ?').bind(challenge.opponent_user_id).first<{ telegram_id: number; display_name: string | null; name: string }>();
    if (!creator || !opponent) return;

    let result = `⚔️ نتيجة التحدي #${challenge.challenge_id}\n\n` +
        `${displayUserName(creator)}: ${challenge.creator_score}/${challenge.question_count}\n` +
        `${displayUserName(opponent)}: ${challenge.opponent_score}/${challenge.question_count}\n\n`;

    if (challenge.winner_user_id) {
        const winner = challenge.winner_user_id === challenge.creator_user_id ? creator : opponent;
        result += `🏆 الفائز: ${displayUserName(winner)} +100 XP`;
        await addXp(ctx.db, challenge.winner_user_id, 100, {
            reason: 'challenge_win',
            sourceType: 'challenge',
            sourceId: challenge.challenge_id.toString(),
        });
        await unlockAchievement(ctx, challenge.winner_user_id, 'first_challenge_win');
    } else {
        result += '🤝 تعادل!';
    }

    await sendTelegramMessage(ctx.env, creator.telegram_id, result);
    await sendTelegramMessage(ctx.env, opponent.telegram_id, result);
}

async function getCurrentUser(ctx: BotContext) {
    const telegramId = ctx.from?.id ?? 0;
    const user = await getUserByTelegramId(ctx.db, telegramId);
    if (!user) {
        await ctx.reply('يرجى استخدام /start أولاً.');
        return null;
    }
    return user;
}

function buildDistractors(words: Array<{ word_id: number; german: string; arabic: string }>, currentWordId: number, direction: 'de_ar' | 'ar_de', count: number): string[] {
    return shuffle(words.filter(word => word.word_id !== currentWordId))
        .map(word => direction === 'de_ar' ? word.arabic : word.german)
        .filter((value, index, values) => values.indexOf(value) === index)
        .slice(0, count);
}

function buildQuestions(words: Array<{ word_id: number; german: string; arabic: string }>, count: number): ChallengeSessionData['questions'] {
    const selected = shuffle(words).slice(0, count);
    return selected.map((word, index) => {
        const direction: 'de_ar' | 'ar_de' = index % 2 === 0 ? 'de_ar' : 'ar_de';
        const answer = direction === 'de_ar' ? word.arabic : word.german;
        const prompt = direction === 'de_ar' ? word.german : word.arabic;
        const options = shuffle([answer, ...buildDistractors(words, word.word_id, direction, 2)]);
        return { word_id: word.word_id, prompt, answer, options, direction, type: 'multiple_choice', german: word.german };
    });
}

function buildCollectionChallengeQuestions(
    words: Array<{ word_id: number; german: string; arabic: string; example: string | null }>,
    count: number,
    mode: CollectionChallengeMode
): ChallengeSessionData['questions'] {
    if (mode === 'multiple_choice') return buildQuestions(words, count);
    const selected = shuffle(words).slice(0, count);
    return selected.map((word, index) => {
        const trainingMode = collectionModeToTrainingMode(mode);
        const question = buildTrainingQuestion(words, word, trainingMode, index);
        return trainingQuestionToChallengeQuestion(question);
    });
}

function trainingQuestionToChallengeQuestion(question: TrainingQuestion): ChallengeQuestionData {
    return {
        word_id: question.word_id,
        prompt: question.prompt,
        answer: question.answer,
        options: question.options,
        direction: question.direction,
        type: question.type,
        german: question.german,
        helper: question.helper,
    };
}

function parseStoredChallengeOptions(raw: string): Pick<ChallengeQuestionData, 'options' | 'type' | 'german' | 'helper'> {
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) return { options: parsed.filter((value): value is string => typeof value === 'string') };
        if (parsed && typeof parsed === 'object') {
            const value = parsed as { options?: unknown; choices?: unknown; type?: unknown; german?: unknown; helper?: unknown };
            const options = Array.isArray(value.options)
                ? value.options
                : Array.isArray(value.choices)
                    ? value.choices
                    : [];
            return {
                options: options.filter((item): item is string => typeof item === 'string'),
                type: typeof value.type === 'string' ? value.type as TrainingQuestionType : undefined,
                german: typeof value.german === 'string' ? value.german : undefined,
                helper: typeof value.helper === 'string' ? value.helper : undefined,
            };
        }
    } catch {
        // Old or malformed rows fall back to an empty typed-answer question.
    }
    return { options: [] };
}

function challengeQuestionLabel(question: ChallengeQuestionData): string {
    if (question.type) return questionLabel(question as TrainingQuestion);
    return question.direction === 'de_ar' ? 'اختر المعنى العربي' : 'اختر الكلمة الألمانية';
}

function collectionModeAlias(mode: CollectionChallengeMode): string {
    if (mode === 'multiple_choice') return 'mc';
    return mode;
}

function collectionModeFromAlias(alias: string): CollectionChallengeMode {
    if (alias === 'mc') return 'multiple_choice';
    if (alias === 'mixed' || alias === 'missing' || alias === 'ar_de' || alias === 'de_ar' || alias === 'typing') return alias;
    return 'multiple_choice';
}

function collectionChallengeModeLabel(mode: CollectionChallengeMode): string {
    const labels: Record<CollectionChallengeMode, string> = {
        multiple_choice: 'اختيارات',
        mixed: 'مختلط',
        missing: 'حروف ناقصة',
        ar_de: 'عربي → ألماني',
        de_ar: 'ألماني → عربي',
        typing: 'كتابة',
    };
    return labels[mode];
}

function collectionModeToTrainingMode(mode: CollectionChallengeMode): TrainingMode {
    if (mode === 'multiple_choice') return 'de_ar';
    if (mode === 'missing') return 'missing';
    if (mode === 'typing') return 'typing';
    if (mode === 'ar_de') return 'ar_de';
    if (mode === 'de_ar') return 'de_ar';
    return 'mixed';
}

function requiresMultipleChoiceDistractors(mode: CollectionChallengeMode): boolean {
    return mode === 'multiple_choice' || mode === 'mixed' || mode === 'ar_de' || mode === 'de_ar';
}

async function getMixedChallengeWords(ctx: BotContext, creatorUserId: number, opponentUserId: number, count: number): Promise<Array<{ word_id: number; german: string; arabic: string }>> {
    const creatorWords = await getWordsForUserWithStatus(ctx.db, creatorUserId);
    const opponentWords = await getWordsForUserWithStatus(ctx.db, opponentUserId);
    const creatorCount = Math.ceil(count / 2);
    const opponentCount = Math.floor(count / 2);
    const selected = [
        ...shuffle(creatorWords).slice(0, creatorCount),
        ...shuffle(opponentWords).slice(0, opponentCount),
    ];
    if (selected.length < count) {
        const used = new Set(selected.map(word => word.word_id));
        const fallback = shuffle([...creatorWords, ...opponentWords]).filter(word => !used.has(word.word_id));
        selected.push(...fallback.slice(0, count - selected.length));
    }
    return selected;
}

function shuffle<T>(array: T[]): T[] {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}
