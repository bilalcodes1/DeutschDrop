import type { Context } from 'grammy';
import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '../models';

export interface BotContext extends Context {
    env: Env;
    db: D1Database;
    executionCtx?: ExecutionContext;
}
