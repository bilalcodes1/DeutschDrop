import { Bot, InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot/context';
import { getPictogramByWordId, upsertPictogramForWord } from '../repositories/pictogramRepository';
import { getUserByTelegramId } from '../repositories/userRepository';
import { getWordById } from '../repositories/wordRepository';
import { searchEducationalPictograms, type PictogramSearchResult } from '../services/pictogramSearch';
import { navigationKeyboard, replaceWithText, showWordDetailPanel } from './wordPanel';

const NO_PICTOGRAM_MESSAGE = 'لم أجد رمزاً تعليمياً مناسباً لهذه الكلمة.';
const NO_SAVED_PICTOGRAM_MESSAGE = 'لا يوجد رمز محفوظ لهذه الكلمة. اضغط 🖼 تعيين رمز.';

export function registerPictogramCommand(bot: Bot<BotContext>): void {
    bot.callbackQuery(/^pictogram_search_(\d+)$/, async (ctx) => {
        const wordId = parseInt(ctx.match[1], 10);
        await ctx.answerCallbackQuery();
        await showSavedOrSearchPictograms(ctx, wordId);
    });

    bot.callbackQuery(/^pictogram_assign_(\d+)$/, async (ctx) => {
        const wordId = parseInt(ctx.match[1], 10);
        await ctx.answerCallbackQuery('جاري البحث عن رموز تعليمية...');
        await startPictogramSelection(ctx, wordId);
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

    bot.callbackQuery(/^pictogram_nav_(\d+)_(\d+)$/, async (ctx) => {
        const wordId = parseInt(ctx.match[1], 10);
        const index = parseInt(ctx.match[2], 10);
        await ctx.answerCallbackQuery();
        await showPictogramCandidate(ctx, wordId, index);
    });

    bot.callbackQuery(/^pictogram_use_(\d+)_(\d+)$/, async (ctx) => {
        const wordId = parseInt(ctx.match[1], 10);
        const pictogramId = ctx.match[2];
        await ctx.answerCallbackQuery();
        await choosePictogram(ctx, wordId, pictogramId);
    });

    bot.callbackQuery(/^pictogram_cancel_(\d+)$/, async (ctx) => {
        const wordId = parseInt(ctx.match[1], 10);
        await ctx.answerCallbackQuery('تم الإلغاء');
        await showWordDetailPanel(ctx, wordId);
    });
}

export async function startPictogramSelection(ctx: BotContext, wordId: number): Promise<void> {
    await showPictogramCandidate(ctx, wordId, 0);
}

async function showSavedOrSearchPictograms(ctx: BotContext, wordId: number): Promise<void> {
    const saved = await getPictogramByWordId(ctx.db, wordId);
    if (saved) {
        await showSavedPictogram(ctx, wordId);
        return;
    }

    await startPictogramSelection(ctx, wordId);
}

async function showSavedPictogram(ctx: BotContext, wordId: number): Promise<void> {
    const word = await getOwnedWord(ctx, wordId);
    if (!word) return;

    const saved = await getPictogramByWordId(ctx.db, word.word_id);
    if (!saved) {
        await replaceWithText(ctx, NO_SAVED_PICTOGRAM_MESSAGE, new InlineKeyboard()
            .text('🖼 تعيين رمز', `pictogram_assign_${word.word_id}`).row()
            .text('⬅️ رجوع', `word_detail_${word.word_id}`)
            .text('🏠 الرئيسية', 'menu_main'));
        return;
    }

    await editOrSendPhoto(ctx, saved.image_url, `${word.german} = ${word.arabic}\n${saved.title}\n\n${saved.attribution}`, new InlineKeyboard()
        .text('🔄 تغيير الرمز', `pictogram_change_${word.word_id}`).row()
        .text('⬅️ رجوع', `word_detail_${word.word_id}`)
        .text('🏠 الرئيسية', 'menu_main'));
}

async function showPictogramCandidate(ctx: BotContext, wordId: number, index: number): Promise<void> {
    const word = await getOwnedWord(ctx, wordId);
    if (!word) return;

    const results = await searchEducationalPictograms(word.german, word.arabic, 3);
    if (results.length === 0) {
        await replaceWithText(ctx, NO_PICTOGRAM_MESSAGE, navigationKeyboard(`word_detail_${word.word_id}`));
        return;
    }

    const safeIndex = ((index % results.length) + results.length) % results.length;
    const result = results[safeIndex];
    const keyboard = new InlineKeyboard()
        .text('⬅️ السابق', `pictogram_nav_${word.word_id}_${safeIndex - 1}`)
        .text('✅ استخدم هذا الرمز', `pictogram_use_${word.word_id}_${result.pictogramId}`)
        .text('التالي ➡️', `pictogram_nav_${word.word_id}_${safeIndex + 1}`).row()
        .text('❌ إلغاء', `pictogram_cancel_${word.word_id}`)
        .text('🏠 الرئيسية', 'menu_main');

    await editOrSendPhoto(
        ctx,
        result.imageUrl,
        `🖼 ${word.german}\nنتيجة ${safeIndex + 1}/${results.length}\n${result.title}\n\n${result.attribution}`,
        keyboard
    );
}

async function choosePictogram(ctx: BotContext, wordId: number, pictogramId: string): Promise<void> {
    const word = await getOwnedWord(ctx, wordId);
    if (!word) return;

    const results = await searchEducationalPictograms(word.german, word.arabic, 10);
    const selected = results.find(result => result.pictogramId === pictogramId);
    if (!selected) {
        await replaceWithText(ctx, NO_PICTOGRAM_MESSAGE, navigationKeyboard(`word_detail_${word.word_id}`));
        return;
    }

    await upsertPictogramForWord(ctx.db, word.word_id, selected);
    await showWordDetailPanel(ctx, word.word_id, 'تم حفظ الرمز ✅');
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
