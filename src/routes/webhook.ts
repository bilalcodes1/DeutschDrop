import type { Update } from '@grammyjs/types';
import { createBot } from '../bot/bot';
import type { Env } from '../models';

/**
 * Handle incoming Telegram webhook updates.
 * Parses the JSON body and passes it to the grammy bot.
 */
export async function handleWebhook(request: Request, env: Env, executionCtx?: ExecutionContext): Promise<Response> {
    try {
        const update: Update = await request.json();
        const bot = createBot(env.TELEGRAM_BOT_TOKEN, env, executionCtx);
        await bot.init();

        await bot.handleUpdate(update);
        return new Response('OK', { status: 200 });
    } catch (error) {
        console.error('Webhook error:', error);
        return new Response('Internal Server Error', { status: 500 });
    }
}
