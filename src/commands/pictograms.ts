import { Bot, InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot/context';
import { getPictogramByWordId, upsertPictogramForWord } from '../repositories/pictogramRepository';
import { getUserByTelegramId } from '../repositories/userRepository';
import { getWordById } from '../repositories/wordRepository';
import { searchEducationalPictograms, type PictogramSearchResult } from '../services/pictogramSearch';
import { normalizeReturnContext, sideFlowBackCallback, type ReturnContext } from '../services/returnContext';
import { showCurrentLearnWord } from './learn';
import { showCurrentTrainingQuestion } from './train';
import { navigationKeyboard, replaceWithText, showWordDetailPanel } from './wordPanel';

const NO_PICTOGRAM_MESSAGE = 'لم أجد رمزاً تعليمياً مناسباً لهذه الكلمة.';
const NO_SAVED_PICTOGRAM_MESSAGE = 'لا يوجد رمز محفوظ لهذه الكلمة. اضغط 🖼 تعيين رمز.';

export function registerPictogramCommand(bot: Bot<BotContext>): void {
    bot.callbackQuery(/^pictogram_search_(\d+)$/, async (ctx) => {
        const wordId = parseInt(ctx.match[1], 10);
        await ctx.answerCallbackQuery();
        await showSavedOrSearchPictograms(ctx, wordId);
    });

    bot.callbackQuery(/^(?:pictogram_assign_|pictogram:change:)(\d+)(?::ctx:([a-z_]+))?$/, async (ctx) => {
        const wordId = parseInt(ctx.match[1], 10);
        const context = normalizeReturnContext(ctx.match[2]);
        await ctx.answerCallbackQuery('جاري البحث عن رموز تعليمية...');
        await startPictogramSelection(ctx, wordId, context);
    });

    bot.callbackQuery(/^pictogram_change_(\d+)$/, async (ctx) => {
        const wordId = parseInt(ctx.match[1], 10);
        await ctx.answerCallbackQuery('جاري البحث عن رموز تعليمية...');
        await startPictogramSelection(ctx, wordId);
    });

    bot.callbackQuery(/^pictogram_view_(\d+)$/, async (ctx) => {
        const wordId = parseInt(ctx.match[1], 10);
        await ctx.answerCallbackQuery();
        await showSavedPictogram(ctx, wordId);
    });

    bot.callbackQuery(/^pictogram:view:(\d+)(?::ctx:([a-z_]+))?$/, async (ctx) => {
        const wordId = parseInt(ctx.match[1], 10);
        const context = normalizeReturnContext(ctx.match[2]);
        await ctx.answerCallbackQuery();
        await showSavedPictogram(ctx, wordId, context);
    });

    bot.callbackQuery(/^(?:pictogram_nav_|pictogram:(?:next|prev):)(\d+)(?::|_)(-?\d+)(?::ctx:([a-z_]+))?$/, async (ctx) => {
        const wordId = parseInt(ctx.match[1], 10);
        const index = parseInt(ctx.match[2], 10);
        const context = normalizeReturnContext(ctx.match[3]);
        await ctx.answerCallbackQuery();
        await showPictogramCandidate(ctx, wordId, index, context);
    });

    bot.callbackQuery(/^(?:pictogram_use_|pictogram:use:)(\d+)(?::|_)([^:]+)(?::ctx:([a-z_]+))?$/, async (ctx) => {
        const wordId = parseInt(ctx.match[1], 10);
        const pictogramId = ctx.match[2];
        const context = normalizeReturnContext(ctx.match[3]);
        await ctx.answerCallbackQuery();
        await choosePictogram(ctx, wordId, pictogramId, context);
    });

    bot.callbackQuery(/^(?:pictogram_cancel_|pictogram:back:)(\d+)(?::ctx:([a-z_]+))?$/, async (ctx) => {
        const wordId = parseInt(ctx.match[1], 10);
        const context = normalizeReturnContext(ctx.match[2]);
        await ctx.answerCallbackQuery('تم الإلغاء');
        await runPictogramCallback(ctx, 'pictogram_back', wordId, () => returnToContext(ctx, wordId, context));
    });
}

export async function startPictogramSelection(ctx: BotContext, wordId: number, context: ReturnContext = 'word_details'): Promise<void> {
    await showPictogramCandidate(ctx, wordId, 0, context);
}

async function showSavedOrSearchPictograms(ctx: BotContext, wordId: number): Promise<void> {
    const saved = await getPictogramByWordId(ctx.db, wordId);
    if (saved) {
        await showSavedPictogram(ctx, wordId);
        return;
    }

    await startPictogramSelection(ctx, wordId);
}

async function showSavedPictogram(ctx: BotContext, wordId: number, context: ReturnContext = 'word_details'): Promise<void> {
    const word = await getOwnedWord(ctx, wordId);
    if (!word) return;

    const saved = await getPictogramByWordId(ctx.db, word.word_id);
    if (!saved) {
        await replaceWithText(ctx, NO_SAVED_PICTOGRAM_MESSAGE, new InlineKeyboard()
            .text('🖼 تعيين رمز', `pictogram:change:${word.word_id}:ctx:${context}`).row()
            .text('⬅️ رجوع', `pictogram:back:${word.word_id}:ctx:${context}`)
            .text('🏠 الرئيسية', 'menu_main'));
        return;
    }

    await editOrSendPhoto(ctx, saved.image_url, `${word.german} = ${word.arabic}\n${saved.title}\n\n${saved.attribution}`, new InlineKeyboard()
        .text('🔄 تغيير الرمز', `pictogram:change:${word.word_id}:ctx:${context}`).row()
        .text('⬅️ رجوع', `pictogram:back:${word.word_id}:ctx:${context}`)
        .text('🏠 الرئيسية', 'menu_main'));
}

async function showPictogramCandidate(ctx: BotContext, wordId: number, index: number, context: ReturnContext = 'word_details'): Promise<void> {
    const word = await getOwnedWord(ctx, wordId);
    if (!word) return;

    const results = await searchEducationalPictograms(word.german, word.arabic, 3);
    if (results.length === 0) {
        await replaceWithText(ctx, NO_PICTOGRAM_MESSAGE, navigationKeyboard(sideFlowBackCallback(word.word_id, context)));
        return;
    }

    const safeIndex = ((index % results.length) + results.length) % results.length;
    const result = results[safeIndex];
    const keyboard = new InlineKeyboard()
        .text('⬅️ السابق', `pictogram:prev:${word.word_id}:${safeIndex - 1}:ctx:${context}`)
        .text('✅ استخدم هذا الرمز', `pictogram:use:${word.word_id}:${result.pictogramId}:ctx:${context}`)
        .text('التالي ➡️', `pictogram:next:${word.word_id}:${safeIndex + 1}:ctx:${context}`).row()
        .text('❌ إلغاء', `pictogram:back:${word.word_id}:ctx:${context}`)
        .text('🏠 الرئيسية', 'menu_main');

    await editOrSendPhoto(
        ctx,
        result.imageUrl,
        `🖼 ${word.german}\nنتيجة ${safeIndex + 1}/${results.length}\n${result.title}\n\n${result.attribution}`,
        keyboard
    );
}

async function choosePictogram(ctx: BotContext, wordId: number, pictogramId: string, context: ReturnContext = 'word_details'): Promise<void> {
    const word = await getOwnedWord(ctx, wordId);
    if (!word) return;

    const results = await searchEducationalPictograms(word.german, word.arabic, 10);
    const selected = results.find(result => result.pictogramId === pictogramId);
    if (!selected) {
        await replaceWithText(ctx, NO_PICTOGRAM_MESSAGE, navigationKeyboard(sideFlowBackCallback(word.word_id, context)));
        return;
    }

    await runPictogramCallback(ctx, 'pictogram_use', word.word_id, async () => {
        await upsertPictogramForWord(ctx.db, word.word_id, selected);
        if (context === 'word_details') {
            await showWordDetailPanel(ctx, word.word_id, '✅ تم حفظ الرمز.');
            return;
        }
        await replaceWithText(ctx, '✅ تم حفظ الرمز.', navigationKeyboard(sideFlowBackCallback(word.word_id, context)));
        await returnToContext(ctx, word.word_id, context);
    });
}

async function returnToContext(ctx: BotContext, wordId: number, context: ReturnContext): Promise<void> {
    const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
    if (context === 'learn_session' && user) {
        await showCurrentLearnWord(ctx, user.user_id);
        return;
    }
    if ((context === 'training_session' || context === 'review_plan') && user) {
        await showCurrentTrainingQuestion(ctx, user.user_id);
        return;
    }
    await showWordDetailPanel(ctx, wordId);
}

async function editOrSendPhoto(ctx: BotContext, imageUrl: string, caption: string, keyboard: InlineKeyboard): Promise<void> {
    try {
        if (ctx.callbackQuery?.message) {
            await ctx.editMessageMedia(
                { type: 'photo', media: imageUrl, caption },
                { reply_markup: keyboard }
            );
            return;
        }
    } catch {
        if (ctx.callbackQuery?.message) {
            try {
                await ctx.deleteMessage();
            } catch {
                // Best effort cleanup when Telegram cannot edit text<->media.
            }
        }
    }

    await ctx.replyWithPhoto(imageUrl, { caption, reply_markup: keyboard });
}

async function getOwnedWord(ctx: BotContext, wordId: number) {
    const telegramId = ctx.from?.id ?? 0;
    const user = await getUserByTelegramId(ctx.db, telegramId);
    if (!user) {
        await ctx.reply('يرجى استخدام /start أولاً.');
        return null;
    }

    const word = await getWordById(ctx.db, wordId);
    if (!word || word.added_by !== user.user_id) {
        await replaceWithText(ctx, '⚠️ لم أجد هذه الكلمة في بنك كلماتك.', navigationKeyboard('list_words'));
        return null;
    }

    return word;
}

async function runPictogramCallback(ctx: BotContext, action: string, wordId: number, run: () => Promise<void>): Promise<void> {
    try {
        await run();
    } catch (error) {
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        const err = error instanceof Error ? error : new Error('unknown');
        console.warn('word_callback_failed', {
            userId: user?.user_id,
            callbackData: ctx.callbackQuery?.data,
            action,
            wordId,
            page: undefined,
            errorName: err.name,
            errorMessage: err.message.slice(0, 200),
        });
        const isAdmin = ctx.env.ADMIN_TELEGRAM_IDS?.split(',').map(id => id.trim()).includes(String(ctx.from?.id)) ?? false;
        await replaceWithText(
            ctx,
            `حدث خطأ بسيط، جرّب مرة ثانية.` + (isAdmin ? `\n\nDebug: ${err.message.slice(0, 160)}` : ''),
            new InlineKeyboard()
                .text('🔄 إعادة المحاولة', `pictogram:back:${wordId}`).row()
                .text('📂 كلماتي', 'list_words')
                .text('🏠 الرئيسية', 'menu_main')
        );
    }
}
