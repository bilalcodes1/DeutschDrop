import { Bot, InputFile } from 'grammy';
import type { BotContext } from '../bot/context';
import { getUserByTelegramId } from '../repositories/userRepository';
import { getWordById } from '../repositories/wordRepository';
import {
    acquireTtsRequestLock,
    countGeneratedAudioToday,
    getCachedWordAudio,
    releaseTtsRequestLock,
    upsertWordAudioFileId,
} from '../repositories/wordAudioCacheRepository';
import { CLOUDFLARE_TTS_PROVIDER, generateCloudflareTts, getCloudflareTtsConfig, normalizeTtsText } from '../services/tts/cloudflareTts';
import { normalizeReturnContext, type ReturnContext } from '../services/returnContext';

const TTS_DAILY_GENERATION_LIMIT = 30;

export function registerTtsCommand(bot: Bot<BotContext>): void {
    bot.callbackQuery(/^tts:word:(\d+)(?::ctx:([a-z_]+))?$/, async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
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
        await showTtsUnavailable(ctx);
        return;
    }

    const word = await getWordById(ctx.db, wordId);
    if (!word || word.added_by !== user.user_id) {
        await showTtsUnavailable(ctx);
        return;
    }

    const germanText = normalizeTtsText(word.german);
    if (!germanText) {
        await showTtsUnavailable(ctx);
        return;
    }

    const locked = await acquireTtsRequestLock(ctx.db, { userId: user.user_id, wordId: word.word_id, text: germanText });
    if (!locked) {
        await ctx.answerCallbackQuery('جاري تجهيز النطق...').catch(() => {});
        return;
    }

    try {
        const config = getCloudflareTtsConfig(ctx.env);
        const cached = await getCachedWordAudio(ctx.db, user.user_id, word.word_id, germanText, CLOUDFLARE_TTS_PROVIDER, config.language, config.voice, config.model);
        if (cached?.telegram_file_id) {
            await ctx.replyWithAudio(cached.telegram_file_id, {
                title: germanText,
                performer: 'DeutschDrop',
                caption: `🔊 ${germanText}`,
            });
            return;
        }

        const generatedToday = await countGeneratedAudioToday(ctx.db, user.user_id, CLOUDFLARE_TTS_PROVIDER);
        if (generatedToday >= TTS_DAILY_GENERATION_LIMIT) {
            await showTtsUnavailable(ctx);
            return;
        }

        const generated = await generateCloudflareTts(ctx.env, germanText);
        const message = await ctx.replyWithAudio(new InputFile(generated.audioBytes, `${safeAudioFilename(germanText)}.mp3`), {
            title: germanText,
            performer: 'DeutschDrop',
            caption: `🔊 ${germanText}`,
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
                language: generated.language,
                voice: generated.voice,
                model: generated.model,
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
        await showTtsUnavailable(ctx);
    } finally {
        await releaseTtsRequestLock(ctx.db, user.user_id, word.word_id, germanText).catch(() => {});
    }
}

async function showTtsUnavailable(ctx: BotContext): Promise<void> {
    await ctx.answerCallbackQuery({ text: 'النطق الألماني غير متاح حالياً.', show_alert: true }).catch(async () => {
        await ctx.reply('النطق الألماني غير متاح حالياً.').catch(() => {});
    });
}

function safeAudioFilename(value: string): string {
    return value.toLocaleLowerCase('de-DE').replace(/[^a-z0-9äöüß]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'deutschdrop';
}
