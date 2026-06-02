import { Bot, InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot/context';
import { getUserByTelegramId } from '../repositories/userRepository';
import { createWordAndAssignToUser, createUploadedList } from '../repositories/wordRepository';
import { addXp } from '../services/xpLevels';
import { parseWordCsv, type ParsedWordRow } from '../services/csvParser';
import { mainMenuKeyboard } from './menu';

const APKG_CONVERTER_URL = 'https://convert.guru/converter';
const APKG_CONVERSION_MESSAGE =
    '📦 ملف APKG غير مدعوم مباشرة حالياً.\n\n' +
    'حوّله إلى TXT ثم ارجع ارفعه هنا.\n\n' +
    'الخطوات:\n' +
    '1. افتح رابط التحويل.\n' +
    '2. ارفع ملف APKG.\n' +
    '3. اختر txt.\n' +
    '4. نزّل الملف.\n' +
    '5. ارفعه هنا.\n\n' +
    '✅ الصيغ المدعومة:\n' +
    'CSV / TXT';

export function registerUploadCommand(bot: Bot<BotContext>): void {
    bot.callbackQuery('upload_csv', async (ctx) => {
        await ctx.editMessageText(
            '📤 *رفع ملف كلمات*\n\nأرسل ملف CSV أو TXT بالصيغة التالية:\n\n```csv\nGerman,Arabic\nHaus,بيت\nAuto,سيارة\n```\n\nأو بالصيغة:\n```\nHaus=بيت\nAuto=سيارة\n```\n\nملفات APKG تحتاج تحويل خارجي إلى TXT حالياً.',
            { parse_mode: 'Markdown' }
        );
        await ctx.answerCallbackQuery();
    });

    bot.command('upload', async (ctx) => {
        await ctx.reply(
            '📤 *رفع ملف كلمات*\n\nأرسل ملف CSV أو TXT بالصيغة التالية:\n\n```csv\nGerman,Arabic\nHaus,بيت\nAuto,سيارة\n```\n\nملفات APKG تحتاج تحويل خارجي إلى TXT حالياً.',
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

        if (extension === 'apkg') {
            await ctx.reply(APKG_CONVERSION_MESSAGE, {
                reply_markup: new InlineKeyboard()
                    .url('🔄 تحويل APKG إلى TXT', APKG_CONVERTER_URL)
                    .row()
                    .text('🏠 القائمة', 'menu_main'),
            });
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
