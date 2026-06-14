import { Bot, InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot/context';
import { getUserByTelegramId } from '../repositories/userRepository';
import { deleteBotSession, getBotSession, saveBotSession } from '../repositories/sessionRepository';
import { getWordById } from '../repositories/wordRepository';
import {
    createGameChallenge,
    createGameSession,
    GAME_UI_VERSION,
    type GameChallengeSourceType,
    MissingGameVisualError,
    countOwnGameCollections,
    countOpponentPublicGameCollections,
    countPlayableGameCollections,
    findMissingVisualsForCollection,
    getOpponentPublicGameCollections,
    getPlayableGameCollections,
    startGameChallengeForUser,
} from '../services/gameSessionService';
import { upsertManualVisual, validateManualVisual } from '../services/gameVisualService';
import { displayUserName, sendTelegramMessage } from '../services/notifications';
import { replaceWithText, showWordDetailPanel } from './wordPanel';

const GAME_COLLECTION_PAGE_SIZE = 8;

interface WordVisualEditSession {
    wordId: number;
    collectionId?: number;
}

interface GameChallengeUserSearchSession {
    searching: true;
}

export function registerGameCommand(bot: Bot<BotContext>): void {
    bot.command('game', async (ctx) => {
        const user = await currentUser(ctx);
        if (!user) return;
        await showGameMenu(ctx);
    });

    bot.on('message:text', async (ctx, next) => {
        const telegramId = ctx.from?.id;
        if (!telegramId) return next();
        const user = await getUserByTelegramId(ctx.db, telegramId);
        if (!user) return next();

        if (await getBotSession(ctx.db, user.user_id, 'train')) return next();
        if (await getBotSession(ctx.db, user.user_id, 'challenge')) return next();

        const session = await getBotSession<WordVisualEditSession>(ctx.db, user.user_id, 'word_visual_edit');
        if (session) {
            await handleManualVisualText(ctx, user.user_id, session.data.wordId, ctx.message.text, session.data.collectionId);
            return;
        }

        const search = await getBotSession<GameChallengeUserSearchSession>(ctx.db, user.user_id, 'game_challenge_user_search');
        if (!search) return next();
        await deleteBotSession(ctx.db, user.user_id, 'game_challenge_user_search');
        await showGameChallengeUsers(ctx, user.user_id, 1, ctx.message.text.trim());
    });

    bot.callbackQuery('game:menu', async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await showGameMenu(ctx);
    });

    bot.callbackQuery('game:solo', async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await showGameCollections(ctx, user.user_id, 1);
    });

    bot.callbackQuery(/^game:collections:page:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await showGameCollections(ctx, user.user_id, Number(ctx.match[1]));
    });

    bot.callbackQuery(/^game:start:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await startGameForCollection(ctx, user.user_id, Number(ctx.match[1]));
    });

    bot.callbackQuery(/^game:start_collection:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await startGameForCollection(ctx, user.user_id, Number(ctx.match[1]));
    });

    bot.callbackQuery(/^game_challenge:users:page:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await showGameChallengeUsers(ctx, user.user_id, Number(ctx.match[1]));
    });

    bot.callbackQuery('game_challenge:search', async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await saveBotSession<GameChallengeUserSearchSession>(ctx.db, user.user_id, 'game_challenge_user_search', { searching: true }, 10);
        await replaceWithText(ctx, '🔍 اكتب اسم المستخدم الذي تريد تحديه:', backHomeKeyboard('game_challenge:users:page:1'));
    });

    bot.callbackQuery(/^game_challenge:opponent:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await showGameChallengeSources(ctx, Number(ctx.match[1]));
    });

    bot.callbackQuery(/^game_challenge:source:(mine|opponent|mixed):(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await showGameChallengeCollections(ctx, user.user_id, Number(ctx.match[2]), ctx.match[1] as GameChallengeSourceType, 1);
    });

    bot.callbackQuery(/^game_challenge:collections:(mine|opponent|mixed):(\d+):page:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await showGameChallengeCollections(ctx, user.user_id, Number(ctx.match[2]), ctx.match[1] as GameChallengeSourceType, Number(ctx.match[3]));
    });

    bot.callbackQuery(/^game_challenge:create:(mine|opponent|mixed):(\d+):(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await createGameChallengeFromSelection(ctx, user.user_id, ctx.match[1] as GameChallengeSourceType, Number(ctx.match[2]), Number(ctx.match[3]));
    });

    bot.callbackQuery(/^game_challenge:start:(\d+):(creator|opponent)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await openGameChallenge(ctx, user.user_id, Number(ctx.match[1]));
    });

    bot.callbackQuery(/^word_visual_edit:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        const wordId = Number(ctx.match[1]);
        const word = await getWordById(ctx.db, wordId);
        if (!word || word.added_by !== user.user_id) {
            await replaceWithText(ctx, 'ما قدرت أفتح تعديل الرمز لهذه الكلمة.', backHomeKeyboard('list_words'));
            return;
        }
        await saveBotSession<WordVisualEditSession>(ctx.db, user.user_id, 'word_visual_edit', { wordId }, 30);
        await replaceWithText(
            ctx,
            `🎨 تعديل الإيموجي\n\n🇩🇪 ${word.german}\n🇮🇶 ${word.arabic}\n\nأرسل إيموجي واحد أو إيموجيين يوضحون المعنى.\n\nالصور والروابط غير مقبولة داخل اللعبة.`,
            new InlineKeyboard()
                .text('❌ إلغاء', `word_visual_cancel:${wordId}`).row()
                .text('⬅️ رجوع للكلمة', `word_detail_${wordId}`)
                .text('🏠 الرئيسية', 'menu_main')
        );
    });

    bot.callbackQuery(/^word_visual_cancel:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await deleteBotSession(ctx.db, user.user_id, 'word_visual_edit');
        await showWordDetailPanel(ctx, Number(ctx.match[1]), 'تم إلغاء تعديل الرمز.');
    });
}

