import { NextRequest, NextResponse } from 'next/server';
import {
    getDashboardAuthConfig,
    getDashboardAuthConfigError,
    verifyDashboardSessionToken,
} from '@/lib/dashboardAuth';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
    const authConfig = getDashboardAuthConfig();

    if (!authConfig.enabled) {
        return NextResponse.json({
            success: true,
            data: {
                enabled: false,
                authenticated: true,
            },
        });
    }

    const configError = getDashboardAuthConfigError(authConfig, { requireCredential: true });
    if (configError) {
        return NextResponse.json(
            {
                success: false,
                error: configError,
                authenticated: false,
            },
            { status: 503 }
        );
    }

    const token = request.cookies.get(authConfig.cookieName)?.value || '';
    if (!token) {
        return NextResponse.json(
            { success: false, authenticated: false, error: 'No active dashboard session' },
            { status: 401 }
        );
    }

    const claims = await verifyDashboardSessionToken(token, authConfig);
    if (!claims) {
        return NextResponse.json(
            { success: false, authenticated: false, error: 'Dashboard session is invalid or expired' },
            { status: 401 }
        );
    }

    return NextResponse.json({
        success: true,
        authenticated: true,
        data: {
            enabled: true,
            authenticated: true,
            username: claims.sub,
            expiresAt: new Date(claims.exp * 1000).toISOString(),
        },
    });
}
