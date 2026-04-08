import type { NextRequest } from 'next/server';
import { isSupportedDashboardPasswordHash } from './dashboardPasswordHash';

export const DEFAULT_DASHBOARD_COOKIE_NAME = 'hx_dashboard_session';
const DEFAULT_ISSUER = 'headlessx-dashboard';
const DEFAULT_AUDIENCE = 'headlessx-dashboard-web';
const DEFAULT_SESSION_TTL_SECONDS = 8 * 60 * 60;
const MIN_SESSION_TTL_SECONDS = 5 * 60;
const MAX_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const MIN_SECRET_LENGTH = 32;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const keyCache = new Map<string, Promise<CryptoKey>>();

export interface DashboardAuthConfig {
    enabled: boolean;
    secret: string | null;
    username: string | null;
    passwordHash: string | null;
    passwordPlain: string | null;
    cookieName: string;
    cookieDomain: string | null;
    secureCookies: boolean;
    sessionTtlSeconds: number;
    issuer: string;
    audience: string;
}

export interface DashboardSessionClaims {
    sub: string;
    role: 'admin';
    iat: number;
    exp: number;
    iss: string;
    aud: string;
    jti: string;
}

function readEnv(name: string): string | null {
    const value = process.env[name]?.trim();
    return value ? value : null;
}

function parseBooleanEnv(value: string | null): boolean | null {
    if (!value) {
        return null;
    }

    const normalized = value.toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
        return true;
    }
    if (['0', 'false', 'no', 'off'].includes(normalized)) {
        return false;
    }

    return null;
}

function normalizeCookieName(value: string | null): string {
    if (!value) {
        return DEFAULT_DASHBOARD_COOKIE_NAME;
    }

    const normalized = value.replace(/[^A-Za-z0-9_.-]/g, '');
    return normalized || DEFAULT_DASHBOARD_COOKIE_NAME;
}

function parseSessionTtlSeconds(value: string | null): number {
    const parsed = Number.parseInt(value || '', 10);
    if (!Number.isFinite(parsed)) {
        return DEFAULT_SESSION_TTL_SECONDS;
    }

    return Math.min(MAX_SESSION_TTL_SECONDS, Math.max(MIN_SESSION_TTL_SECONDS, parsed));
}

export function getDashboardAuthConfig(): DashboardAuthConfig {
    const explicitEnabled = parseBooleanEnv(readEnv('DASHBOARD_AUTH_ENABLED'));
    const enabled = explicitEnabled ?? process.env.NODE_ENV === 'production';
    const secureCookies = parseBooleanEnv(readEnv('DASHBOARD_AUTH_SECURE_COOKIES')) ?? process.env.NODE_ENV === 'production';

    return {
        enabled,
        secret: readEnv('DASHBOARD_AUTH_SECRET'),
        username: readEnv('DASHBOARD_AUTH_USERNAME'),
        passwordHash: readEnv('DASHBOARD_AUTH_PASSWORD_HASH'),
        passwordPlain: readEnv('DASHBOARD_AUTH_PASSWORD'),
        cookieName: normalizeCookieName(readEnv('DASHBOARD_AUTH_COOKIE_NAME')),
        cookieDomain: readEnv('DASHBOARD_AUTH_COOKIE_DOMAIN'),
        secureCookies,
        sessionTtlSeconds: parseSessionTtlSeconds(readEnv('DASHBOARD_AUTH_SESSION_TTL_SECONDS')),
        issuer: readEnv('DASHBOARD_AUTH_ISSUER') || DEFAULT_ISSUER,
        audience: readEnv('DASHBOARD_AUTH_AUDIENCE') || DEFAULT_AUDIENCE,
    };
}