export async function showGameCollections(ctx: BotContext, userId: number, page: number): Promise<void> {
    const ownTotal = await countOwnGameCollections(ctx.db, userId);
    if (ownTotal === 0) {
        await replaceWithText(
            ctx,
            '🎮 لعبة الصور والكلمات\n\nما عندك مجموعة كلمات حتى تبدأ اللعبة. سوّي مجموعة كلمات وأضف كلمات، بعدها ترجع تلعب 🚀',
            new InlineKeyboard()
                .text('➕ إنشاء مجموعة', 'collections:create').row()
                .text('🏠 الرئيسية', 'menu_main')
        );
        return;
    }

    const total = await countPlayableGameCollections(ctx.db, userId);
    if (total === 0) {
        await replaceWithText(
            ctx,
            '🎮 لعبة الصور والكلمات\n\nمجموعاتك موجودة، لكن تحتاج تضيف كلمات حتى تبدأ اللعبة.',
            new InlineKeyboard()
                .text('📚 مجموعاتي', 'collections:mine:page:1').row()
                .text('🏠 الرئيسية', 'menu_main')
        );
        return;
    }

    const totalPages = Math.max(1, Math.ceil(total / GAME_COLLECTION_PAGE_SIZE));
    const safePage = Math.max(1, Math.min(page, totalPages));
    const collections = await getPlayableGameCollections(
        ctx.db,
        userId,
        GAME_COLLECTION_PAGE_SIZE,
        (safePage - 1) * GAME_COLLECTION_PAGE_SIZE
    );

    const text = `🚀 العب وحدك\n\nاختر مجموعة من مجموعاتك حتى تبدأ لعبة الصور والكلمات.\n\nالصفحة: ${safePage} / ${totalPages}`;
    const keyboard = new InlineKeyboard();
    for (const collection of collections) {
        keyboard.text(`📚 ${collection.title} — ${collection.word_count} كلمة`, `game:start:${collection.id}`).row();
    }
    if (safePage > 1) keyboard.text('⬅️ السابق', `game:collections:page:${safePage - 1}`);
    if (safePage < totalPages) keyboard.text('التالي ➡️', `game:collections:page:${safePage + 1}`);
    if (safePage > 1 || safePage < totalPages) keyboard.row();
    keyboard.text('⬅️ رجوع', 'game:menu').text('🏠 الرئيسية', 'menu_main');
    await replaceWithText(ctx, text, keyboard);
}

