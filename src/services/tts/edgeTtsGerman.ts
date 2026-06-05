import type { Env } from '../../models';

export const EDGE_TTS_GERMAN_PROVIDER = 'edgeTtsGerman';
export const EDGE_TTS_GERMAN_MODEL = 'edgeTtsGerman';
const DEFAULT_EDGE_TTS_VOICE = 'de-DE-KatjaNeural';
const DEFAULT_EDGE_TTS_LANGUAGE = 'de-DE';
const EDGE_TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const EDGE_TTS_URL = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${EDGE_TRUSTED_CLIENT_TOKEN}`;

const ALLOWED_EDGE_GERMAN_VOICES = new Set(['de-DE-KatjaNeural', 'de-DE-ConradNeural']);

export interface EdgeTtsResult {
    provider: typeof EDGE_TTS_GERMAN_PROVIDER;
    audioBytes: Uint8Array;
    contentHash: string;
    language: string;
    voice: string;
    model: string;
}

export async function generateEdgeTtsGerman(env: Env, germanText: string): Promise<EdgeTtsResult> {
    const text = normalizeTtsText(germanText);
    const config = getEdgeTtsGermanConfig(env);
    if (!isEdgeGermanConfig(config)) throw new Error('GERMAN_TTS_UNAVAILABLE');

    const audioBytes = await synthesizeEdgeGermanAudio(text, config);
    if (audioBytes.byteLength === 0) throw new Error('TTS_EMPTY_AUDIO');
    return {
        provider: EDGE_TTS_GERMAN_PROVIDER,
        audioBytes,
        contentHash: await contentHash(`${EDGE_TTS_GERMAN_PROVIDER}:${config.language}:${config.voice}:${EDGE_TTS_GERMAN_MODEL}:${text}`),
        language: config.language,
        voice: config.voice,
        model: EDGE_TTS_GERMAN_MODEL,
    };
}

export function getEdgeTtsGermanConfig(env: Env): { language: string; voice: string } {
    return {
        language: env.TTS_LANGUAGE || DEFAULT_EDGE_TTS_LANGUAGE,
        voice: env.EDGE_TTS_VOICE || DEFAULT_EDGE_TTS_VOICE,
    };
}

export function isEdgeGermanConfig(config: { language: string; voice: string }): boolean {
    const language = config.language.toLocaleLowerCase('de-DE');
    return (language === 'de' || language === 'de-de') && ALLOWED_EDGE_GERMAN_VOICES.has(config.voice);
}

export function normalizeTtsText(value: string): string {
    return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
}

async function synthesizeEdgeGermanAudio(text: string, config: { language: string; voice: string }): Promise<Uint8Array> {
    const requestId = crypto.randomUUID().replace(/-/g, '');
    const chunks: Uint8Array[] = [];

    return new Promise((resolve, reject) => {
        let settled = false;
        const ws = new WebSocket(EDGE_TTS_URL);
        ws.binaryType = 'arraybuffer';
        const timeout = setTimeout(() => rejectOnce(new Error('EDGE_TTS_TIMEOUT')), 12_000);

        function resolveOnce(value: Uint8Array): void {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            try {
                ws.close();
            } catch {
                // Best effort cleanup.
            }
            resolve(value);
        }

        function rejectOnce(error: Error): void {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            try {
                ws.close();
            } catch {
                // Best effort cleanup.
            }
            reject(error);
        }

        ws.addEventListener('open', () => {
            ws.send(edgeMessage('speech.config', requestId, 'application/json; charset=utf-8', JSON.stringify({
                context: {
                    synthesis: {
                        audio: {
                            metadataoptions: {
                                sentenceBoundaryEnabled: false,
                                wordBoundaryEnabled: false,
                            },
                            outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
                        },
                    },
                },
            })));
            ws.send(edgeMessage('ssml', requestId, 'application/ssml+xml', buildSsml(text, config)));
        });

        ws.addEventListener('message', (event) => {
            if (typeof event.data === 'string') {
                if (event.data.includes('Path:turn.end')) {
                    resolveOnce(concatChunks(chunks));
                }
                return;
            }

            const bytes = event.data instanceof ArrayBuffer
                ? new Uint8Array(event.data)
                : event.data instanceof Uint8Array
                    ? event.data
                    : null;
            if (!bytes || bytes.byteLength < 2) return;
            const headerLength = (bytes[0] << 8) + bytes[1];
            const headerEnd = 2 + headerLength;
            if (headerEnd > bytes.byteLength) return;
            const headers = new TextDecoder().decode(bytes.slice(2, headerEnd));
            if (headers.includes('Path:audio')) {
                chunks.push(bytes.slice(headerEnd));
            }
        });

        ws.addEventListener('error', () => rejectOnce(new Error('EDGE_TTS_NETWORK')));
        ws.addEventListener('close', () => {
            if (!settled && chunks.length > 0) resolveOnce(concatChunks(chunks));
            else if (!settled) rejectOnce(new Error('EDGE_TTS_CLOSED'));
        });
    });
}

function edgeMessage(path: string, requestId: string, contentType: string, body: string): string {
    return `X-RequestId:${requestId}\r\n` +
        `Content-Type:${contentType}\r\n` +
        `X-Timestamp:${new Date().toISOString()}\r\n` +
        `Path:${path}\r\n\r\n` +
        body;
}

function buildSsml(text: string, config: { language: string; voice: string }): string {
    return `<speak version="1.0" xml:lang="${escapeXml(config.language)}">` +
        `<voice name="${escapeXml(config.voice)}">` +
        `<prosody rate="+0%" pitch="+0Hz">${escapeXml(text)}</prosody>` +
        `</voice></speak>`;
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
    const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const output = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return output;
}

function escapeXml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

async function contentHash(value: string): Promise<string> {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
