import type { AiProviderErrorType } from './aiTypes';

export type AiErrorType = AiProviderErrorType;

export class AiProviderFailure extends Error {
    constructor(
        public readonly type: AiErrorType,
        public readonly status?: number
    ) {
        super(type);
    }
}

export function classifyHttpStatus(status: number): AiErrorType {
    if (status === 401 || status === 403) return 'AUTH';
    if (status === 429) return 'RATE_LIMIT';
    if (status === 404) return 'MODEL_NOT_FOUND';
    if (status === 400) return 'BAD_REQUEST';
    return 'UNKNOWN';
}

export function classifyAiError(error: unknown): { type: AiErrorType; status?: number } {
    if (error instanceof AiProviderFailure) return { type: error.type, status: error.status };
    if (error instanceof TypeError) return { type: 'NETWORK' };
    return { type: 'UNKNOWN' };
}

export function safeProviderWarn(provider: string, type: AiErrorType, status?: number, safeMessage?: string): void {
    console.warn(
        `AI provider failed: provider=${provider} type=${type}` +
        `${status ? ` status=${status}` : ''}` +
        `${safeMessage ? ` safe_message=${safeMessage}` : ''}`
    );
}

export async function readSafeErrorMessage(response: Response): Promise<string | undefined> {
    try {
        const text = await response.text();
        if (!text) return undefined;
        let message = text;
        try {
            const parsed = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
            if (typeof parsed.error === 'string') message = parsed.error;
            else message = parsed.error?.message ?? parsed.message ?? text;
        } catch {
            message = text;
        }
        return sanitizeErrorMessage(message);
    } catch {
        return undefined;
    }
}

function sanitizeErrorMessage(message: string): string {
    return message
        .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
        .replace(/[A-Za-z0-9_-]{32,}/g, '[redacted]')
        .slice(0, 200);
}
