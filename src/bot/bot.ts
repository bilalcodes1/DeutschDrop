import { Bot } from 'grammy';
import type { BotContext } from './context';
import { registerStartCommand } from '../commands/start';
import { registerLearnCommand } from '../commands/learn';
import { registerMenuCommand } from '../commands/menu';
import { registerAddWordCommand } from '../commands/addword';
import { registerUploadCommand } from '../commands/upload';
import { registerTrainCommand } from '../commands/train';
import { registerStatsCommand } from '../commands/stats';
import { registerLeaderboardCommand } from '../commands/leaderboard';
import { registerSettingsCommand } from '../commands/settings';

export function createBot(token: string): Bot<BotContext> {
    const bot = new Bot<BotContext>(token);

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

    // Error handler
    bot.catch((err) => {
        console.error('Bot error:', err);
    });

    return bot;
}
