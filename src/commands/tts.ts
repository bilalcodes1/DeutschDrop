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
import { isAdminTelegramId } from '../services/adminAccess';
import { normalizeReturnContext, type ReturnContext } from '../services/returnContext';
import { orderedTtsProviders, synthesizeGermanTts } from '../services/tts/ttsRouter';
import { normalizeTtsText, safeTtsMessage, type TtsProviderResult } from '../services/tts/types';

const TTS_DAILY_GENERATION_LIMIT = 30;

export function registerTtsCommand(bot: Bot<BotContext>): void {
    bot.command('tts_debug', async (ctx) => {
        if (!isAdminTelegramId(ctx.env, ctx.from?.id)) {
            await ctx.reply('غير مصرح لك باستخدام هذا الأمر.');
            return;
        }
        await showTtsDebug(ctx);
    });

    bot.command('tts_test', async (ctx) => {
        if (!isAdminTelegramId(ctx.env, ctx.from?.id)) {
            await ctx.reply('غير مصرح لك باستخدام هذا الأمر.');
            return;
        }
        await runTtsTest(ctx);
    });

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
        const providerConfigs = orderedTtsProviders(ctx.env).map(provider => provider.config(ctx.env));
        if (providerConfigs.length === 0) {
            await showTtsUnavailable(ctx);
            return;
        }
        for (const config of providerConfigs) {
            const cached = await getCachedWordAudio(ctx.db, user.user_id, word.word_id, germanText, config.provider, config.language, config.voice, config.model, config.format);
            if (cached?.telegram_file_id) {
                await ctx.replyWithAudio(cached.telegram_file_id, {
                    title: germanText,
                    performer: 'DeutschDrop',
                    caption: `🔊 ${germanText}`,
                });
                return;
            }
        }

        const generatedToday = await countGeneratedAudioToday(ctx.db, user.user_id, 'voiceRssGerman') +
            await countGeneratedAudioToday(ctx.db, user.user_id, 'edgeTtsWorker');
        if (generatedToday >= TTS_DAILY_GENERATION_LIMIT) {
            await showTtsUnavailable(ctx);
            return;
        }

        const { result, attempts } = await synthesizeGermanTts(ctx.env, germanText);
        if (!result.ok) {
            logTtsAttempts(user.user_id, word.word_id, attempts);
            await showTtsUnavailable(ctx);
            return;
        }
        const message = await ctx.replyWithAudio(new InputFile(result.audioBytes, `${safeAudioFilename(germanText)}.mp3`), {
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
                provider: result.provider,
                telegramFileId: fileId,
                contentHash: result.contentHash,
                language: result.language,
                voice: result.voice,
                model: result.model,
                format: result.format,
            });
        }
    } catch (error) {
        const err = error instanceof Error ? error.message.slice(0, 120) : 'unknown';
        console.warn('tts_generation_failed', {
            userId: user.user_id,
            wordId: word.word_id,
            provider: 'ttsRouter',
            error: err,
        });
        await showTtsUnavailable(ctx);
    } finally {
        await releaseTtsRequestLock(ctx.db, user.user_id, word.word_id, germanText).catch(() => {});
    }
}

async function showTtsDebug(ctx: BotContext): Promise<void> {
    const providers = orderedTtsProviders(ctx.env);
    const rows = await Promise.all(providers.map(async (provider) => {
        const config = provider.config(ctx.env);
        const result = await provider.synthesize(ctx.env, 'Hallo');
        return { config, result };
    }));
    const cache = await ctx.db.prepare(
        `SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN provider = 'voiceRssGerman' THEN 1 ELSE 0 END) AS voice_rss,
            SUM(CASE WHEN provider = 'cloudflareTts' THEN 1 ELSE 0 END) AS cloudflare_stale
         FROM word_audio_cache`
    ).first<{ total: number; voice_rss: number; cloudflare_stale: number }>();

    const voice = rows.find(row => row.config.provider === 'voiceRssGerman');
    const edge = rows.find(row => row.config.provider === 'edgeTtsWorker');
    await ctx.reply(
        `🔊 TTS Debug\n\n` +
        `Provider order:\n${providers.map(provider => provider.name).join(',') || '-'}\n\n` +
        `Voice RSS:\n` +
        `key: ${ctx.env.VOICERSS_API_KEY ? 'configured' : 'missing'}\n` +
        `language: ${voice?.config.language ?? 'de-de'}\n` +
        `format: ${voice?.config.format ?? 'mp3'}\n` +
        `status: ${statusLabel(voice?.result)}\n` +
        `last_error: ${errorLabel(voice?.result)}\n\n` +
        `Edge TTS Worker:\n` +
        `url: ${ctx.env.EDGE_TTS_WORKER_URL ? 'configured' : 'missing'}\n` +
        `voice: ${edge?.config.voice ?? ctx.env.EDGE_TTS_VOICE ?? 'de-DE-KatjaNeural'}\n` +
        `status: ${statusLabel(edge?.result)}\n\n` +
        `Cache:\n` +
        `total records: ${cache?.total ?? 0}\n` +
        `voiceRss records: ${cache?.voice_rss ?? 0}\n` +
        `stale cloudflare records: ${cache?.cloudflare_stale ?? 0}`
    );
}

async function runTtsTest(ctx: BotContext): Promise<void> {
    const { result, attempts } = await synthesizeGermanTts(ctx.env, 'Hallo');
    if (!result.ok) {
        await ctx.reply(`النطق الألماني غير متاح حالياً.\nreason: ${errorLabel(result)}`);
        logTtsAttempts(undefined, undefined, attempts);
        return;
    }
    await ctx.replyWithAudio(new InputFile(result.audioBytes, 'hallo.mp3'), {
        title: 'Hallo',
        performer: 'DeutschDrop',
        caption: `✅ TTS OK: ${result.provider}`,
    });
}

function logTtsAttempts(userId: number | undefined, wordId: number | undefined, attempts: TtsProviderResult[]): void {
    for (const attempt of attempts) {
        if (attempt.ok) continue;
        console.warn('tts_failed', {
            userId,
            wordId,
            provider: attempt.provider,
            language: attempt.language,
            status: attempt.status,
            reason: attempt.errorType,
            errorMessage: safeTtsMessage(attempt.message),
        });
    }
}

function statusLabel(result: TtsProviderResult | undefined): string {
    if (!result) return 'SKIPPED';
    if (result.ok) return 'OK';
    return result.errorType;
}

function errorLabel(result: TtsProviderResult | undefined): string {
    if (!result || result.ok) return '-';
    return `${result.errorType}${result.status ? ` status=${result.status}` : ''}${result.message ? ` ${safeTtsMessage(result.message)}` : ''}`;
}

async function showTtsUnavailable(ctx: BotContext): Promise<void> {
    await ctx.answerCallbackQuery({ text: 'النطق الألماني غير متاح حالياً.', show_alert: true }).catch(async () => {
        await ctx.reply('النطق الألماني غير متاح حالياً.').catch(() => {});
    });
}

function safeAudioFilename(value: string): string {
    return value.toLocaleLowerCase('de-DE').replace(/[^a-z0-9äöüß]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'deutschdrop';
}