export function getDashboardAuthConfigError(
    config: DashboardAuthConfig,
    options: { requireCredential: boolean }
): string | null {
    if (!config.enabled) {
        return null;
    }

    if (!config.secret) {
        return 'DASHBOARD_AUTH_SECRET is required when dashboard auth is enabled.';
    }

    if (config.secret.length < MIN_SECRET_LENGTH) {
        return `DASHBOARD_AUTH_SECRET must be at least ${MIN_SECRET_LENGTH} characters.`;
    }

    if (!config.username) {
        return 'DASHBOARD_AUTH_USERNAME is required when dashboard auth is enabled.';
    }

    if (options.requireCredential && !config.passwordHash && !config.passwordPlain) {
        return 'Set DASHBOARD_AUTH_PASSWORD_HASH (recommended) or DASHBOARD_AUTH_PASSWORD to enable dashboard login.';
    }

    if (config.passwordHash && !isSupportedDashboardPasswordHash(config.passwordHash)) {
        return [
            'DASHBOARD_AUTH_PASSWORD_HASH format is invalid.',
            'Use scrypt:<salt-base64url>:<hash-base64url> (recommended),',
            'or escape dollar signs in scrypt$...$... as scrypt\\$...\\$... in .env files.',
        ].join(' ');
    }

    if (process.env.NODE_ENV === 'production' && !config.passwordHash) {
        return 'Production requires DASHBOARD_AUTH_PASSWORD_HASH. Plaintext DASHBOARD_AUTH_PASSWORD is disabled in production.';
    }

    return null;
}

function toBase64(input: Uint8Array): string {
    if (typeof Buffer !== 'undefined') {
        return Buffer.from(input).toString('base64');
    }

    let binary = '';
    for (const value of input) {
        binary += String.fromCharCode(value);
    }
    return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
    if (typeof Buffer !== 'undefined') {
        return new Uint8Array(Buffer.from(value, 'base64'));
    }

    const binary = atob(value);
    const output = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        output[index] = binary.charCodeAt(index);
    }

    return output;
}

function toBase64Url(input: Uint8Array): string {
    return toBase64(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value: string): Uint8Array {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
    return fromBase64(padded);
}

function encodeJsonSegment(payload: Record<string, unknown>): string {
    return toBase64Url(textEncoder.encode(JSON.stringify(payload)));
}

function parseJsonSegment(value: string): Record<string, unknown> | null {
    try {
        const decoded = textDecoder.decode(fromBase64Url(value));
        const parsed = JSON.parse(decoded) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
        }
    } catch {
        // Ignore decode failures.
    }

    return null;
}

function normalizeAudience(value: unknown): string[] {
    if (typeof value === 'string') {
        return [value];
    }
    if (Array.isArray(value)) {
        return value.filter((entry): entry is string => typeof entry === 'string');
    }
    return [];
}

async function getHmacKey(secret: string): Promise<CryptoKey> {
    const cached = keyCache.get(secret);
    if (cached) {
        return cached;
    }

    const keyPromise = crypto.subtle.importKey(
        'raw',
        textEncoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign', 'verify']
    );
    keyCache.set(secret, keyPromise);
    return keyPromise;
}

export async function issueDashboardSessionToken(
    config: DashboardAuthConfig,
    subject: string
): Promise<{ token: string; claims: DashboardSessionClaims }> {
    if (!config.secret) {
        throw new Error('DASHBOARD_AUTH_SECRET is not configured');
    }

    const now = Math.floor(Date.now() / 1000);
    const claims: DashboardSessionClaims = {
        sub: subject,
        role: 'admin',
        iat: now,
        exp: now + config.sessionTtlSeconds,
        iss: config.issuer,
        aud: config.audience,
        jti: crypto.randomUUID(),
    };

    const headerSegment = encodeJsonSegment({ alg: 'HS256', typ: 'JWT' });
    const payloadSegment = encodeJsonSegment(claims as unknown as Record<string, unknown>);
    const signingInput = `${headerSegment}.${payloadSegment}`;

    const key = await getHmacKey(config.secret);
    const signature = await crypto.subtle.sign('HMAC', key, textEncoder.encode(signingInput));
    const signatureSegment = toBase64Url(new Uint8Array(signature));

    return {
        token: `${signingInput}.${signatureSegment}`,
        claims,
    };
}

