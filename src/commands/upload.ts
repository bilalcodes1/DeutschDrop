import { Bot, InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot/context';
import { getUserByTelegramId } from '../repositories/userRepository';
import { createWordAndAssignToUser, createUploadedList } from '../repositories/wordRepository';
import { addXp } from '../services/xpLevels';
import { parseWordCsv, type ParsedWordRow } from '../services/csvParser';
import { parseApkgPackage } from '../services/apkgParser';
import { mainMenuKeyboard } from './menu';

export function registerUploadCommand(bot: Bot<BotContext>): void {
    bot.callbackQuery('upload_csv', async (ctx) => {
        await ctx.editMessageText(
            '📤 *رفع ملف كلمات*\n\nأرسل ملف CSV أو TXT بالصيغة التالية:\n\n```csv\nGerman,Arabic\nHaus,بيت\nAuto,سيارة\n```\n\nأو بالصيغة:\n```\nHaus=بيت\nAuto=سيارة\n```\n\nملفات APKG تحتاج تحويل محلي إلى CSV حالياً.',
            { parse_mode: 'Markdown' }
        );
        await ctx.answerCallbackQuery();
    });

    bot.command('upload', async (ctx) => {
        await ctx.reply(
            '📤 *رفع ملف كلمات*\n\nأرسل ملف CSV أو TXT بالصيغة التالية:\n\n```csv\nGerman,Arabic\nHaus,بيت\nAuto,سيارة\n```\n\nملفات APKG تحتاج تحويل محلي إلى CSV حالياً.',
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
        if (!['csv', 'txt', 'apkg'].includes(extension)) {
            await ctx.reply('⚠️ يرجى إرسال ملف CSV أو TXT أو APKG.');
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

        if (extension === 'apkg') {
            const apkg = parseApkgPackage(await response.arrayBuffer());
            if (!apkg.supported) {
                await ctx.reply(apkg.message, { reply_markup: mainMenuKeyboard() });
                return;
            }

            const result = await importWords(ctx.db, apkg.words, apkg.errors, user.user_id);
            await ctx.reply(
                `تم استيراد ${result.imported} كلمة من APKG\n\n⚠️ ${result.duplicates} تكرار (تم تخطيهم)\n❌ ${result.errors} أخطاء`,
                { reply_markup: mainMenuKeyboard() }
            );
            return;
        }

        const content = await response.text();

        const result = await parseCsvAndImport(ctx.db, content, user.user_id);

        await ctx.reply(
            `📊 *ملخص الرفع*\n\n✅ ${result.imported} كلمة مستوردة\n⚠️ ${result.duplicates} تكرار (تم تخطيهم)\n❌ ${result.errors} أخطاء`,
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
