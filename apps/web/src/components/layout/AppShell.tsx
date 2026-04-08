'use client';

import { usePathname } from 'next/navigation';
import { Sidebar } from '@/components/dashboard/Sidebar';
import { SidebarProvider } from '@/contexts/SidebarContext';

export function AppShell({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const isLoginRoute = pathname === '/login';

    if (isLoginRoute) {
        return <main className="min-h-screen">{children}</main>;
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
