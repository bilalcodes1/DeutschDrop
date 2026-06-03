import { Bot, InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot/context';
import { saveWordPictogram } from '../repositories/pictogramRepository';
import { getUserByTelegramId } from '../repositories/userRepository';
import { getWordById } from '../repositories/wordRepository';
import { searchEducationalPictograms } from '../services/pictogramSearch';

const NO_PICTOGRAM_MESSAGE = 'لم أجد رمزاً تعليمياً مناسباً لهذه الكلمة.';

export function registerPictogramCommand(bot: Bot<BotContext>): void {
    bot.callbackQuery(/^pictogram_search_(\d+)$/, async (ctx) => {
        const wordId = parseInt(ctx.match[1], 10);
        await ctx.answerCallbackQuery('جاري البحث عن رموز تعليمية...');
        await showPictogramOptions(ctx, wordId);
    });

    bot.callbackQuery(/^pictogram_use_(\d+)_(\d+)$/, async (ctx) => {
        const wordId = parseInt(ctx.match[1], 10);
        const pictogramId = ctx.match[2];
        await ctx.answerCallbackQuery();
        await choosePictogram(ctx, wordId, pictogramId);
    });
}

async function showPictogramOptions(ctx: BotContext, wordId: number): Promise<void> {
    const word = await getOwnedWord(ctx, wordId);
    if (!word) return;

    const results = await searchEducationalPictograms(word.german, word.arabic, 3);
    if (results.length === 0) {
        await ctx.reply(NO_PICTOGRAM_MESSAGE);
        return;
    }

    await ctx.reply(`🖼 اختر الرمز التعليمي المناسب لـ ${word.german}:`);
    for (const result of results) {
        await ctx.replyWithPhoto(result.imageUrl, {
            caption: `${result.title}\n\nPictogram: ${result.attribution}`,
            reply_markup: new InlineKeyboard()
                .text('✅ استخدم هذا الرمز', `pictogram_use_${word.word_id}_${result.pictogramId}`),
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

    await saveWordPictogram(ctx.db, word.word_id, selected);
    await ctx.reply(`✅ تم حفظ الرمز التعليمي لـ ${word.german}.\n\nPictogram: ${selected.attribution}`);
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
