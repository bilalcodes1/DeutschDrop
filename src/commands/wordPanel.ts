import { InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot/context';
import { getPictogramByWordId } from '../repositories/pictogramRepository';
import { getWordById } from '../repositories/wordRepository';
import type { Word } from '../models';

export async function showWordDetailPanel(ctx: BotContext, wordId: number, notice?: string): Promise<void> {
    const word = await getWordById(ctx.db, wordId);
    if (!word) {
        await replaceWithText(ctx, '⚠️ لم أجد هذه الكلمة.', navigationKeyboard('list_words'));
        return;
    }

    const pictogram = await getPictogramByWordId(ctx.db, word.word_id);
    const text = (notice ? `${notice}\n\n` : '') + formatWordDetail(word, Boolean(pictogram));
    await replaceWithText(ctx, text, wordDetailKeyboard(word.word_id, Boolean(pictogram)), 'Markdown');
}

export async function replaceWithText(
    ctx: BotContext,
    text: string,
    replyMarkup?: InlineKeyboard,
    parseMode?: 'Markdown'
): Promise<void> {
    try {
        await ctx.editMessageText(text, {
            parse_mode: parseMode,
            reply_markup: replyMarkup,
        });
    } catch {
        if (ctx.callbackQuery?.message) {
            try {
                await ctx.deleteMessage();
            } catch {
                // Best effort: Telegram may reject deleting old messages.
            }
        }
        await ctx.reply(text, {
            parse_mode: parseMode,
            reply_markup: replyMarkup,
        });
    }
}

export function navigationKeyboard(backCallback: string): InlineKeyboard {
    return new InlineKeyboard()
        .text('⬅️ رجوع', backCallback)
        .text('🏠 الرئيسية', 'menu_main');
}

function formatWordDetail(word: Word, hasPictogram: boolean): string {
    return `📄 *الكلمة*\n\n` +
        `🇩🇪 *${word.german}*\n` +
        `🇦🇪 ${word.arabic}` +
        (word.example ? `\n💬 _${word.example}_` : '') +
        `\n\n🖼 الرمز التعليمي: ${hasPictogram ? 'محفوظ ✅' : 'غير معين'}`;
}

function wordDetailKeyboard(wordId: number, hasPictogram: boolean): InlineKeyboard {
    const keyboard = new InlineKeyboard();
    if (hasPictogram) {
        keyboard
            .text('🖼 عرض الرمز', `pictogram_view_${wordId}`)
            .text('🔄 تغيير الرمز', `pictogram_change_${wordId}`)
            .row();
    } else {
        keyboard.text('🖼 تعيين رمز', `pictogram_assign_${wordId}`).row();
    }

    return keyboard
        .text('✏️ تعديل', `edit_word_${wordId}`)
        .text('🗑 حذف', `delete_word_${wordId}`).row()
        .text('⬅️ رجوع', 'list_words')
        .text('🏠 الرئيسية', 'menu_main');
}
