import { Bot, InputFile } from 'grammy';
import type { BotContext } from '../bot/context';
import { getUserByTelegramId } from '../repositories/userRepository';
import { getWordsByUser } from '../repositories/wordRepository';

export function registerExportWordsCommand(bot: Bot<BotContext>): void {
    bot.command('export', async (ctx) => {
        const telegramId = ctx.from?.id ?? 0;
        const user = await getUserByTelegramId(ctx.db, telegramId);
        if (!user) {
            await ctx.reply('يرجى استخدام /start أولاً.');
            return;
        }

        const words = await getWordsByUser(ctx.db, user.user_id);
        if (words.length === 0) {
            await ctx.reply('لا توجد كلمات لتصديرها حالياً.');
            return;
        }

        const csv = [
            'German,Arabic,Example',
            ...words.map(word => [
                escapeCsv(word.german),
                escapeCsv(word.arabic),
                escapeCsv(word.example ?? ''),
            ].join(',')),
        ].join('\n');

        const file = new InputFile(
            new Blob([csv], { type: 'text/csv;charset=utf-8' }),
            'deutschdrop_words.csv'
        );

        await ctx.replyWithDocument(file, {
            caption: `📤 تم تصدير ${words.length} كلمة بصيغة CSV.`,
        });
    });
}

function escapeCsv(value: string): string {
    const normalized = value.replace(/\r?\n/g, ' ').trim();
    if (!/[",\n]/.test(normalized)) return normalized;
    return `"${normalized.replace(/"/g, '""')}"`;
}
