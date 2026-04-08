import { createHash } from 'node:crypto';
import IORedis from 'ioredis';

const DEFAULT_WINDOW_SECONDS = 15 * 60;
const MIN_WINDOW_SECONDS = 60;
const MAX_WINDOW_SECONDS = 24 * 60 * 60;

const DEFAULT_MAX_ATTEMPTS = 8;
const MIN_MAX_ATTEMPTS = 1;
const MAX_MAX_ATTEMPTS = 1000;

const DEFAULT_KEY_PREFIX = 'hx:dashboard:auth:login';
const CONNECTION_NAME = 'headlessx-web-dashboard-login-rate-limit';

const seenLimiterWarnings = new Set<string>();

type DashboardRedisGlobal = typeof globalThis & {
    __dashboardRateLimitRedisClient?: IORedis;
};

const globalForRedis = globalThis as DashboardRedisGlobal;

const CONSUME_LUA = `
local key = KEYS[1]
local window_ms = tonumber(ARGV[1])
local max_attempts = tonumber(ARGV[2])

local current = redis.call('INCR', key)
if current == 1 then
  redis.call('PEXPIRE', key, window_ms)
end

local ttl = redis.call('PTTL', key)
if ttl < 0 then
  redis.call('PEXPIRE', key, window_ms)
  ttl = window_ms
end

if current > max_attempts then
  return {0, current, ttl}
end

return {1, current, ttl}
`;

interface DashboardLoginRateLimitConfig {
    redisUrl: string | null;
    failOpen: boolean;
    windowSeconds: number;
    maxAttempts: number;
    keyPrefix: string;
}

type AllowedResult = {
    status: 'allowed';
    source: 'redis' | 'fail-open';
    limit: number;
    remaining: number;
    resetAtUnix: number;
    retryAfterSeconds: 0;
};

type LimitedResult = {
    status: 'limited';
    source: 'redis';
    limit: number;
    remaining: 0;
    resetAtUnix: number;
    retryAfterSeconds: number;
};

type UnavailableResult = {
    status: 'unavailable';
    source: 'redis';
    error: string;
};

export type DashboardLoginRateLimitResult = AllowedResult | LimitedResult | UnavailableResult;

function parseBooleanEnv(value: string | null): boolean | null {
    if (!value) {
        return null;
    }

    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
        return true;
    }
    if (['0', 'false', 'no', 'off'].includes(normalized)) {
        return false;
    }

    return null;
}

function parseIntEnv(
    rawValue: string | undefined,
    options: { fallback: number; min: number; max: number }
): number {
    const parsed = Number.parseInt(rawValue || '', 10);
    if (!Number.isFinite(parsed)) {
        return options.fallback;
    }
    return Math.min(options.max, Math.max(options.min, parsed));
}

function formatRedisTarget(redisUrl: string): string {
    if (!redisUrl) {
        return 'not configured';
    }

    try {
        const parsed = new URL(redisUrl);
        const authPrefix = parsed.username || parsed.password ? '***@' : '';
        const database = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : '';
        return `${parsed.protocol}//${authPrefix}${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}${database}`;
    } catch {
        return 'configured';
    }
}

function warnLimiterOnce(key: string, message: string): void {
    if (seenLimiterWarnings.has(key)) {
        return;
    }

    seenLimiterWarnings.add(key);
    console.warn(message);
}

function getLimiterConfig(): DashboardLoginRateLimitConfig {
    const redisUrl = process.env.REDIS_URL?.trim() || null;
    const failOpen = parseBooleanEnv(process.env.DASHBOARD_AUTH_RATE_LIMIT_FAIL_OPEN || null) ?? process.env.NODE_ENV !== 'production';
    const windowSeconds = parseIntEnv(process.env.DASHBOARD_AUTH_RATE_LIMIT_WINDOW_SECONDS, {
        fallback: DEFAULT_WINDOW_SECONDS,
        min: MIN_WINDOW_SECONDS,
        max: MAX_WINDOW_SECONDS,
    });
    const maxAttempts = parseIntEnv(process.env.DASHBOARD_AUTH_RATE_LIMIT_MAX_ATTEMPTS, {
        fallback: DEFAULT_MAX_ATTEMPTS,
        min: MIN_MAX_ATTEMPTS,
        max: MAX_MAX_ATTEMPTS,
    });
    const keyPrefix = process.env.DASHBOARD_AUTH_RATE_LIMIT_PREFIX?.trim() || DEFAULT_KEY_PREFIX;

    return {
        redisUrl,
        failOpen,
        windowSeconds,
        maxAttempts,
        keyPrefix,
    };
}

