'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar } from '@/components/dashboard/Sidebar';
import { SidebarProvider } from '@/contexts/SidebarContext';
import { Skeleton } from '@/components/ui/Skeleton';
import { redirectToLoginPreservingNext } from '@/lib/dashboardClientAuth';

type SessionCheckState = 'checking' | 'ready' | 'redirecting' | 'error';

function FullPageShellFallback() {
    return (
        <main className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)] p-8">
            <div className="mx-auto max-w-[1500px] space-y-6">
                <Skeleton className="h-24 w-full rounded-[2rem]" />
                <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
                    <Skeleton className="h-36 w-full rounded-[1.75rem]" />
                    <Skeleton className="h-36 w-full rounded-[1.75rem]" />
                    <Skeleton className="h-36 w-full rounded-[1.75rem]" />
                    <Skeleton className="h-36 w-full rounded-[1.75rem]" />
                </div>
                <Skeleton className="h-[420px] w-full rounded-[1.75rem]" />
            </div>
        </main>
    );
}

export function AppShell({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const isLoginRoute = pathname === '/login';
    const [sessionState, setSessionState] = useState<SessionCheckState>('checking');

    useEffect(() => {
        if (isLoginRoute) {
            return;
        }

        let cancelled = false;

        async function validateSession() {
            setSessionState('checking');

            const redirectToLogin = () => {
                setSessionState('redirecting');
                redirectToLoginPreservingNext();
            };

            try {
                const response = await fetch('/api/auth/session', {
                    method: 'GET',
                    cache: 'no-store',
                    credentials: 'same-origin',
                });

                const payload = await response.json().catch(() => null);
                const authenticated = Boolean(payload?.authenticated) || Boolean(payload?.data?.authenticated);
                const authDisabled = Boolean(payload?.data?.enabled === false);

                if (cancelled) {
                    return;
                }

                if (response.ok && (authenticated || authDisabled)) {
                    setSessionState('ready');
                    return;
                }

                redirectToLogin();
            } catch {
                if (cancelled) {
                    return;
                }

                setSessionState('error');
                redirectToLogin();
            }
        }

        void validateSession();

        return () => {
            cancelled = true;
        };
    }, [isLoginRoute]);

    if (isLoginRoute) {
        return <main className="min-h-screen">{children}</main>;
    }

    if (sessionState !== 'ready') {
        return <FullPageShellFallback />;
    }

    return (
        <SidebarProvider>
            <div className="flex min-h-screen view-container">
                <div className="sticky top-0 h-screen shrink-0">
                    <Sidebar />
                </div>
                <main className="flex-1 min-h-screen min-w-0 scroll-container premium-bg relative">
                    <div className="mx-auto w-full max-w-[1500px] space-y-6 px-5 py-6 lg:px-8 lg:py-8">
                        {children}
                    </div>
                </main>
            </div>
        </SidebarProvider>
    );
}
