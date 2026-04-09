let redirectInFlight = false;

function buildCurrentRoute(): string {
    if (typeof window === 'undefined') {
        return '/';
    }

    const query = window.location.search || '';
    return `${window.location.pathname}${query}`;
}

function normalizeNextTarget(nextTarget?: string): string {
    const resolved = nextTarget || buildCurrentRoute();
    if (!resolved || resolved === '/') {
        return '/';
    }

    return resolved;
}

export function buildDashboardLoginPath(nextTarget?: string): string {
    const next = normalizeNextTarget(nextTarget);
    if (next === '/') {
        return '/login';
    }

    return `/login?next=${encodeURIComponent(next)}`;
}

export function redirectToLoginPreservingNext(nextTarget?: string): void {
    if (typeof window === 'undefined') {
        return;
    }

    if (window.location.pathname === '/login') {
        return;
    }

    if (redirectInFlight) {
        return;
    }

    redirectInFlight = true;
    const target = buildDashboardLoginPath(nextTarget);
    window.location.replace(target);
}