function toNumber(value: unknown, fallback: number): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === 'string') {
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }

    return fallback;
}

function buildKey(prefix: string, clientAddress: string): string {
    const address = clientAddress.trim() || 'unknown';
    const hash = createHash('sha256').update(address).digest('hex');
    return `${prefix}:${hash}`;
}

function getRedisClient(redisUrl: string): IORedis {
    const existing = globalForRedis.__dashboardRateLimitRedisClient;
    if (existing) {
        return existing;
    }

    const client = new IORedis(redisUrl, {
        maxRetriesPerRequest: 1,
        enableReadyCheck: false,
        lazyConnect: true,
        connectTimeout: 1500,
        commandTimeout: 1500,
        connectionName: CONNECTION_NAME,
    });

    client.on('error', (error) => {
        warnLimiterOnce(
            `redis-error:${(error as NodeJS.ErrnoException).code || error.message}`,
            `⚠️ Dashboard login rate limiter Redis error at ${formatRedisTarget(redisUrl)}: ${error.message}`
        );
    });

    globalForRedis.__dashboardRateLimitRedisClient = client;
    return client;
}

function unavailableResult(config: DashboardLoginRateLimitConfig, reason: string): DashboardLoginRateLimitResult {
    if (config.failOpen) {
        warnLimiterOnce(
            `fail-open:${reason}`,
            `⚠️ Dashboard login rate limiter is in fail-open mode: ${reason}`
        );

        return {
            status: 'allowed',
            source: 'fail-open',
            limit: config.maxAttempts,
            remaining: config.maxAttempts,
            retryAfterSeconds: 0,
            resetAtUnix: Math.floor(Date.now() / 1000) + config.windowSeconds,
        };
    }

    return {
        status: 'unavailable',
        source: 'redis',
        error: reason,
    };
}

export async function consumeDashboardLoginRateLimit(clientAddress: string): Promise<DashboardLoginRateLimitResult> {
    const config = getLimiterConfig();

    if (!config.redisUrl) {
        return unavailableResult(
            config,
            'REDIS_URL is required for dashboard login rate limiting.'
        );
    }

    const key = buildKey(config.keyPrefix, clientAddress);
    const nowMs = Date.now();
    const windowMs = config.windowSeconds * 1000;

    try {
        const client = getRedisClient(config.redisUrl);
        const rawResult = await client.eval(CONSUME_LUA, 1, key, String(windowMs), String(config.maxAttempts));
        const result = Array.isArray(rawResult) ? rawResult : [];

        const allowed = toNumber(result[0], 0) === 1;
        const current = toNumber(result[1], config.maxAttempts + 1);
        const ttlMs = Math.max(1, toNumber(result[2], windowMs));
        const remaining = Math.max(0, config.maxAttempts - current);
        const resetAtUnix = Math.floor((nowMs + ttlMs) / 1000);

        if (!allowed) {
            return {
                status: 'limited',
                source: 'redis',
                limit: config.maxAttempts,
                remaining: 0,
                retryAfterSeconds: Math.max(1, Math.ceil(ttlMs / 1000)),
                resetAtUnix,
            };
        }

        return {
            status: 'allowed',
            source: 'redis',
            limit: config.maxAttempts,
            remaining,
            retryAfterSeconds: 0,
            resetAtUnix,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown Redis error';
        return unavailableResult(
            config,
            `Dashboard login rate limiter unavailable at ${formatRedisTarget(config.redisUrl)}: ${message}`
        );
    }
}

export async function resetDashboardLoginRateLimit(clientAddress: string): Promise<void> {
    const config = getLimiterConfig();
    if (!config.redisUrl) {
        return;
    }

    try {
        const client = getRedisClient(config.redisUrl);
        await client.del(buildKey(config.keyPrefix, clientAddress));
    } catch (error) {
        if (error instanceof Error) {
            warnLimiterOnce(
                `redis-reset-error:${error.message}`,
                `⚠️ Failed to reset dashboard login limiter key: ${error.message}`
            );
        }
    }
}
