import { Bot, InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot/context';
import { createLearningSource, disableLearningSource, getAllLearningSources, getLearningSourcesByLevel, updateLearningSource } from '../repositories/sourceRepository';
import { deleteBotSession, getBotSession, saveBotSession } from '../repositories/sessionRepository';
import { getUserByTelegramId, getUserSettings } from '../repositories/userRepository';
import { isAdminTelegramId } from '../services/adminAccess';
import { replaceWithText } from './wordPanel';

interface AdminSourceSession {
    step: 'awaiting_payload';
    sourceId?: number;
}

type GermanLevel = 'A1' | 'A2' | 'B1';

export function registerSourcesCommand(bot: Bot<BotContext>): void {
    bot.command('sources', async (ctx) => {
        await showSources(ctx);
    });

    bot.callbackQuery('menu_sources', async (ctx) => {
        await ctx.answerCallbackQuery();
        await showSources(ctx);
    });

    bot.callbackQuery(/^sources_level_(A1|A2|B1)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        await showSources(ctx, ctx.match[1] as GermanLevel);
    });

    bot.callbackQuery('admin_sources', async (ctx) => {
        if (!await requireSourceAdmin(ctx)) return;
        await showAdminSources(ctx);
    });

    bot.callbackQuery('admin_source_add', async (ctx) => {
        if (!await requireSourceAdmin(ctx)) return;
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) return;
        await saveBotSession<AdminSourceSession>(ctx.db, user.user_id, 'admin_source', { step: 'awaiting_payload' }, 30);
        await replaceWithText(
            ctx,
            `📚 *إضافة مصدر*\n\n` +
            `أرسل المصدر بهذا الشكل:\n` +
            `العنوان | الرابط | A1 | الوصف\n\n` +
            `المستويات المسموحة: A1 / A2 / B1`,
            new InlineKeyboard().text('❌ إلغاء', 'admin_sources').text('🏠 الرئيسية', 'menu_main'),
            'Markdown'
        );
    });

    bot.callbackQuery(/^admin_source_edit_(\d+)$/, async (ctx) => {
        if (!await requireSourceAdmin(ctx)) return;
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) return;
        await saveBotSession<AdminSourceSession>(ctx.db, user.user_id, 'admin_source', { step: 'awaiting_payload', sourceId: Number(ctx.match[1]) }, 30);
        await replaceWithText(
            ctx,
            `✏️ *تعديل مصدر*\n\n` +
            `أرسل البيانات الجديدة بهذا الشكل:\n` +
            `العنوان | الرابط | A1 | الوصف`,
            new InlineKeyboard().text('❌ إلغاء', 'admin_sources').text('🏠 الرئيسية', 'menu_main'),
            'Markdown'
        );
    });

    bot.callbackQuery(/^admin_source_disable_(\d+)$/, async (ctx) => {
        if (!await requireSourceAdmin(ctx)) return;
        await disableLearningSource(ctx.db, Number(ctx.match[1]));
        await ctx.answerCallbackQuery('تم تعطيل المصدر');
        await showAdminSources(ctx);
    });

    bot.on('message:text', async (ctx, next) => {
        if (!isAdminTelegramId(ctx.env, ctx.from?.id)) return next();
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) return next();
        const session = await getBotSession<AdminSourceSession>(ctx.db, user.user_id, 'admin_source');
        if (session?.data.step !== 'awaiting_payload') return next();
        const parsed = parseSourcePayload(ctx.message.text);
        if (!parsed) {
            await ctx.reply('الصيغة غير صحيحة. استخدم:\nالعنوان | الرابط | A1 | الوصف');
            return;
        }
        if (session.data.sourceId) {
            await updateLearningSource(ctx.db, session.data.sourceId, parsed);
        } else {
            await createLearningSource(ctx.db, user.user_id, parsed);
        }
        await deleteBotSession(ctx.db, user.user_id, 'admin_source');
        await replaceWithText(ctx, session.data.sourceId ? 'تم تعديل المصدر ✅' : 'تمت إضافة المصدر ✅', await adminSourcesKeyboard(ctx));
    });
}

async function showSources(ctx: BotContext, forcedLevel?: GermanLevel): Promise<void> {
    const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
    const settings = user ? await getUserSettings(ctx.db, user.user_id) : null;
    const level = forcedLevel ?? settings?.german_level ?? 'A1';
    const sources = await getLearningSourcesByLevel(ctx.db, level);
    const text = sources.length === 0
        ? `📚 *مصادر مستواك ${level}*\n\nلا توجد مصادر مفعلة لهذا المستوى حالياً.`
        : `📚 *مصادر مستواك ${level}*\n\n` + sources.map((source, index) =>
            `${index + 1}. *${source.title}*\n${source.description ?? ''}\n${source.url}`
        ).join('\n\n');
    await replaceWithText(ctx, text, sourcesKeyboard(), 'Markdown');
}

async function showAdminSources(ctx: BotContext): Promise<void> {
    const sources = await getAllLearningSources(ctx.db);
    const list = sources.length === 0
        ? 'لا توجد مصادر بعد.'
        : sources.slice(0, 8).map(source =>
            `${source.id}. ${source.is_active ? '✅' : '▫️'} [${source.level}] ${source.title}`
        ).join('\n');
    await replaceWithText(
        ctx,
        `📚 *إدارة المصادر*\n\n` +
        `${list}\n\n` +
        `يمكنك إضافة مصدر، تعديل مصدر، أو تعطيله.`,
        await adminSourcesKeyboard(ctx),
        'Markdown'
    );
}

function sourcesKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
        .text('A1', 'sources_level_A1')
        .text('A2', 'sources_level_A2')
        .text('B1', 'sources_level_B1').row()
        .text('⬅️ رجوع', 'menu_more')
        .text('🏠 الرئيسية', 'menu_main');
}

async function adminSourcesKeyboard(ctx?: BotContext): Promise<InlineKeyboard> {
    const keyboard = new InlineKeyboard()
        .text('➕ إضافة مصدر', 'admin_source_add').row();
    if (ctx) {
        const sources = await getAllLearningSources(ctx.db);
        for (const source of sources.slice(0, 4)) {
            keyboard
                .text(`✏️ ${source.id}`, `admin_source_edit_${source.id}`)
                .text(`🗑 ${source.id}`, `admin_source_disable_${source.id}`).row();
        }
    }
    return keyboard
        .text('⬅️ رجوع', 'admin_panel')
        .text('🏠 الرئيسية', 'menu_main');
}

async function requireSourceAdmin(ctx: BotContext): Promise<boolean> {
    if (isAdminTelegramId(ctx.env, ctx.from?.id)) return true;
    await ctx.reply('غير مصرح لك باستخدام هذا الأمر.');
    return false;
}

function parseSourcePayload(text: string): { title: string; url: string; level: GermanLevel; description: string | null } | null {
    const parts = text.split('|').map(part => part.trim());
    if (parts.length < 3) return null;
    const [title, url, levelRaw, description] = parts;
    const level = levelRaw?.toUpperCase();
    if (!title || !url || !['A1', 'A2', 'B1'].includes(level)) return null;
    return { title, url, level: level as GermanLevel, description: description || null };
}
