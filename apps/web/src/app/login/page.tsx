'use client';

import { FormEvent, Suspense, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

function normalizeRedirectTarget(value: string | null): string {
    if (!value) {
        return '/';
    }

    if (!value.startsWith('/') || value.startsWith('//')) {
        return '/';
    }

    return value;
}

function LoginPageContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const nextTarget = useMemo(
        () => normalizeRedirectTarget(searchParams.get('next')),
        [searchParams]
    );

    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setSubmitting(true);
        setError(null);

        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                },
                body: JSON.stringify({
                    username: username.trim(),
                    password,
                }),
            });

            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                const message =
                    (payload && typeof payload.error === 'string' && payload.error) ||
                    'Login failed. Check your credentials and try again.';
                setError(message);
                return;
            }

            router.replace(nextTarget);
            router.refresh();
        } catch {
            setError('Login request failed. Check network and try again.');
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-6 py-12">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_10%_20%,rgba(59,130,246,0.2),transparent_45%),radial-gradient(circle_at_85%_10%,rgba(16,185,129,0.16),transparent_45%),linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)]" />

            <div className="relative w-full max-w-md rounded-[2rem] border border-slate-200/80 bg-white/90 p-8 shadow-[0_24px_80px_rgba(15,23,42,0.12)] backdrop-blur">
                <div className="mb-7 space-y-2">
                    <h1 className="text-2xl font-bold tracking-[-0.03em] text-slate-950">Dashboard Login</h1>
                    <p className="text-sm text-slate-600">
                        Authenticate before accessing HeadlessX dashboard and internal operator routes.
                    </p>
                </div>

                <form className="space-y-4" onSubmit={handleSubmit}>
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-700" htmlFor="dashboard-username">
                            Username
                        </label>
                        <Input
                            id="dashboard-username"
                            autoComplete="username"
                            value={username}
                            onChange={(event) => setUsername(event.target.value)}
                            disabled={submitting}
                            required
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-700" htmlFor="dashboard-password">
                            Password
                        </label>
                        <Input
                            id="dashboard-password"
                            type="password"
                            autoComplete="current-password"
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                            disabled={submitting}
                            required
                        />
                    </div>

                    {error ? (
                        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                            {error}
                        </div>
                    ) : null}

                    <Button className="h-11 w-full" disabled={submitting} type="submit">
                        {submitting ? 'Signing in...' : 'Sign in'}
                    </Button>
                </form>
            </div>
        </div>
    );
}

function LoginFallback() {
    return (
        <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-6 py-12">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_10%_20%,rgba(59,130,246,0.2),transparent_45%),radial-gradient(circle_at_85%_10%,rgba(16,185,129,0.16),transparent_45%),linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)]" />
            <div className="relative w-full max-w-md rounded-[2rem] border border-slate-200/80 bg-white/90 p-8 shadow-[0_24px_80px_rgba(15,23,42,0.12)] backdrop-blur">
                <div className="h-6 w-40 animate-pulse rounded bg-slate-200" />
            </div>
        </div>
    );
}

export default function LoginPage() {
    return (
        <Suspense fallback={<LoginFallback />}>
            <LoginPageContent />
        </Suspense>
    );
}