export async function verifyDashboardSessionToken(
    token: string,
    config: DashboardAuthConfig
): Promise<DashboardSessionClaims | null> {
    if (!config.secret) {
        return null;
    }

    const parts = token.split('.');
    if (parts.length !== 3) {
        return null;
    }

    const [headerSegment, payloadSegment, signatureSegment] = parts;
    const header = parseJsonSegment(headerSegment);
    const payload = parseJsonSegment(payloadSegment);

    if (!header || !payload) {
        return null;
    }

    if (header.alg !== 'HS256' || header.typ !== 'JWT') {
        return null;
    }

    const signature = fromBase64Url(signatureSegment);
    const signatureCopy = new Uint8Array(signature.byteLength);
    signatureCopy.set(signature);
    const signingInput = `${headerSegment}.${payloadSegment}`;
    const key = await getHmacKey(config.secret);
    const valid = await crypto.subtle.verify('HMAC', key, signatureCopy, textEncoder.encode(signingInput));

    if (!valid) {
        return null;
    }

    const now = Math.floor(Date.now() / 1000);
    const exp = typeof payload.exp === 'number' ? payload.exp : Number.parseInt(String(payload.exp || ''), 10);
    const iat = typeof payload.iat === 'number' ? payload.iat : Number.parseInt(String(payload.iat || ''), 10);
    const aud = normalizeAudience(payload.aud);

    if (!Number.isFinite(exp) || exp <= now) {
        return null;
    }

    if (!Number.isFinite(iat) || iat > now + 60) {
        return null;
    }

    if (payload.iss !== config.issuer) {
        return null;
    }

    if (!aud.includes(config.audience)) {
        return null;
    }

    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
        return null;
    }

    if (typeof payload.jti !== 'string' || payload.jti.length === 0) {
        return null;
    }

    return {
        sub: payload.sub,
        role: payload.role === 'admin' ? 'admin' : 'admin',
        iat,
        exp,
        iss: payload.iss as string,
        aud: config.audience,
        jti: payload.jti,
    };
}

export function buildDashboardSessionCookie(
    config: DashboardAuthConfig,
    token: string
): {
    name: string;
    value: string;
    httpOnly: true;
    secure: boolean;
    sameSite: 'strict';
    path: '/';
    maxAge: number;
    domain?: string;
} {
    return {
        name: config.cookieName,
        value: token,
        httpOnly: true,
        secure: config.secureCookies,
        sameSite: 'strict',
        path: '/',
        maxAge: config.sessionTtlSeconds,
        ...(config.cookieDomain ? { domain: config.cookieDomain } : {}),
    };
}

export function buildDashboardSessionClearCookie(
    config: DashboardAuthConfig
): {
    name: string;
    value: string;
    httpOnly: true;
    secure: boolean;
    sameSite: 'strict';
    path: '/';
    maxAge: 0;
    domain?: string;
} {
    return {
        name: config.cookieName,
        value: '',
        httpOnly: true,
        secure: config.secureCookies,
        sameSite: 'strict',
        path: '/',
        maxAge: 0,
        ...(config.cookieDomain ? { domain: config.cookieDomain } : {}),
    };
}

export function isSameOriginRequest(request: NextRequest): boolean {
    const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
    if (!host) {
        return false;
    }

    const protocol = request.headers.get('x-forwarded-proto') || request.nextUrl.protocol.replace(/:$/, '');
    const expectedOrigin = `${protocol}://${host}`;

    const sameOriginByHeader = (value: string | null): boolean => {
        if (!value) {
            return false;
        }

        try {
            return new URL(value).origin === expectedOrigin;
        } catch {
            return false;
        }
    };

    if (sameOriginByHeader(request.headers.get('origin'))) {
        return true;
    }

    if (sameOriginByHeader(request.headers.get('referer'))) {
        return true;
    }

    return request.headers.get('sec-fetch-site') === 'same-origin';
}
