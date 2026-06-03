import type { Env } from '../models';

export function getAdminTelegramIds(env: Pick<Env, 'ADMIN_TELEGRAM_IDS'>): number[] {
    return (env.ADMIN_TELEGRAM_IDS ?? '')
        .split(',')
        .map(id => Number(id.trim()))
        .filter(id => Number.isFinite(id));
}

export function isAdminTelegramId(env: Pick<Env, 'ADMIN_TELEGRAM_IDS'>, telegramId: number | undefined): boolean {
    if (!telegramId) return false;
    return getAdminTelegramIds(env).includes(telegramId);
}
