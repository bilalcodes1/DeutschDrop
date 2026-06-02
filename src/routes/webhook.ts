import type { Update } from '@grammyjs/types';
import { createBot } from '../bot/bot';
import type { Env } from '../models';

/**
 * Handle incoming Telegram webhook updates.
 * Parses the JSON body and passes it to the grammy bot.
 */
export async function handleWebhook(request: Request, env: Env): Promise<Response> {
    try {
        const update: Update = await request.json();
        const bot = createBot(env.TELEGRAM_BOT_TOKEN);

        // Inject custom context properties (env + db)
        bot.use(async (ctx, next) => {
            ctx.env = env;
            ctx.db = env.DB;
            await next();
        });

        await bot.handleUpdate(update);
        return new Response('OK', { status: 200 });
    } catch (error) {
        console.error('Webhook error:', error);
        return new Response('Internal Server Error', { status: 500 });
    }
}
