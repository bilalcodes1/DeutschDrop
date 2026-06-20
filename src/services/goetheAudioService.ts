import { InputFile } from 'grammy';
import type { BotContext } from '../bot/context.js';
import type { Env } from '../models/index.js';
import type { GoetheSessionQuestionDetail } from '../repositories/goetheRepository.js';
import { updateGoetheQuestionTelegramFileId } from '../repositories/goetheRepository.js';

export async function sendGoetheQuestionAudio(ctx: BotContext, question: GoetheSessionQuestionDetail): Promise<boolean> {
    if (!question.audio_r2_key && !question.telegram_file_id) return false;
    if (question.telegram_file_id) {
        const sent = await ctx.replyWithAudio(question.telegram_file_id).catch(() => null);
        if (sent) return true;
    }
    const blob = await getGoetheAudioBlob(ctx.env, question.audio_r2_key);
    if (!blob) {
        await ctx.reply('الصوت غير متوفر حالياً. جرّب سؤالاً آخر.');
        return false;
    }
    const fileName = question.audio_r2_key?.split('/').pop() || 'goethe-audio.mp3';
    const sent = await ctx.replyWithAudio(new InputFile(blob, fileName)).catch(() => null) as any;
    const fileId = sent?.audio?.file_id;
    if (fileId) {
        await updateGoetheQuestionTelegramFileId(ctx.db, question.question_id, fileId).catch(() => undefined);
    }
    return Boolean(sent);
}

export async function getGoetheAudioBlob(env: Env, key: string | null): Promise<Blob | null> {
    if (!key || !env.GOETHE_AUDIO) return null;
    const object = await env.GOETHE_AUDIO.get(key).catch(() => null);
    if (!object) return null;
    return object.blob();
}