async function showGameMenu(ctx: BotContext): Promise<void> {
    await replaceWithText(
        ctx,
        '🎮 لعبة الصور والكلمات\n\nاختر طريقة اللعب:',
        new InlineKeyboard()
            .text('🚀 العب وحدك', 'game:solo').row()
            .text('⚔️ تحدي شخص', 'game_challenge:users:page:1').row()
            .text('🏠 الرئيسية', 'menu_main')
    );
}

async function showGameChallengeUsers(ctx: BotContext, currentUserId: number, page: number, query = ''): Promise<void> {
    const limit = 8;
    const safeQuery = query.trim().slice(0, 40);
    const like = `%${safeQuery}%`;
    const offset = (Math.max(1, page) - 1) * limit;
    const users = await ctx.db.prepare(
        `SELECT u.user_id, u.display_name, u.name
         FROM users u
         WHERE u.user_id != ?
           AND u.display_name IS NOT NULL
           AND COALESCE(u.is_banned, 0) = 0
           AND COALESCE(u.is_deleted, 0) = 0
           AND (? = '%%' OR u.display_name LIKE ? OR u.name LIKE ? OR u.username LIKE ?)
           AND EXISTS (SELECT 1 FROM word_collections c WHERE c.owner_user_id = u.user_id AND c.is_deleted = 0)
         ORDER BY COALESCE(u.last_active_at, u.updated_at, u.created_at) DESC
         LIMIT ? OFFSET ?`
    ).bind(currentUserId, like, like, like, like, limit + 1, offset).all<{ user_id: number; display_name: string | null; name: string }>();
    const rows = users.results ?? [];
    const visible = rows.slice(0, limit);
    const safePage = Math.max(1, page);
    const keyboard = new InlineKeyboard();
    for (const candidate of visible) {
        keyboard.text(`👤 ${displayUserName(candidate)}`, `game_challenge:opponent:${candidate.user_id}`).row();
    }
    if (safePage > 1) keyboard.text('⬅️ السابق', `game_challenge:users:page:${safePage - 1}`);
    if (rows.length > limit) keyboard.text('التالي ➡️', `game_challenge:users:page:${safePage + 1}`);
    if (safePage > 1 || rows.length > limit) keyboard.row();
    keyboard.text('🔍 بحث عن مستخدم', 'game_challenge:search').row()
        .text('⬅️ رجوع', 'game:menu')
        .text('🏠 الرئيسية', 'menu_main');
    const text = visible.length === 0
        ? '⚔️ تحدي شخص\n\nلا يوجد مستخدم مناسب للتحدي حالياً.'
        : `⚔️ تحدي شخص\n\nاختر مستخدم حتى ترسل له تحدي لعبة الصور والكلمات.${safeQuery ? `\n\nبحث: ${safeQuery}` : ''}`;
    await replaceWithText(ctx, text, keyboard);
}

async function showGameChallengeSources(ctx: BotContext, opponentUserId: number): Promise<void> {
    await replaceWithText(ctx, 'اختر مصدر كلمات تحدي اللعبة:', new InlineKeyboard()
        .text('📚 من مجموعاتي', `game_challenge:source:mine:${opponentUserId}`).row()
        .text('📚 من مجموعاته', `game_challenge:source:opponent:${opponentUserId}`).row()
        .text('🔀 مختلط', `game_challenge:source:mixed:${opponentUserId}`).row()
        .text('⬅️ رجوع', 'game_challenge:users:page:1')
        .text('🏠 الرئيسية', 'menu_main'));
}

