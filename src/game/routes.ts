import type { Env } from '../models';
import { GAME_UI_VERSION, answerGameQuestion, finishGameSession, getPublicGameState, restartGameSession } from '../services/gameSessionService';
import { renderCollectionGameHtml } from './html';

export async function handleGameRoute(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response | null> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/game')) return null;

    if (url.pathname === '/game' && (request.method === 'GET' || request.method === 'HEAD')) {
        return new Response(request.method === 'HEAD' ? null : renderCollectionGameHtml(), {
            status: 200,
            headers: {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-store',
            },
        });
    }

    if (url.pathname === '/game/api/session' && request.method === 'GET') {
        const token = url.searchParams.get('token') ?? '';
        return jsonResult(async () => getPublicGameState(env.DB, token));
    }

    if (url.pathname === '/game/api/answer' && request.method === 'POST') {
        return jsonResult(async () => {
            const body = await readJson<{ token?: string; questionIndex?: number; transcript?: string; alternatives?: string[]; reason?: string; confidence?: number; interimTranscript?: string }>(request);
            return answerGameQuestion(
                env.DB,
                body.token ?? '',
                Number(body.questionIndex),
                String(body.transcript ?? ''),
                Array.isArray(body.alternatives) ? body.alternatives.map(String).slice(0, 5) : [],
                String(body.reason ?? 'speech'),
                typeof body.confidence === 'number' ? body.confidence : undefined,
                String(body.interimTranscript ?? '')
            );
        });
    }

    if (url.pathname === '/game/api/finish' && request.method === 'POST') {
        return jsonResult(async () => {
            const body = await readJson<{ token?: string; reason?: string }>(request);
            return finishGameSession(env.DB, body.token ?? '', env, String(body.reason ?? 'unknown'), ctx);
        });
    }

    if (url.pathname === '/game/api/restart' && request.method === 'POST') {
        return jsonResult(async () => {
            const body = await readJson<{ token?: string }>(request);
            const next = await restartGameSession(env.DB, body.token ?? '');
            return {
                ok: true,
                token: next.token,
                gameUrl: `/game?token=${encodeURIComponent(next.token)}&v=${encodeURIComponent(GAME_UI_VERSION)}`,
            };
        });
    }

    return new Response('Not Found', { status: 404 });
}

async function jsonResult(factory: () => Promise<unknown>): Promise<Response> {
    try {
        const payload = await factory();
        return Response.json(payload, {
            headers: { 'Cache-Control': 'no-store' },
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown_error';
        return Response.json(
            { error: safeGameError(message) },
            {
                status: statusForError(message),
                headers: { 'Cache-Control': 'no-store' },
            }
        );
    }
}

async function readJson<T>(request: Request): Promise<T> {
    try {
        return await request.json<T>();
    } catch {
        throw new Error('bad_json');
    }
}

function statusForError(message: string): number {
    if (message === 'missing_token' || message === 'bad_json') return 400;
    if (message === 'invalid_token' || message === 'collection_not_allowed') return 401;
    if (message === 'expired_token') return 410;
    if (message === 'question_mismatch' || message === 'question_not_found' || message === 'restart_not_allowed' || message === 'game_challenge_completed') return 409;
    if (message === 'game_challenge_unavailable' || message === 'game_challenge_opponent_unavailable') return 404;
    return 500;
}

function safeGameError(message: string): string {
    const allowed = new Set([
        'missing_token',
        'bad_json',
        'invalid_token',
        'expired_token',
        'question_mismatch',
        'question_not_found',
        'collection_not_allowed',
        'collection_empty',
        'restart_not_allowed',
        'game_challenge_unavailable',
        'game_challenge_completed',
        'game_challenge_opponent_unavailable',
    ]);
    return allowed.has(message) ? message : 'game_error';
}
