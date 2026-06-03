import { Bot, InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot/context';
import { getUserByTelegramId } from '../repositories/userRepository';
import { createWordAndAssignToUser, createUploadedList } from '../repositories/wordRepository';
import { addXp } from '../services/xpLevels';
import { parseWordCsv, type ParsedWordRow } from '../services/csvParser';
import { checkAchievements, unlockAchievement } from '../services/achievements';
import { incrementDailyTask } from '../services/dailyTasks';
import { mainMenuKeyboard } from './menu';

const CSV_UPLOAD_INSTRUCTIONS =
    'ارسل ملف CSV فقط بالصيغة التالية:\n' +
    'German,Arabic\n' +
    'Haus,بيت\n' +
    'Auto,سيارة';

const CSV_ONLY_ERROR =
    '⚠️ يرجى إرسال ملف CSV فقط.\n\n' +
    'الصيغة المطلوبة:\n' +
    'German,Arabic\n' +
    'Haus,بيت\n' +
    'Auto,سيارة';

export function registerUploadCommand(bot: Bot<BotContext>): void {
    bot.callbackQuery('upload_csv', async (ctx) => {
        await ctx.editMessageText(
            `📤 *رفع ملف CSV*\n\n${CSV_UPLOAD_INSTRUCTIONS}`,
            { parse_mode: 'Markdown' }
        );
        await ctx.answerCallbackQuery();
    });

    bot.command('upload', async (ctx) => {
        await ctx.reply(
            `📤 *رفع ملف CSV*\n\n${CSV_UPLOAD_INSTRUCTIONS}`,
            { parse_mode: 'Markdown' }
        );
    });

    // Handle document uploads
    bot.on('message:document', async (ctx) => {
        const telegramId = ctx.from?.id ?? 0;
        const user = await getUserByTelegramId(ctx.db, telegramId);

        if (!user) {
            await ctx.reply('يرجى استخدام /start أولاً.');
            return;
        }

        const doc = ctx.message.document;
        const fileName = doc?.file_name ?? '';
        const extension = getFileExtension(fileName);
        if (extension !== 'csv') {
            await ctx.reply(CSV_ONLY_ERROR);
            return;
        }

        // Get file content via Telegram API
        const file = await ctx.api.getFile(doc.file_id);
        if (!file.file_path) {
            await ctx.reply('⚠️ تعذر تحميل الملف.');
            return;
        }

        const fileUrl = `https://api.telegram.org/file/bot${ctx.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
        const response = await fetch(fileUrl);
        const content = await response.text();

        const result = await parseCsvAndImport(ctx.db, content, user.user_id);
        if (result.imported > 0) {
            await incrementDailyTask(ctx, user.user_id, 'learn_words', result.imported);
            await unlockAchievement(ctx, user.user_id, 'first_csv');
            await checkAchievements(ctx, user.user_id);
        }

        await ctx.reply(
            `📊 *ملخص الرفع*\n\n✅ ${result.imported} كلمة مستوردة\n⚠️ ${result.duplicates} تكرار (تم تخطيهم)\n❌ ${result.errors} أخطاء\n\nتم رفع الكلمات ✅ يمكنك تعيين رمز تعليمي لكل كلمة من 📂 إدارة الكلمات.`,
            { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard() }
        );
    });
}

function getFileExtension(fileName: string): string {
    const dotIndex = fileName.lastIndexOf('.');
    return dotIndex === -1 ? '' : fileName.slice(dotIndex + 1).toLowerCase();
}

interface ParseResult {
    imported: number;
    duplicates: number;
    errors: number;
}

async function parseCsvAndImport(
    db: D1Database,
    content: string,
    userId: number
): Promise<ParseResult> {
    const result: ParseResult = { imported: 0, duplicates: 0, errors: 0 };
    const parsed = parseWordCsv(content);
    return importWords(db, parsed.words, parsed.errors, userId);
}

async function importWords(
    db: D1Database,
    words: ParsedWordRow[],
    initialErrors: number,
    userId: number
): Promise<ParseResult> {
    const result: ParseResult = { imported: 0, duplicates: 0, errors: initialErrors };

    // Create a list for this upload
    const listId = await createUploadedList(db, userId, `Imported ${new Date().toLocaleDateString()}`);

    // Import words
    for (const w of words) {
        try {
            await createWordAndAssignToUser(db, w.german, w.arabic, w.example, userId, listId);
            result.imported++;
            await addXp(db, userId, 5, 'new_word');
        } catch {
            result.duplicates++;
        }
    }

    return result;
}