async function showGameChallengeCollections(
    ctx: BotContext,
    currentUserId: number,
    opponentUserId: number,
    sourceType: GameChallengeSourceType,
    page: number
): Promise<void> {
    const total = sourceType === 'opponent'
        ? await countOpponentPublicGameCollections(ctx.db, opponentUserId)
        : await countPlayableGameCollections(ctx.db, currentUserId);
    if (total === 0) {
        const message = sourceType === 'opponent'
            ? 'لا توجد مجموعات متاحة لهذا المستخدم.'
            : 'ما عندك مجموعة قابلة للعب. أنشئ مجموعة وأضف كلمات أولاً.';
        await replaceWithText(ctx, message, backHomeKeyboard(`game_challenge:opponent:${opponentUserId}`));
        return;
    }
    const totalPages = Math.max(1, Math.ceil(total / GAME_COLLECTION_PAGE_SIZE));
    const safePage = Math.max(1, Math.min(page, totalPages));
    const collections = sourceType === 'opponent'
        ? await getOpponentPublicGameCollections(ctx.db, opponentUserId, GAME_COLLECTION_PAGE_SIZE, (safePage - 1) * GAME_COLLECTION_PAGE_SIZE)
        : await getPlayableGameCollections(ctx.db, currentUserId, GAME_COLLECTION_PAGE_SIZE, (safePage - 1) * GAME_COLLECTION_PAGE_SIZE);
    const label = sourceType === 'mine'
        ? 'من مجموعاتي'
        : sourceType === 'opponent'
            ? 'من مجموعاته'
            : 'مختلط من مجموعتي ومجموعاته العامة';
    const keyboard = new InlineKeyboard();
    for (const collection of collections) {
        keyboard.text(`📚 ${collection.title} — ${collection.word_count} كلمة`, `game_challenge:create:${sourceType}:${opponentUserId}:${collection.id}`).row();
    }
    if (safePage > 1) keyboard.text('⬅️ السابق', `game_challenge:collections:${sourceType}:${opponentUserId}:page:${safePage - 1}`);
    if (safePage < totalPages) keyboard.text('التالي ➡️', `game_challenge:collections:${sourceType}:${opponentUserId}:page:${safePage + 1}`);
    if (safePage > 1 || safePage < totalPages) keyboard.row();
    keyboard.text('⬅️ رجوع', `game_challenge:opponent:${opponentUserId}`).text('🏠 الرئيسية', 'menu_main');
    await replaceWithText(ctx, `⚔️ تحدي شخص\n\nالمصدر: ${label}\nاختر مجموعة:\n\nالصفحة: ${safePage} / ${totalPages}`, keyboard);
}

async function createGameChallengeFromSelection(
    ctx: BotContext,
    userId: number,
    sourceType: GameChallengeSourceType,
    opponentUserId: number,
    collectionId: number
): Promise<void> {
    try {
        const challenge = await createGameChallenge(ctx.db, userId, opponentUserId, sourceType, collectionId);
        const creatorStart = `game_challenge:start:${challenge.challengeId}:creator`;
        const opponentStart = `game_challenge:start:${challenge.challengeId}:opponent`;
        const creator = await ctx.db.prepare('SELECT display_name, name FROM users WHERE user_id = ?').bind(userId).first<{ display_name: string | null; name: string }>();
        await sendTelegramMessage(
            ctx.env,
            challenge.opponent.telegram_id,
            `⚔️ ${displayUserName(creator ?? { name: 'مستخدم', display_name: 'مستخدم' })} تحداك في لعبة الصور والكلمات\n\nالمجموعة: ${challenge.collection.title}\nعدد الكلمات: ${challenge.totalQuestions}`,
            { inline_keyboard: [[{ text: '🚀 ابدأ التحدي', callback_data: opponentStart }, { text: '❌ رفض', callback_data: 'game:menu' }]] }
        ).catch(() => {});
        await replaceWithText(ctx, `تم إرسال التحدي إلى ${displayUserName(challenge.opponent)}.\n\nتقدر تبدأ دورك الآن.`, new InlineKeyboard()
            .text('🚀 ابدأ التحدي', creatorStart).row()
            .text('🏠 الرئيسية', 'menu_main'));
    } catch (error) {
        if (error instanceof MissingGameVisualError) {
            await saveBotSession<WordVisualEditSession>(ctx.db, userId, 'word_visual_edit', { wordId: error.word.word_id, collectionId }, 30);
            await replaceWithText(ctx, `هذه الكلمة تحتاج إيموجي حتى تدخل تحدي اللعبة:\n\n🇩🇪 ${error.word.german}\n🇮🇶 ${error.word.arabic}\n\nأرسل إيموجي واحد أو إيموجيين.`, backHomeKeyboard(`game_challenge:source:${sourceType}:${opponentUserId}`));
            return;
        }
        await replaceWithText(ctx, 'تعذر إنشاء تحدي اللعبة حالياً. تأكد من أن المجموعة متاحة وفيها كلمات.', backHomeKeyboard(`game_challenge:opponent:${opponentUserId}`));
    }
}

