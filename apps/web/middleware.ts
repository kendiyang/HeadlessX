import { NextRequest, NextResponse } from 'next/server';
import {
    getDashboardAuthConfig,
    getDashboardAuthConfigError,
    verifyDashboardSessionToken,
} from './src/lib/dashboardAuth';

const AUTH_FREE_PATHS = new Set(['/login']);
const AUTH_FREE_API_PREFIXES = ['/api/auth/'];

function isAuthFreePath(pathname: string): boolean {
    if (AUTH_FREE_PATHS.has(pathname)) {
        return true;
    }

    for (const prefix of AUTH_FREE_API_PREFIXES) {
        if (pathname.startsWith(prefix)) {
            return true;
        }
    }

    return false;
}

function isApiPath(pathname: string): boolean {
    return pathname.startsWith('/api/');
}

function appendSecurityHeaders(response: NextResponse): NextResponse {
    response.headers.set('X-Frame-Options', 'DENY');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    return response;
}

function buildLoginRedirect(request: NextRequest): NextResponse {
    const loginUrl = new URL('/login', request.url);
    const currentPath = `${request.nextUrl.pathname}${request.nextUrl.search}`;
    loginUrl.searchParams.set('next', currentPath);
    return NextResponse.redirect(loginUrl);
}

export async function middleware(request: NextRequest) {
    const pathname = request.nextUrl.pathname;
    const authConfig = getDashboardAuthConfig();

    if (!authConfig.enabled) {
        return appendSecurityHeaders(NextResponse.next());
    }

    const configError = getDashboardAuthConfigError(authConfig, { requireCredential: true });
    if (configError) {
        if (isApiPath(pathname)) {
            return NextResponse.json({ success: false, error: configError }, { status: 503 });
        }

        return new NextResponse(configError, { status: 503 });
    }

    const token = request.cookies.get(authConfig.cookieName)?.value || '';
    const claims = token ? await verifyDashboardSessionToken(token, authConfig) : null;

    if (isAuthFreePath(pathname)) {
        if (pathname === '/login' && claims) {
            return NextResponse.redirect(new URL('/', request.url));
        }

        return appendSecurityHeaders(NextResponse.next());
    }

    if (!claims) {
        if (isApiPath(pathname)) {
            return NextResponse.json(
                { success: false, error: 'Dashboard authentication required' },
                { status: 401 }
            );
        }

        return buildLoginRedirect(request);
    }

    return appendSecurityHeaders(NextResponse.next());
}

export const config = {
    matcher: [
        '/((?!_next/static|_next/image|favicon.ico|favicon.svg|robots.txt|sitemap.xml).*)',
    ],
};
