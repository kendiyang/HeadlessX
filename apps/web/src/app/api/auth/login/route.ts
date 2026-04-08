import { NextRequest, NextResponse } from 'next/server';
import {
    buildDashboardSessionCookie,
    getDashboardAuthConfig,
    getDashboardAuthConfigError,
    isSameOriginRequest,
    issueDashboardSessionToken,
} from '@/lib/dashboardAuth';
import {
    consumeDashboardLoginRateLimit,
    resetDashboardLoginRateLimit,
    type DashboardLoginRateLimitResult,
} from '@/lib/dashboardLoginRateLimit';
import { verifyDashboardPassword } from '@/lib/dashboardPassword';

export const runtime = 'nodejs';

function getClientAddress(request: NextRequest): string {
    const forwarded = request.headers.get('x-forwarded-for');
    if (forwarded) {
        const [first] = forwarded.split(',');
        if (first?.trim()) {
            return first.trim();
        }
    }

    const realIp = request.headers.get('x-real-ip');
    if (realIp?.trim()) {
        return realIp.trim();
    }

    return 'unknown';
}

function constantTimeUserMatch(input: string, expected: string): boolean {
    const left = new TextEncoder().encode(input);
    const right = new TextEncoder().encode(expected);

    if (left.length !== right.length) {
        return false;
    }

    let diff = 0;
    for (let index = 0; index < left.length; index += 1) {
        diff |= left[index] ^ right[index];
    }
    return diff === 0;
}

function buildRateLimitHeaders(
    limiter: Extract<DashboardLoginRateLimitResult, { status: 'allowed' | 'limited' }>
): Record<string, string> {
    const headers: Record<string, string> = {
        'X-RateLimit-Limit': String(limiter.limit),
        'X-RateLimit-Remaining': String(limiter.remaining),
        'X-RateLimit-Reset': String(limiter.resetAtUnix),
    };

    if (limiter.status === 'limited') {
        headers['Retry-After'] = String(limiter.retryAfterSeconds);
        headers['Cache-Control'] = 'no-store';
    }

    if (limiter.source === 'fail-open') {
        headers['X-RateLimit-Policy'] = 'fail-open';
    } else {
        headers['X-RateLimit-Policy'] = 'redis-fixed-window';
    }

    return headers;
}

function withRateLimitHeaders(
    response: NextResponse,
    limiter: Extract<DashboardLoginRateLimitResult, { status: 'allowed' | 'limited' }>
): NextResponse {
    const headers = buildRateLimitHeaders(limiter);
    for (const [key, value] of Object.entries(headers)) {
        response.headers.set(key, value);
    }

    return response;
}

function unavailableLimiterResponse(
    limiter: Extract<DashboardLoginRateLimitResult, { status: 'unavailable' }>
): NextResponse {
    return NextResponse.json(
        {
            success: false,
            error: limiter.error,
        },
        {
            status: 503,
            headers: {
                'Cache-Control': 'no-store',
            },
        }
    );
}

export async function POST(request: NextRequest) {
    const authConfig = getDashboardAuthConfig();
    if (!authConfig.enabled) {
        return NextResponse.json(
            { success: false, error: 'Dashboard auth is disabled' },
            { status: 404 }
        );
    }

    const configError = getDashboardAuthConfigError(authConfig, { requireCredential: true });
    if (configError) {
        return NextResponse.json(
            { success: false, error: configError },
            { status: 503 }
        );
    }

    if (!isSameOriginRequest(request)) {
        return NextResponse.json(
            { success: false, error: 'Cross-origin auth request rejected' },
            { status: 403 }
        );
    }

    const clientAddress = getClientAddress(request);
    const limiter = await consumeDashboardLoginRateLimit(clientAddress);

    if (limiter.status === 'unavailable') {
        return unavailableLimiterResponse(limiter);
    }

    if (limiter.status === 'limited') {
        const response = NextResponse.json(
            {
                success: false,
                error: `Too many login attempts. Retry in ${limiter.retryAfterSeconds} seconds.`,
            },
            { status: 429 }
        );
        return withRateLimitHeaders(response, limiter);
    }

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        const response = NextResponse.json(
            { success: false, error: 'Invalid login payload' },
            { status: 400 }
        );
        return withRateLimitHeaders(response, limiter);
    }

    const username = typeof (body as { username?: unknown })?.username === 'string'
        ? (body as { username: string }).username.trim()
        : '';
    const password = typeof (body as { password?: unknown })?.password === 'string'
        ? (body as { password: string }).password
        : '';

    if (!username || !password) {
        const response = NextResponse.json(
            { success: false, error: 'Username and password are required' },
            { status: 400 }
        );
        return withRateLimitHeaders(response, limiter);
    }

    const usernameMatched = constantTimeUserMatch(username, authConfig.username || '');
    const passwordMatched = await verifyDashboardPassword(password, {
        expectedHash: authConfig.passwordHash,
        expectedPlain: authConfig.passwordPlain,
    });

    if (!usernameMatched || !passwordMatched) {
        const response = NextResponse.json(
            { success: false, error: 'Invalid credentials' },
            { status: 401 }
        );
        return withRateLimitHeaders(response, limiter);
    }

    await resetDashboardLoginRateLimit(clientAddress);

    const { token, claims } = await issueDashboardSessionToken(authConfig, authConfig.username || username);
    const response = NextResponse.json({
        success: true,
        data: {
            username: claims.sub,
            expiresAt: new Date(claims.exp * 1000).toISOString(),
        },
    });

    response.cookies.set(buildDashboardSessionCookie(authConfig, token));
    return withRateLimitHeaders(response, limiter);
}
