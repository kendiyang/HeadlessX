'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
    Cancel01Icon,
    CheckmarkCircle02Icon,
    Clock03Icon,
    Loading03Icon,
    Search01Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import {
    ConfigPanelShell,
    PlaygroundEmptyState,
    PlaygroundHeaderShell,
    ResultsPanelShell,
    WorkbenchLayout,
} from '../shared';

interface RedditWorkbenchProps {
    available: boolean;
    unavailableReason?: string | null;
}

type RedditInspectData = {
    target?: {
        mode?: string;
        subreddit?: string;
    };
    thread?: {
        post?: {
            title?: string;
            subreddit?: string;
            author?: string;
            score?: number;
        } | null;
        comments?: unknown[];
        moreComments?: number;
    } | null;
    listing?: {
        posts?: Array<{
            title?: string;
            subreddit?: string;
            author?: string;
            score?: number;
        }>;
        dist?: number;
    } | null;
};

type RedditApiResponse = {
    success?: boolean;
    data?: RedditInspectData;
    error?:
        | string
        | {
            message?: string;
            code?: string;
        };
};

function readErrorMessage(response: RedditApiResponse, status: number): string {
    if (typeof response.error === 'string' && response.error.trim()) {
        return response.error;
    }

    if (response.error && typeof response.error === 'object' && response.error.message) {
        return response.error.message;
    }

    return `Inspect request failed with HTTP ${status}`;
}

function ResultStat({ label, value }: { label: string; value: string | number }) {
    return (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
            <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">{label}</div>
            <div className="mt-2 text-xl font-bold text-slate-900">{value}</div>
        </div>
    );
}

const SORT_OPTIONS = [
    'confidence',
    'top',
    'new',
    'controversial',
    'old',
    'qa',
    'hot',
    'rising',
] as const;

const TIMEFRAME_OPTIONS = ['none', 'hour', 'day', 'week', 'month', 'year', 'all'] as const;

