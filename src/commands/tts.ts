import { Bot, InlineKeyboard, InputFile } from 'grammy';
import type { BotContext } from '../bot/context';
import { getUserByTelegramId } from '../repositories/userRepository';
import { getWordById } from '../repositories/wordRepository';
import {
    countGeneratedAudioToday,
    getCachedWordAudio,
    upsertWordAudioFileId,
} from '../repositories/wordAudioCacheRepository';
import { buildYouglishDirectUrl } from '../services/youglish';
import { CLOUDFLARE_TTS_PROVIDER, generateCloudflareTts, normalizeTtsText } from '../services/tts/cloudflareTts';
import { normalizeReturnContext, sideFlowBackCallback, type ReturnContext } from '../services/returnContext';
import { replaceWithText } from './wordPanel';

const TTS_DAILY_GENERATION_LIMIT = 30;

export function registerTtsCommand(bot: Bot<BotContext>): void {
    bot.callbackQuery(/^tts:word:(\d+)(?::ctx:([a-z_]+))?$/, async (ctx) => {
        await ctx.answerCallbackQuery('جاري تجهيز النطق...');
        const wordId = Number(ctx.match[1]);
        const context = normalizeReturnContext(ctx.match[2]);
        await sendWordPronunciation(ctx, wordId, context);
    });
}

export function ttsButton(wordId: number, context: ReturnContext = 'word_details', label = '🔊 نطق'): { text: string; callbackData: string } {
    return { text: label, callbackData: `tts:word:${wordId}:ctx:${context}` };
}

async function sendWordPronunciation(ctx: BotContext, wordId: number, context: ReturnContext): Promise<void> {
    const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
    if (!user) {
        await ctx.reply('يرجى استخدام /start أولاً.');
        return;
    }

    const word = await getWordById(ctx.db, wordId);
    if (!word || word.added_by !== user.user_id) {
        await replaceWithText(ctx, '⚠️ لم أجد هذه الكلمة في بنك كلماتك.', ttsFailureKeyboard(wordId, context));
        return;
    }

    const germanText = normalizeTtsText(word.german);
    if (!germanText) {
        await ctx.reply('النطق الصوتي غير متاح حالياً.', { reply_markup: ttsFailureKeyboard(wordId, context) });
        return;
    }

    const cached = await getCachedWordAudio(ctx.db, user.user_id, word.word_id, germanText, CLOUDFLARE_TTS_PROVIDER);
    if (cached?.telegram_file_id) {
        await ctx.replyWithAudio(cached.telegram_file_id, {
            title: germanText,
            performer: 'DeutschDrop',
            caption: `🔊 ${germanText}`,
            reply_markup: ttsSuccessKeyboard(word.word_id, germanText, context),
        });
        return;
    }

    const generatedToday = await countGeneratedAudioToday(ctx.db, user.user_id, CLOUDFLARE_TTS_PROVIDER);
    if (generatedToday >= TTS_DAILY_GENERATION_LIMIT) {
        await ctx.reply('وصلت حد توليد النطق اليومي. النطق المخزن يبقى متاحاً.', {
            reply_markup: ttsFailureKeyboard(word.word_id, context),
        });
        return;
    }

    try {
        const generated = await generateCloudflareTts(ctx.env, germanText);
        const message = await ctx.replyWithAudio(new InputFile(generated.audioBytes, `${safeAudioFilename(germanText)}.mp3`), {
            title: germanText,
            performer: 'DeutschDrop',
            caption: `🔊 ${germanText}`,
            reply_markup: ttsSuccessKeyboard(word.word_id, germanText, context),
        });
        const fileId = message.audio?.file_id;
        if (fileId) {
            await upsertWordAudioFileId(ctx.db, {
                userId: user.user_id,
                wordId: word.word_id,
                text: germanText,
                provider: generated.provider,
                telegramFileId: fileId,
                contentHash: generated.contentHash,
            });
        }
    } catch (error) {
        const err = error instanceof Error ? error.message.slice(0, 120) : 'unknown';
        console.warn('tts_generation_failed', {
            userId: user.user_id,
            wordId: word.word_id,
            provider: CLOUDFLARE_TTS_PROVIDER,
            error: err,
        });
        await ctx.reply('النطق الصوتي غير متاح حالياً.', {
            reply_markup: ttsFailureKeyboard(word.word_id, context),
        });
    }
}

function ttsSuccessKeyboard(wordId: number, germanText: string, context: ReturnContext): InlineKeyboard {
    return new InlineKeyboard()
        .text('🔁 إعادة النطق', `tts:word:${wordId}:ctx:${context}`).row()
        .url('🎬 YouGlish', buildYouglishDirectUrl(germanText, 'german')).row()
        .text('⬅️ رجوع', sideFlowBackCallback(wordId, context))
        .text('🏠 الرئيسية', 'menu_main');
}

function ttsFailureKeyboard(wordId: number, context: ReturnContext): InlineKeyboard {
    return new InlineKeyboard()
        .text('🔁 حاول مرة ثانية', `tts:word:${wordId}:ctx:${context}`).row()
        .text('🎬 YouGlish', `youglish:${wordId}:ctx:${context}`).row()
        .text('⬅️ رجوع', sideFlowBackCallback(wordId, context))
        .text('🏠 الرئيسية', 'menu_main');
}

function safeAudioFilename(value: string): string {
    return value.toLocaleLowerCase('de-DE').replace(/[^a-z0-9äöüß]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'deutschdrop';
}
