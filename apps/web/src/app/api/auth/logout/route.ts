import { NextRequest, NextResponse } from 'next/server';
import {
    buildDashboardSessionClearCookie,
    getDashboardAuthConfig,
    isSameOriginRequest,
} from '@/lib/dashboardAuth';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
    const authConfig = getDashboardAuthConfig();

    if (authConfig.enabled && !isSameOriginRequest(request)) {
        return NextResponse.json(
            { success: false, error: 'Cross-origin auth request rejected' },
            { status: 403 }
        );
    }

    const response = NextResponse.json({
        success: true,
        data: { loggedOut: true },
    });

    response.cookies.set(buildDashboardSessionClearCookie(authConfig));
    return response;
}
