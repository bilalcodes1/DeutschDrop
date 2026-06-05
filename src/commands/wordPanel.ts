import { InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot/context';
import { getPictogramByWordId } from '../repositories/pictogramRepository';
import { getWordById } from '../repositories/wordRepository';
import type { Word } from '../models';
import { getUserByTelegramId } from '../repositories/userRepository';
import { buildYouglishDirectUrl } from '../services/youglish';

export async function showWordDetailPanel(ctx: BotContext, wordId: number, notice?: string, backCallback = 'list_words'): Promise<void> {
    const word = await getWordById(ctx.db, wordId);
    if (!word) {
        await replaceWithText(ctx, '⚠️ لم أجد هذه الكلمة.', navigationKeyboard(backCallback));
        return;
    }

    const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
    if (user && word.added_by !== user.user_id) {
        await replaceWithText(ctx, '⚠️ لم أجد هذه الكلمة في بنك كلماتك.', navigationKeyboard(backCallback));
        return;
    }

    const pictogram = await getPictogramByWordId(ctx.db, word.word_id);
    const progress = user
        ? await ctx.db.prepare('SELECT status FROM user_words WHERE user_id = ? AND word_id = ?').bind(user.user_id, word.word_id).first<{ status: string }>()
        : null;
    const text = (notice ? `${notice}\n\n` : '') + formatWordDetail(word, Boolean(pictogram), progress?.status ?? 'new');
    await replaceWithText(ctx, text, wordDetailKeyboard(word, Boolean(pictogram), backCallback));
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

function formatWordDetail(word: Word, hasPictogram: boolean, reviewStatus: string): string {
    return `📄 الكلمة\n\n` +
        `🇩🇪 ${word.german}\n` +
        `🇮🇶 ${word.arabic}` +
        (word.example ? `\n💬 ${word.example}` : '') +
        (word.example_ar ? `\n🇮🇶 ${word.example_ar}` : '') +
        (word.pronunciation_latin || word.pronunciation_ar
            ? `\n🗣 اللفظ:` +
                (word.pronunciation_latin ? `\nLatin: ${word.pronunciation_latin}` : '') +
                (word.pronunciation_ar ? `\nعربي: ${word.pronunciation_ar}` : '')
            : '') +
        (word.level ? `\n📊 المستوى: ${word.level}` : '') +
        `\n\n🖼 الرمز التعليمي: ${hasPictogram ? 'محفوظ ✅' : 'غير معين'}` +
        `\n🔁 حالة المراجعة: ${reviewStatusLabel(reviewStatus)}`;
}

function wordDetailKeyboard(word: Word, hasPictogram: boolean, backCallback: string): InlineKeyboard {
    const wordId = word.word_id;
    const keyboard = new InlineKeyboard();
    if (!word.example || !word.pronunciation_ar || !word.pronunciation_latin) {
        keyboard.text('✨ تحسين بالذكاء الاصطناعي', `ai_improve_${wordId}`).row();
    }
    if (word.example && !word.pronunciation_ar) {
        keyboard.text('🗣 توليد اللفظ', `ai_pron_${wordId}`).row();
    }
    keyboard.text('🔊 نطق', `tts:word:${wordId}:ctx:word_details`)
        .url('🎬 YouGlish', buildYouglishDirectUrl(word.german, 'german')).row();
    keyboard.text('📊 تحديد المستوى', `ai_level_${wordId}`).row();

    if (hasPictogram) {
        keyboard
            .text('🖼 عرض الرمز', `pictogram:view:${wordId}`)
            .text('🔄 تغيير الرمز', `pictogram:change:${wordId}`)
            .row();
    } else {
        keyboard.text('🖼 تعيين رمز', `pictogram:change:${wordId}`).row();
    }

    return keyboard
        .text('✏️ تعديل', `edit_word_${wordId}`)
        .text('🗑 حذف', `delete_word_${wordId}`).row()
        .text('⬅️ رجوع', backCallback)
        .text('🏠 الرئيسية', 'menu_main');
}

function reviewStatusLabel(status: string): string {
    const labels: Record<string, string> = {
        new: 'جديدة',
        learning: 'قيد التعلم',
        reviewing: 'للمراجعة',
        mastered: 'متقنة',
    };
    return labels[status] ?? status;
}
