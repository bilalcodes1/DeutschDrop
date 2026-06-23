const BLOCKED_HOST_PATTERNS = [
    /^localhost$/i,
    /^127\./,
    /^10\./,
    /^192\.168\./,
    /^172\.(1[6-9]|2\d|3[0-1])\./,
    /^169\.254\./,
    /^0\.0\.0\.0$/,
    /^\[?::1\]?$/i,
    /^metadata\.google\.internal$/i,
    /^metadata\.azure\.com$/i,
    /^metadata$/,
    /^169\.254\.169\.254$/,
];

const ALLOWED_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

export function assertSafeImageUrl(rawUrl: string, allowedHosts: string[] = []): URL {
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        throw new Error('invalid_image_url');
    }
    if (url.protocol !== 'https:') throw new Error('invalid_image_url_protocol');
    const host = url.hostname.toLowerCase();
    if (allowedHosts.length > 0 && !allowedHosts.some(allowed => host === allowed || host.endsWith(`.${allowed}`))) {
        throw new Error('image_host_not_allowed');
    }
    if (BLOCKED_HOST_PATTERNS.some(pattern => pattern.test(host))) {
        throw new Error('blocked_image_host');
    }
    if (isPrivateIPv4(host) || isPrivateIPv6(host)) throw new Error('blocked_image_host');
    return url;
}

function isPrivateIPv4(host: string): boolean {
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
    const parts = host.split('.').map(Number);
    if (parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return true;
    const [a, b] = parts;
    return a === 10
        || a === 127
        || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && b === 168)
        || (a === 169 && b === 254)
        || a === 0;
}

function isPrivateIPv6(host: string): boolean {
    const clean = host.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
    if (!clean.includes(':')) return false;
    return clean === '::1'
        || clean.startsWith('fc')
        || clean.startsWith('fd')
        || clean.startsWith('fe80:')
        || clean.startsWith('::ffff:127.')
        || clean.startsWith('::ffff:10.')
        || clean.startsWith('::ffff:192.168.')
        || clean.startsWith('::ffff:169.254.');
}

export function isAllowedImageMime(mimeType: string | null | undefined): boolean {
    const clean = String(mimeType ?? '').split(';')[0].trim().toLowerCase();
    return ALLOWED_MIME.has(clean);
}

export function normalizeImageMime(mimeType: string | null | undefined): string {
    const clean = String(mimeType ?? '').split(';')[0].trim().toLowerCase();
    if (clean === 'image/jpg') return 'image/jpeg';
    if (!isAllowedImageMime(clean)) throw new Error('unsupported_image_mime');
    return clean;
}

export function extensionForMime(mimeType: string): string {
    const clean = normalizeImageMime(mimeType);
    if (clean === 'image/png') return 'png';
    if (clean === 'image/webp') return 'webp';
    return 'jpg';
}
