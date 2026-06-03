import { Bot, InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot/context';
import { getPictogramByWordId, upsertPictogramForWord } from '../repositories/pictogramRepository';
import { getUserByTelegramId } from '../repositories/userRepository';
import { getWordById } from '../repositories/wordRepository';
import { searchEducationalPictograms, type PictogramSearchResult } from '../services/pictogramSearch';

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

    bot.callbackQuery(/^pictogram_use_(\d+)_(\d+)$/, async (ctx) => {
        const wordId = parseInt(ctx.match[1], 10);
        const pictogramId = ctx.match[2];
        await ctx.answerCallbackQuery();
        await choosePictogram(ctx, wordId, pictogramId);
    });
}

export async function startPictogramSelection(ctx: BotContext, wordId: number): Promise<void> {
    const word = await getOwnedWord(ctx, wordId);
    if (!word) return;

    const results = await searchEducationalPictograms(word.german, word.arabic, 3);
    await sendPictogramOptions(ctx, word.word_id, word.german, results);
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
        await ctx.reply(NO_SAVED_PICTOGRAM_MESSAGE, {
            reply_markup: new InlineKeyboard().text('🖼 تعيين رمز', `pictogram_assign_${word.word_id}`),
        });
        return;
    }

    await ctx.replyWithPhoto(saved.image_url, {
        caption: `${word.german} = ${word.arabic}\n${saved.title}\n\n${saved.attribution}`,
        reply_markup: new InlineKeyboard().text('🔄 تغيير الرمز', `pictogram_change_${word.word_id}`),
    });
}

async function sendPictogramOptions(
    ctx: BotContext,
    wordId: number,
    german: string,
    results: PictogramSearchResult[]
): Promise<void> {
    if (results.length === 0) {
        await ctx.reply(NO_PICTOGRAM_MESSAGE);
        return;
    }

    await ctx.reply(`🖼 اختر الرمز التعليمي المناسب لـ ${german}:`);
    for (const result of results.slice(0, 3)) {
        await ctx.replyWithPhoto(result.imageUrl, {
            caption: `${result.title}\n\n${result.attribution}`,
            reply_markup: new InlineKeyboard()
                .text('✅ استخدم هذا الرمز', `pictogram_use_${wordId}_${result.pictogramId}`),
        });
    }
}

async function choosePictogram(ctx: BotContext, wordId: number, pictogramId: string): Promise<void> {
    const word = await getOwnedWord(ctx, wordId);
    if (!word) return;

    const results = await searchEducationalPictograms(word.german, word.arabic, 10);
    const selected = results.find(result => result.pictogramId === pictogramId);
    if (!selected) {
        await ctx.reply(NO_PICTOGRAM_MESSAGE);
        return;
    }

    await upsertPictogramForWord(ctx.db, word.word_id, selected);
    await ctx.reply(`تم حفظ الرمز التعليمي ✅\n\n${selected.attribution}`);
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
        await ctx.reply('⚠️ لم أجد هذه الكلمة في بنك كلماتك.');
        return null;
    }

    return word;
}