async function openGameChallenge(ctx: BotContext, userId: number, challengeId: number): Promise<void> {
    try {
        const session = await startGameChallengeForUser(ctx.db, challengeId, userId);
        const url = `${publicBaseUrl(ctx)}/game?token=${encodeURIComponent(session.token)}&v=${encodeURIComponent(GAME_UI_VERSION)}`;
        await replaceWithText(ctx, `⚔️ تحدي الصور والكلمات #${challengeId}\n\nالمجموعة: ${session.collectionTitle}\nعدد الكلمات: ${session.totalQuestions}\n\nافتح اللعبة بالمتصفح، والنتيجة تُحسب عند الخروج أو انتهاء الجولة.`, new InlineKeyboard()
            .url('🌐 فتح التحدي بالمتصفح', url).row()
            .text('🏠 الرئيسية', 'menu_main'));
    } catch {
        await replaceWithText(ctx, 'هذا التحدي غير متاح أو تم إكماله مسبقاً.', backHomeKeyboard('game:menu'));
    }
}

export async function startGameForCollection(ctx: BotContext, userId: number, collectionId: number): Promise<void> {
    try {
        const session = await createGameSession(ctx.db, userId, collectionId);
        const url = `${publicBaseUrl(ctx)}/game?token=${encodeURIComponent(session.token)}&v=${encodeURIComponent(GAME_UI_VERSION)}`;
        await replaceWithText(
            ctx,
            `🎮 تحدي الصور والكلمات\n\nالمجموعة:\n${session.collection.title}\n\nاللعبة ستستخدم كلمات هذه المجموعة.\nعدد الكلمات: ${session.totalQuestions}\n\nافتح اللعبة في Safari أو Chrome حتى يعمل المايكروفون والصوت بشكل صحيح.`,
            new InlineKeyboard()
                .url('🌐 فتح اللعبة بالمتصفح', url).row()
                .text('⬅️ رجوع للمجموعة', `collection:view:${collectionId}:page:1`)
                .text('🏠 الرئيسية', 'menu_main')
        );
    } catch (error) {
        if (error instanceof MissingGameVisualError) {
            await saveBotSession<WordVisualEditSession>(
                ctx.db,
                userId,
                'word_visual_edit',
                { wordId: error.word.word_id, collectionId },
                30
            );
            await replaceWithText(
                ctx,
                `🎨 بعض كلمات هذه المجموعة تحتاج إيموجي حتى تبدأ اللعبة.\n\nالكلمة:\n🇩🇪 ${error.word.german}\n\nالمعنى:\n🇮🇶 ${error.word.arabic}\n\nأرسل إيموجي واحد أو إيموجيين يوضحون المعنى.\n\nالصور والروابط غير مقبولة.`,
                new InlineKeyboard()
                    .text('❌ إلغاء', `word_visual_cancel:${error.word.word_id}`).row()
                    .text('⬅️ رجوع للمجموعة', `collection:view:${collectionId}:page:1`)
                    .text('🏠 الرئيسية', 'menu_main')
            );
            return;
        }
        const message = error instanceof Error ? error.message : 'unknown';
        if (message === 'collection_empty') {
            await replaceWithText(ctx, 'هذه المجموعة فارغة. أضف كلمات أولاً.', backHomeKeyboard(`collection:view:${collectionId}:page:1`));
            return;
        }
        if (message === 'collection_not_allowed') {
            await replaceWithText(ctx, 'لا يمكنك تشغيل اللعبة على هذه المجموعة.', backHomeKeyboard('game:menu'));
            return;
        }
        throw error;
    }
}

