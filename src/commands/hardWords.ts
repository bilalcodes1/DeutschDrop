import { Bot, InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot/context';
import { getUserByTelegramId } from '../repositories/userRepository';
import { getWordsForUserWithStatus } from '../repositories/wordRepository';
import { updateWordProgress } from '../repositories/srsRepository';
import { isHardWord } from '../services/srs';
import { mainMenuKeyboard } from './menu';

export function registerHardWordsCommand(bot: Bot<BotContext>): void {
    bot.command('hard_words', async (ctx) => {
        await showHardWords(ctx);
    });

    bot.callbackQuery('hard_words', async (ctx) => {
        await ctx.answerCallbackQuery();
        await showHardWords(ctx);
    });

    bot.callbackQuery(/^hard_clear_(\d+)$/, async (ctx) => {
        const user = await getCurrentUser(ctx);
        if (!user) return;

        const wordId = parseInt(ctx.match[1], 10);
        await updateWordProgress(ctx.db, user.user_id, wordId, {
            status: 'reviewing',
            wrong_count: 0,
        });
        await ctx.answerCallbackQuery('تمت إزالتها من الكلمات الصعبة');
        await showHardWords(ctx);
    });
}

async function showHardWords(ctx: BotContext): Promise<void> {
    const user = await getCurrentUser(ctx);
    if (!user) return;

    const words = await getWordsForUserWithStatus(ctx.db, user.user_id);
    const hardWords = words.filter(word => isHardWord({
        wrongCount: word.wrong_count,
        correctCount: word.correct_count,
        status: word.status,
    }));

    const keyboard = new InlineKeyboard();
    if (hardWords.length > 0) {
        keyboard.text('🔥 تدريب الكلمات الصعبة', 'train_hard').row();
        for (const word of hardWords.slice(0, 8)) {
            keyboard.text(`🔊 ${word.german}`, `tts:word:${word.word_id}:ctx:hard_words`).row();
            keyboard.text(`إزالة: ${word.german}`, `hard_clear_${word.word_id}`).row();
        }
    }
    keyboard.text('⬅️ رجوع', 'menu_main');

    const preview = hardWords.slice(0, 10)
        .map((word, index) => `${index + 1}. ${word.german} = ${word.arabic}`)
        .join('\n');

    await ctx.reply(
        `📌 *الكلمات الصعبة*\n\n` +
        `العدد: ${hardWords.length}\n\n` +
        `${preview || 'لا توجد كلمات صعبة حالياً.'}`,
        { parse_mode: 'Markdown', reply_markup: hardWords.length > 0 ? keyboard : mainMenuKeyboard() }
    );
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
