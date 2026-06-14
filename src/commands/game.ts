import { Bot, InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot/context';
import { getUserByTelegramId } from '../repositories/userRepository';
import { deleteBotSession, getBotSession, saveBotSession } from '../repositories/sessionRepository';
import { getWordById } from '../repositories/wordRepository';
import {
    createGameSession,
    GAME_UI_VERSION,
    MissingGameVisualError,
    countPlayableGameCollections,
    findMissingVisualsForCollection,
    getPlayableGameCollections,
} from '../services/gameSessionService';
import { upsertManualVisual, validateManualVisual } from '../services/gameVisualService';
import { replaceWithText, showWordDetailPanel } from './wordPanel';

const GAME_COLLECTION_PAGE_SIZE = 8;

interface WordVisualEditSession {
    wordId: number;
    collectionId?: number;
}

export function registerGameCommand(bot: Bot<BotContext>): void {
    bot.command('game', async (ctx) => {
        const user = await currentUser(ctx);
        if (!user) return;
        await showGameCollections(ctx, user.user_id, 1);
    });

    bot.on('message:text', async (ctx, next) => {
        const telegramId = ctx.from?.id;
        if (!telegramId) return next();
        const user = await getUserByTelegramId(ctx.db, telegramId);
        if (!user) return next();

        if (await getBotSession(ctx.db, user.user_id, 'train')) return next();
        if (await getBotSession(ctx.db, user.user_id, 'challenge')) return next();

        const session = await getBotSession<WordVisualEditSession>(ctx.db, user.user_id, 'word_visual_edit');
        if (!session) return next();

        await handleManualVisualText(ctx, user.user_id, session.data.wordId, ctx.message.text, session.data.collectionId);
    });

    bot.callbackQuery('game:menu', async (ctx) => {
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
    const total = await countPlayableGameCollections(ctx.db, userId);
    if (total === 0) {
        await replaceWithText(
            ctx,
            '🎮 لعبة الصور والكلمات\n\nما عندك مجموعات قابلة للعب حالياً. أنشئ مجموعة أو أضف كلمات لمجموعة أولاً.',
            new InlineKeyboard()
                .text('🗂 مجموعات الكلمات', 'collections:menu').row()
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

    const text = `🎮 لعبة الصور والكلمات\n\nاختر مجموعة حتى تبدأ لعبة الصور والكلمات.\n\nالصفحة: ${safePage} / ${totalPages}`;
    const keyboard = new InlineKeyboard();
    for (const collection of collections) {
        keyboard.text(`📚 ${collection.title} — ${collection.word_count} كلمة`, `game:start:${collection.id}`).row();
    }
    if (safePage > 1) keyboard.text('⬅️ السابق', `game:collections:page:${safePage - 1}`);
    if (safePage < totalPages) keyboard.text('التالي ➡️', `game:collections:page:${safePage + 1}`);
    if (safePage > 1 || safePage < totalPages) keyboard.row();
    keyboard.text('🏠 الرئيسية', 'menu_main');
    await replaceWithText(ctx, text, keyboard);
}

export async function startGameForCollection(ctx: BotContext, userId: number, collectionId: number): Promise<void> {
    try {
        const session = await createGameSession(ctx.db, userId, collectionId);
        const url = `${publicBaseUrl(ctx)}/game?token=${encodeURIComponent(session.token)}&v=${encodeURIComponent(GAME_UI_VERSION)}`;
        await replaceWithText(
            ctx,
            `🎮 تحدي الصور والكلمات\n\nالمجموعة:\n${session.collection.title}\n\nعدد الأسئلة: ${session.totalQuestions}\n\nافتح اللعبة في Safari أو Chrome حتى يعمل المايكروفون والصوت بشكل صحيح.`,
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