async function handleManualVisualText(ctx: BotContext, userId: number, wordId: number, text: string, collectionId?: number): Promise<void> {
    const word = await getWordById(ctx.db, wordId);
    if (!word || word.added_by !== userId) {
        await deleteBotSession(ctx.db, userId, 'word_visual_edit');
        await ctx.reply('ما قدرت أحفظ الرمز لهذه الكلمة.');
        return;
    }

    const visual = validateManualVisual(text);
    if (!visual) {
        await ctx.reply(
            'الإيموجي غير صالح.\n\nأرسل إيموجي واحد أو إيموجيين فقط.\nلا ترسل نصاً عادياً أو رابطاً أو صورة.',
            { reply_markup: new InlineKeyboard().text('❌ إلغاء', `word_visual_cancel:${wordId}`) }
        );
        return;
    }

    await upsertManualVisual(ctx.db, wordId, visual);
    if (collectionId) {
        const missing = await findMissingVisualsForCollection(ctx.db, userId, collectionId);
        const nextMissing = missing.find(item => item.word_id !== wordId);
        if (nextMissing) {
            await saveBotSession<WordVisualEditSession>(
                ctx.db,
                userId,
                'word_visual_edit',
                { wordId: nextMissing.word_id, collectionId },
                30
            );
            await ctx.reply(
                `تم حفظ الإيموجي ✅\n\nباقي كلمة تحتاج إيموجي:\n\n🇩🇪 ${nextMissing.german}\n🇮🇶 ${nextMissing.arabic}\n\nأرسل إيموجي واحد أو إيموجيين يوضحون المعنى.`,
                {
                    reply_markup: new InlineKeyboard()
                        .text('❌ إلغاء', `word_visual_cancel:${nextMissing.word_id}`).row()
                        .text('⬅️ رجوع للمجموعة', `collection:view:${collectionId}:page:1`)
                        .text('🏠 الرئيسية', 'menu_main'),
                }
            );
            return;
        }

        await deleteBotSession(ctx.db, userId, 'word_visual_edit');
        await ctx.reply(
            'تم حفظ كل الإيموجيات المطلوبة ✅\n\nتقدر تبدأ اللعبة الآن.',
            {
                reply_markup: new InlineKeyboard()
                    .text('🚀 ابدأ اللعبة الآن', `game:start_collection:${collectionId}`).row()
                    .text('⬅️ رجوع للمجموعة', `collection:view:${collectionId}:page:1`)
                    .text('🏠 الرئيسية', 'menu_main'),
            }
        );
        return;
    }
    await deleteBotSession(ctx.db, userId, 'word_visual_edit');
    await showWordDetailPanel(ctx, wordId, 'تم حفظ الرمز لهذه الكلمة ✅');
}

async function currentUser(ctx: BotContext) {
    const telegramId = ctx.from?.id;
    if (!telegramId) {
        await ctx.reply('تعذر تحديد حسابك. أرسل /start ثم جرّب مرة ثانية.');
        return null;
    }
    const user = await getUserByTelegramId(ctx.db, telegramId);
    if (!user?.display_name) {
        await ctx.reply('اكتب /start وسجل اسمك أولاً.');
        return null;
    }
    return user;
}

function publicBaseUrl(ctx: BotContext): string {
    return (ctx.env as { PUBLIC_BASE_URL?: string }).PUBLIC_BASE_URL?.replace(/\/+$/, '') || 'https://deutschdrop.aque7x.workers.dev';
}

function backHomeKeyboard(backCallback: string): InlineKeyboard {
    return new InlineKeyboard()
        .text('⬅️ رجوع', backCallback)
        .text('🏠 الرئيسية', 'menu_main');
}
