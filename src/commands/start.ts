import { Bot } from 'grammy';
import type { BotContext } from '../bot/context';
import { completeUserRegistration, createPendingUser, getUserByTelegramId, isRegisteredUser, renameUser } from '../repositories/userRepository';
import { deleteBotSession, getBotSession, saveBotSession } from '../repositories/sessionRepository';
import { showLevelSelection, showMainMenu } from './menu';
import { showLifeSentenceFromShareCode } from './life';

interface NameSessionData {
    mode: 'register' | 'rename';
}

export function registerStartCommand(bot: Bot<BotContext>): void {
    bot.command('start', async (ctx) => {
        const user = await ensureTelegramUser(ctx);
        if (!user) return;

        if (!user.display_name?.trim()) {
            await saveBotSession<NameSessionData>(ctx.db, user.user_id, 'register', { mode: 'register' }, 30);
            await ctx.reply('مرحباً بك في DeutschDrop 👋\nاكتب اسمك للانضمام:');
            return;
        }

        const payload = ctx.message?.text?.split(/\s+/, 2)[1]?.trim();
        if (payload?.startsWith('life_')) {
            await showLifeSentenceFromShareCode(ctx, payload.slice('life_'.length));
            return;
        }

        await deleteBotSession(ctx.db, user.user_id, 'word_image_search');
        await deleteBotSession(ctx.db, user.user_id, 'word_image_results');
        await deleteBotSession(ctx.db, user.user_id, 'awaiting_manual_word_image_upload');
        await deleteBotSession(ctx.db, user.user_id, 'word_image_prepare_missing');

        await ctx.reply(`مرحباً مجدداً ${user.display_name}! 👋`);
        await showMainMenu(ctx);
    });

    bot.command('rename', async (ctx) => {
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!isRegisteredUser(user)) {
            await promptForRegistration(ctx);
            return;
        }

        await saveBotSession<NameSessionData>(ctx.db, user.user_id, 'rename', { mode: 'rename' }, 30);
        await ctx.reply('اكتب الاسم الجديد:');
    });

    bot.on('message:text', async (ctx, next) => {
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) return next();
        if (await getBotSession(ctx.db, user.user_id, 'train')) return next();
        if (await getBotSession(ctx.db, user.user_id, 'challenge')) return next();

        const registerSession = await getBotSession<NameSessionData>(ctx.db, user.user_id, 'register');
        const renameSession = await getBotSession<NameSessionData>(ctx.db, user.user_id, 'rename');
        const session = registerSession ?? renameSession;
        if (!session) return next();

        const displayName = sanitizeName(ctx.message.text);
        if (!displayName) {
            await ctx.reply('اكتب اسماً واضحاً بين 2 و 40 حرفاً.');
            return;
        }

        if (session.data.mode === 'rename') {
            await renameUser(ctx.db, user.user_id, displayName);
            await deleteBotSession(ctx.db, user.user_id, 'rename');
            await ctx.reply(`تم تغيير الاسم ✅\n${displayName}`);
            await showMainMenu(ctx);
            return;
        }

        await completeUserRegistration(ctx.db, user.user_id, displayName);
        await deleteBotSession(ctx.db, user.user_id, 'register');
        await ctx.reply(`تم تسجيلك ✅ أهلاً ${displayName}`);
        await showLevelSelection(ctx, 'حدد مستواك:');
    });
}

async function ensureTelegramUser(ctx: BotContext) {
    const telegramId = ctx.from?.id ?? 0;
    if (!telegramId) return null;

    const existing = await getUserByTelegramId(ctx.db, telegramId);
    if (existing) return existing;

    const userId = await createPendingUser(
        ctx.db,
        telegramId,
        ctx.from?.username ?? null,
        ctx.from?.first_name ?? null,
        ctx.from?.last_name ?? null
    );
    return getUserByTelegramId(ctx.db, telegramId) ?? {
        user_id: userId,
        id: userId,
        name: ctx.from?.first_name ?? 'User',
        telegram_id: telegramId,
        telegram_user_id: telegramId,
        telegram_username: ctx.from?.username ?? null,
        username: ctx.from?.username ?? null,
        first_name: ctx.from?.first_name ?? null,
        last_name: ctx.from?.last_name ?? null,
        display_name: null,
        xp: 0,
        level: 1,
        streak: 0,
        is_banned: 0,
        onboarding_seen: 0,
        identity: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    };
}

async function promptForRegistration(ctx: BotContext): Promise<void> {
    const user = await ensureTelegramUser(ctx);
    if (user) {
        await saveBotSession<NameSessionData>(ctx.db, user.user_id, 'register', { mode: 'register' }, 30);
    }
    await ctx.reply('مرحباً بك في DeutschDrop 👋\nاكتب اسمك للانضمام:');
}

function sanitizeName(value: string): string | null {
    const name = value.trim().replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > 40 || name.startsWith('/')) return null;
    return name;
}