export function RedditWorkbench({ available, unavailableReason }: RedditWorkbenchProps) {
    const [input, setInput] = useState('');
    const [sort, setSort] = useState<string>('confidence');
    const [timeframe, setTimeframe] = useState<string>('none');
    const [limit, setLimit] = useState<number>(100);
    const [depth, setDepth] = useState<number>(4);
    const [timeout, setTimeoutValue] = useState<number>(45000);
    const [includeRaw, setIncludeRaw] = useState(false);
    const [isPending, setIsPending] = useState(false);
    const [result, setResult] = useState<RedditApiResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [elapsedTime, setElapsedTime] = useState<number | null>(null);
    const [startTime, setStartTime] = useState<number | null>(null);

    const abortControllerRef = useRef<AbortController | null>(null);
    const inspectData = result?.data;

    useEffect(() => {
        let interval: ReturnType<typeof setInterval> | undefined;
        if (startTime) {
            interval = setInterval(() => setElapsedTime(Date.now() - startTime), 100);
        }

        return () => {
            if (interval) {
                clearInterval(interval);
            }
        };
    }, [startTime]);

    useEffect(() => {
        return () => {
            abortControllerRef.current?.abort();
        };
    }, []);

    const summary = useMemo(() => {
        if (!inspectData) {
            return null;
        }

        const mode = inspectData.target?.mode || 'listing';
        if (mode === 'thread') {
            const post = inspectData.thread?.post || null;
            const comments = Array.isArray(inspectData.thread?.comments) ? inspectData.thread.comments.length : 0;
            const more = Number(inspectData.thread?.moreComments || 0);

            return {
                mode: 'thread',
                title: post?.title || 'Untitled thread',
                subreddit: post?.subreddit || inspectData.target?.subreddit || 'n/a',
                author: post?.author || 'n/a',
                score: post?.score ?? 'n/a',
                primaryLabel: 'Comments',
                primaryValue: comments,
                secondaryLabel: 'More',
                secondaryValue: more,
            };
        }

        const posts = Array.isArray(inspectData.listing?.posts) ? inspectData.listing.posts : [];
        const firstPost = posts[0];
        return {
            mode: 'listing',
            title: firstPost?.title || 'Listing results',
            subreddit: firstPost?.subreddit || inspectData.target?.subreddit || 'n/a',
            author: firstPost?.author || 'n/a',
            score: firstPost?.score ?? 'n/a',
            primaryLabel: 'Posts',
            primaryValue: posts.length,
            secondaryLabel: 'Dist',
            secondaryValue: inspectData.listing?.dist ?? 'n/a',
        };
    }, [inspectData]);

    const resetPendingState = () => {
        setIsPending(false);
        setStartTime(null);
        abortControllerRef.current = null;
    };

    const stopRun = () => {
        abortControllerRef.current?.abort();
        setError('Reddit inspect cancelled');
        resetPendingState();
    };

    const runInspect = async () => {
        if (!input.trim() || !available) {
            return;
        }

        abortControllerRef.current?.abort();
        abortControllerRef.current = new AbortController();

        setIsPending(true);
        setError(null);
        setResult(null);
        setElapsedTime(0);
        setStartTime(Date.now());

        try {
            const response = await fetch('/api/operators/reddit/inspect', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    input: input.trim(),
                    sort,
                    ...(timeframe !== 'none' ? { timeframe } : {}),
                    limit,
                    depth,
                    timeout,
                    includeRaw,
                }),
                signal: abortControllerRef.current.signal,
            });

            const payload = (await response.json().catch(() => null)) as RedditApiResponse | null;
            if (!response.ok || !payload) {
                throw new Error(readErrorMessage(payload || {}, response.status));
            }

            if (!payload.success) {
                throw new Error(readErrorMessage(payload, response.status));
            }

            setResult(payload);
            resetPendingState();
        } catch (requestError) {
            if ((requestError as Error).name === 'AbortError') {
                return;
            }

            setError(requestError instanceof Error ? requestError.message : 'Reddit inspect failed');
            resetPendingState();
        }
    };

    return (
        <WorkbenchLayout
            header={
                <PlaygroundHeaderShell
                    title="Reddit"
                    description="Inspect Reddit thread/listing metadata through the hidden .json interface."
                    iconSlot={
                        <div className="absolute inset-0 flex items-center justify-center rounded-2xl border border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(251,146,60,0.28),_transparent_58%),radial-gradient(circle_at_bottom_right,_rgba(249,115,22,0.18),_transparent_54%),linear-gradient(135deg,rgba(255,255,255,1),rgba(255,247,237,1))] text-slate-900">
                            <HugeiconsIcon icon={Search01Icon} className="h-5 w-5" />
                        </div>
                    }
                    secondary={
                        <div className="inline-flex items-center gap-2 rounded-full border border-slate-900 bg-slate-900 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-white">
                            <HugeiconsIcon icon={Search01Icon} className="h-3.5 w-3.5" />
                            Inspect
                        </div>
                    }
                    controls={
                        <>
                            <div
                                className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium font-mono transition-all ${
                                    elapsedTime !== null
                                        ? 'border-slate-200 bg-slate-50 text-slate-700'
                                        : 'pointer-events-none opacity-0'
                                }`}
                            >
                                <HugeiconsIcon icon={Clock03Icon} className="h-4 w-4 text-slate-400" />
                                {elapsedTime !== null ? (elapsedTime / 1000).toFixed(1) : '0.0'}s
                            </div>
                            {!available && (
                                <div className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-700">
                                    <HugeiconsIcon icon={Search01Icon} className="h-4 w-4" />
                                    Unavailable
                                </div>
                            )}
                        </>
                    }
                />
            }
            config={
                <ConfigPanelShell
                    iconSlot={
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[radial-gradient(circle_at_top_left,_rgba(251,146,60,0.25),_transparent_62%),linear-gradient(135deg,rgba(255,255,255,1),rgba(255,247,237,1))] text-slate-900 ring-1 ring-slate-200">
                            <HugeiconsIcon icon={Search01Icon} className="h-5 w-5" />
                        </div>
                    }
                    title="Inspect Config"
                    description="Append .json to Reddit thread/listing URLs and normalize structured thread data."
                    disabled={!available}
                >
                    <div className="space-y-5">
                        {!available && (
                            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-700">
                                {unavailableReason || 'Reddit operator is not available right now.'}
                            </div>
                        )}

                        <div className="space-y-2">
                            <label className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
                                URL, Path, or Post ID
                            </label>
                            <input
                                type="text"
                                value={input}
                                onChange={(event) => setInput(event.target.value)}
                                placeholder="https://www.reddit.com/r/.../comments/... or /r/.../comments/... or 1s0kubi"
                                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-900 outline-none transition-colors placeholder:text-slate-400 hover:border-slate-300 hover:bg-white focus:border-slate-400"
                            />
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Sort</label>
                                <select
                                    value={sort}
                                    onChange={(event) => setSort(event.target.value)}
                                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-900 outline-none transition-colors hover:border-slate-300 hover:bg-white focus:border-slate-400"
                                >
                                    {SORT_OPTIONS.map((option) => (
                                        <option key={option} value={option}>
                                            {option}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Timeframe</label>
                                <select
                                    value={timeframe}
                                    onChange={(event) => setTimeframe(event.target.value)}
                                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-900 outline-none transition-colors hover:border-slate-300 hover:bg-white focus:border-slate-400"
                                >
                                    {TIMEFRAME_OPTIONS.map((option) => (
                                        <option key={option} value={option}>
                                            {option}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-3">
                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Limit</label>
                                <input
                                    type="number"
                                    min={1}
                                    max={500}
                                    value={limit}
                                    onChange={(event) => setLimit(Math.max(1, Math.min(500, Number(event.target.value) || 1)))}
                                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-900 outline-none transition-colors hover:border-slate-300 hover:bg-white focus:border-slate-400"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Depth</label>
                                <input
                                    type="number"
                                    min={0}
                                    max={10}
                                    value={depth}
                                    onChange={(event) => setDepth(Math.max(0, Math.min(10, Number(event.target.value) || 0)))}
                                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-900 outline-none transition-colors hover:border-slate-300 hover:bg-white focus:border-slate-400"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Timeout (ms)</label>
                                <input
                                    type="number"
                                    min={3000}
                                    max={120000}
                                    value={timeout}
                                    onChange={(event) => setTimeoutValue(Math.max(3000, Math.min(120000, Number(event.target.value) || 3000)))}
                                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-900 outline-none transition-colors hover:border-slate-300 hover:bg-white focus:border-slate-400"
                                />
                            </div>
                        </div>

                        <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
                            <input
                                type="checkbox"
                                className="h-4 w-4 rounded border-slate-300"
                                checked={includeRaw}
                                onChange={(event) => setIncludeRaw(event.target.checked)}
                            />
                            Include raw JSON payload
                        </label>

                        <div className="grid gap-3 sm:grid-cols-2">
                            <button
                                type="button"
                                onClick={runInspect}
                                disabled={!available || !input.trim() || isPending}
                                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {isPending ? (
                                    <>
                                        <HugeiconsIcon icon={Loading03Icon} className="h-4 w-4 animate-spin" />
                                        Inspecting
                                    </>
                                ) : (
                                    <>
                                        <HugeiconsIcon icon={Search01Icon} className="h-4 w-4" />
                                        Run Inspect
                                    </>
                                )}
                            </button>

                            <button
                                type="button"
                                onClick={stopRun}
                                disabled={!isPending}
                                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm font-semibold text-red-600 transition-colors hover:border-red-300 hover:bg-red-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-white disabled:text-slate-400 disabled:opacity-50"
                            >
                                <HugeiconsIcon icon={Cancel01Icon} className="h-4 w-4" />
                                Stop
                            </button>
                        </div>
                    </div>
                </ConfigPanelShell>
            }
            results={
                <ResultsPanelShell
                    header={
                        <div className="border-b border-slate-200 px-6 py-4">
                            <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Inspect Result</div>
                            <div className="mt-1 text-lg font-bold text-slate-900">Reddit structured dataset</div>
                        </div>
                    }
                >
                    {isPending && (
                        <div className="absolute inset-0 flex items-center justify-center gap-3 text-sm font-semibold text-slate-600">
                            <HugeiconsIcon icon={Loading03Icon} className="h-5 w-5 animate-spin text-emerald-500" />
                            Resolving Reddit JSON endpoint
                        </div>
                    )}

                    {!isPending && error && (
                        <div className="p-6">
                            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                                {error}
                            </div>
                        </div>
                    )}

                    {!isPending && !error && summary && (
                        <div className="space-y-5 p-6">
                            <div className="grid gap-3 md:grid-cols-3">
                                <ResultStat label="Mode" value={summary.mode} />
                                <ResultStat label={summary.primaryLabel} value={summary.primaryValue} />
                                <ResultStat label="Score" value={String(summary.score)} />
                            </div>

                            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                                <div className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Summary</div>
                                <div className="mt-2 text-sm font-semibold text-slate-900">{summary.title}</div>
                                <div className="mt-1 text-xs text-slate-500">
                                    Subreddit: {summary.subreddit} • Author: {summary.author} • {summary.secondaryLabel}: {summary.secondaryValue}
                                </div>
                            </div>

                            <div className="rounded-2xl border border-slate-200 bg-slate-950 p-4">
                                <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-300">
                                    <HugeiconsIcon icon={CheckmarkCircle02Icon} className="h-3 w-3" />
                                    JSON
                                </div>
                                <pre className="max-h-[420px] overflow-auto text-xs leading-6 text-slate-200">
                                    {JSON.stringify(result, null, 2)}
                                </pre>
                            </div>
                        </div>
                    )}

                    {!isPending && !error && !summary && (
                        <PlaygroundEmptyState
                            icon={Search01Icon}
                            title="Ready to inspect"
                            body="Run a Reddit inspect request to view structured subreddit, post, and comment data here."
                        />
                    )}
                </ResultsPanelShell>
            }
        />
    );
}
