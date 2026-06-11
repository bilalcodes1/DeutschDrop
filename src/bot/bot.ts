import { Bot } from 'grammy';
import type { BotContext } from './context';
import type { Env } from '../models';
import { registerStartCommand } from '../commands/start';
import { registerLearnCommand } from '../commands/learn';
import { registerMenuCommand } from '../commands/menu';
import { registerAddWordCommand } from '../commands/addword';
import { registerSupportCommand } from '../commands/support';
import { registerUploadCommand } from '../commands/upload';
import { registerTrainCommand } from '../commands/train';
import { registerStatsCommand } from '../commands/stats';
import { registerLeaderboardCommand } from '../commands/leaderboard';
import { registerSettingsCommand } from '../commands/settings';
import { registerChallengeCommand } from '../commands/challenge';
import { registerHardWordsCommand } from '../commands/hardWords';
import { registerExportWordsCommand } from '../commands/exportWords';
import { registerPictogramCommand } from '../commands/pictograms';
import { registerProfileCommand } from '../commands/profile';
import { registerAdminCommand } from '../commands/admin';
import { registerSourcesCommand } from '../commands/sources';
import { registerSmartNotificationCommand } from '../commands/smartNotifications';
import { registerAiCoachCommand } from '../commands/aiCoach';
import { registerTtsCommand } from '../commands/tts';
import { registerSharingCollectionsCommand } from '../commands/sharingCollections';
import { registerSearchCommand } from '../commands/search';
import { registerDailyQuestsCommand } from '../commands/dailyQuests';
import { registerMyBoostCommand } from '../commands/myBoost';
import { getUserByTelegramId, isRegisteredUser, updateUserLastActive } from '../repositories/userRepository';
import { getBotSession } from '../repositories/sessionRepository';
import { safeAnswerCallback, showCallbackError } from './callbacks';
import { cleanupTemporaryMessagesForUserInteraction } from '../services/temporaryMessageCleanup';

export function createBot(token: string, env: Env, executionCtx?: ExecutionContext): Bot<BotContext> {
    const bot = new Bot<BotContext>(token);

    bot.use(async (ctx, next) => {
        ctx.env = env;
        ctx.db = env.DB;
        ctx.executionCtx = executionCtx;
        await next();
    });

    bot.use(async (ctx, next) => {
        if (ctx.callbackQuery) {
            console.warn('callback_received', {
                userId: ctx.from?.id,
                data: ctx.callbackQuery.data,
            });
            const answer = ctx.answerCallbackQuery.bind(ctx);
            await safeAnswerCallback(ctx);
            ctx.answerCallbackQuery = ((...args: Parameters<typeof ctx.answerCallbackQuery>) => answer(...args).catch(() => {})) as typeof ctx.answerCallbackQuery;
        }
        try {
            await next();
        } catch (error) {
            if (!ctx.callbackQuery) throw error;
            console.warn('Callback middleware caught handler error');
            await showCallbackError(ctx);
        }
    });

    bot.use(async (ctx, next) => {
        const telegramId = ctx.from?.id;
        if (!telegramId) return next();

        const text = ctx.message?.text;
        const user = await getUserByTelegramId(ctx.db, telegramId);
        if (user) {
            await updateUserLastActive(ctx.db, user.user_id);
            await cleanupTemporaryMessagesForUserInteraction(ctx.env, user.user_id).catch(() => {});
        }

        if (text?.startsWith('/start')) return next();
        if (user?.is_banned) {
            await ctx.reply('تم إيقاف حسابك من استخدام البوت.');
            return;
        }

        const waitingForName = user ? await getBotSession(ctx.db, user.user_id, 'register') : null;
        if (waitingForName && text && !text.startsWith('/')) return next();

        if (!isRegisteredUser(user)) {
            await ctx.reply('مرحباً بك في DeutschDrop 👋\nاكتب /start ثم اكتب اسمك للانضمام.');
            return;
        }

        return next();
    });

    // Register all command handlers
    registerStartCommand(bot);
    registerLearnCommand(bot);
    registerMenuCommand(bot);
    registerSupportCommand(bot);
    registerSourcesCommand(bot);
    registerSharingCollectionsCommand(bot);
    registerAddWordCommand(bot);
    registerUploadCommand(bot);
    registerTrainCommand(bot);
    registerStatsCommand(bot);
    registerLeaderboardCommand(bot);
    registerSettingsCommand(bot);
    registerChallengeCommand(bot);
    registerHardWordsCommand(bot);
    registerExportWordsCommand(bot);
    registerPictogramCommand(bot);
    registerProfileCommand(bot);
    registerAdminCommand(bot);
    registerSmartNotificationCommand(bot);
    registerAiCoachCommand(bot);
    registerTtsCommand(bot);
    registerSearchCommand(bot);
    registerDailyQuestsCommand(bot);
    registerMyBoostCommand(bot);

    // Error handler
    bot.catch((err) => {
        console.error('Bot error:', err);
    });

    return bot;
}
