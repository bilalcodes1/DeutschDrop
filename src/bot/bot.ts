import { Bot } from 'grammy';
import type { BotContext } from './context';
import type { Env } from '../models';
import { registerStartCommand } from '../commands/start';
import { registerLearnCommand } from '../commands/learn';
import { registerMenuCommand } from '../commands/menu';
import { registerAddWordCommand } from '../commands/addword';
import { registerUploadCommand } from '../commands/upload';
import { registerTrainCommand } from '../commands/train';
import { registerStatsCommand } from '../commands/stats';
import { registerLeaderboardCommand } from '../commands/leaderboard';
import { registerSettingsCommand } from '../commands/settings';
import { registerChallengeCommand } from '../commands/challenge';
import { registerHardWordsCommand } from '../commands/hardWords';
import { registerExportWordsCommand } from '../commands/exportWords';
import { registerPictogramCommand } from '../commands/pictograms';

export function createBot(token: string, env: Env): Bot<BotContext> {
    const bot = new Bot<BotContext>(token);

    bot.use(async (ctx, next) => {
        ctx.env = env;
        ctx.db = env.DB;
        await next();
    });

    // Register all command handlers
    registerStartCommand(bot);
    registerLearnCommand(bot);
    registerMenuCommand(bot);
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

    // Error handler
    bot.catch((err) => {
        console.error('Bot error:', err);
    });

    return bot;
}
