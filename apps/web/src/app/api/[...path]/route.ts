import { NextRequest } from 'next/server';
import {
    getDashboardAuthConfig,
    getDashboardAuthConfigError,
    isSameOriginRequest,
    verifyDashboardSessionToken,
} from '@/lib/dashboardAuth';

export const dynamic = 'force-dynamic';

const ALLOWED_API_ROOT_SEGMENTS = new Set([
    'operators',
    'config',
    'dashboard',
    'keys',
    'logs',
    'proxies',
    'jobs',
    'health',
]);

const FORWARDED_REQUEST_HEADERS = [
    'accept',
    'accept-language',
    'content-type',
    'user-agent',
    'range',
    'if-none-match',
    'if-modified-since',
    'cache-control',
    'last-event-id',
] as const;

type RouteContext = {
    params: Promise<{ path?: string[] }> | { path?: string[] };
};

function getBackendApiUrl() {
    return process.env.INTERNAL_API_URL?.trim() || process.env.NEXT_PUBLIC_API_URL?.trim() || null;
}

function getDashboardInternalApiKey() {
    return process.env.DASHBOARD_INTERNAL_API_KEY?.trim() || null;
}

function buildBackendUrl(request: NextRequest, backendApiUrl: string, path: string[]): URL {
    const encodedPath = path.map((segment) => encodeURIComponent(segment)).join('/');
    const url = new URL(`/api/${encodedPath}`, backendApiUrl);
    url.search = request.nextUrl.search;
    return url;
}

function buildForwardHeaders(request: NextRequest, dashboardInternalApiKey: string): Headers {
    const headers = new Headers();

    for (const header of FORWARDED_REQUEST_HEADERS) {
        const value = request.headers.get(header);
        if (value) {
            headers.set(header, value);
        }
    }

    headers.set('x-api-key', dashboardInternalApiKey || '');

    return headers;
}

function buildResponseHeaders(upstreamHeaders: Headers): Headers {
    const headers = new Headers(upstreamHeaders);
    headers.delete('content-length');
    return headers;
}

function normalizePathSegments(path?: string[]): string[] | null {
    if (!Array.isArray(path) || path.length === 0) {
        return null;
    }

    const normalized = path
        .map((segment) => segment.trim())
        .filter((segment) => segment.length > 0);

    if (normalized.length === 0) {
        return null;
    }

    for (const segment of normalized) {
        if (segment === '.' || segment === '..') {
            return null;
        }

        if (segment.includes('\\')) {
            return null;
        }
    }

    return normalized;
}

function isAllowedProxyPath(path: string[]): boolean {
    const root = path[0]?.toLowerCase();
    if (!root) {
        return false;
    }

    return ALLOWED_API_ROOT_SEGMENTS.has(root);
}

async function proxyRequest(request: NextRequest, context: RouteContext): Promise<Response> {
    const authConfig = getDashboardAuthConfig();
    if (authConfig.enabled) {
        const authError = getDashboardAuthConfigError(authConfig, { requireCredential: true });
        if (authError) {
            return Response.json(
                { success: false, error: authError },
                { status: 503 }
            );
        }

        const token = request.cookies.get(authConfig.cookieName)?.value || '';
        const claims = token
            ? await verifyDashboardSessionToken(token, authConfig)
            : null;

        if (!claims) {
            return Response.json(
                { success: false, error: 'Dashboard authentication required' },
                { status: 401 }
            );
        }
    }

    const backendApiUrl = getBackendApiUrl();

    if (!backendApiUrl) {
        return Response.json(
            { success: false, error: 'INTERNAL_API_URL or NEXT_PUBLIC_API_URL is not configured' },
            { status: 500 }
        );
    }

    const dashboardInternalApiKey = getDashboardInternalApiKey();

    if (!dashboardInternalApiKey) {
        return Response.json(
            { success: false, error: 'DASHBOARD_INTERNAL_API_KEY is not configured' },
            { status: 500 }
        );
    }

    const resolvedParams = await Promise.resolve(context.params);
    const normalizedPath = normalizePathSegments(resolvedParams.path);
    if (!normalizedPath || !isAllowedProxyPath(normalizedPath)) {
        return Response.json(
            { success: false, error: 'Unsupported proxied API path' },
            { status: 404 }
        );
    }

    if (!isSameOriginRequest(request)) {
        return Response.json(
            { success: false, error: 'Dashboard proxy rejected cross-origin request' },
            { status: 403 }
        );
    }

    const backendUrl = buildBackendUrl(request, backendApiUrl, normalizedPath);

    const init: RequestInit = {
        method: request.method,
        headers: buildForwardHeaders(request, dashboardInternalApiKey),
        cache: 'no-store',
        redirect: 'manual',
        signal: request.signal,
    };

    if (request.method !== 'GET' && request.method !== 'HEAD') {
        init.body = await request.arrayBuffer();
    }

    let upstreamResponse: Response;

    try {
        upstreamResponse = await fetch(backendUrl, init);
    } catch (error) {
        return Response.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to reach backend API',
                backendUrl: backendUrl.toString(),
            },
            { status: 503 }
        );
    }

    return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: buildResponseHeaders(upstreamResponse.headers),
    });
}

export async function GET(request: NextRequest, context: RouteContext) {
    return proxyRequest(request, context);
}

export async function POST(request: NextRequest, context: RouteContext) {
    return proxyRequest(request, context);
}

export async function PATCH(request: NextRequest, context: RouteContext) {
    return proxyRequest(request, context);
}

export async function PUT(request: NextRequest, context: RouteContext) {
    return proxyRequest(request, context);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
    return proxyRequest(request, context);
}
