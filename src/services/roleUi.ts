import type { Env, User } from '../models';
import type { SupportStatus } from '../repositories/supportRepository';
import { isAdminTelegramId } from './adminAccess';

export type UserRoleBadge = '🛡 أدمن' | '💙 داعم' | '👤 عضو';

export function getUserRoleBadge(
    user: Pick<User, 'telegram_id' | 'telegram_user_id'>,
    env: Pick<Env, 'ADMIN_TELEGRAM_IDS'>,
    supportStatus: SupportStatus | null
): UserRoleBadge {
    if (isAdminTelegramId(env, user.telegram_user_id ?? user.telegram_id)) return '🛡 أدمن';
    if (supportStatus?.supporter_until && new Date(supportStatus.supporter_until).getTime() > Date.now()) return '💙 داعم';
    return '👤 عضو';
}

export function formatSupportRemaining(until: string): string {
    const ms = new Date(until).getTime() - Date.now();
    if (ms <= 0) return 'منتهي';

    const hours = Math.floor(ms / (60 * 60 * 1000));
    const minutes = Math.max(0, Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000)));
    if (hours > 0) return `${hours} ساعة و ${minutes} دقيقة`;
    return `${minutes} دقيقة`;
}
