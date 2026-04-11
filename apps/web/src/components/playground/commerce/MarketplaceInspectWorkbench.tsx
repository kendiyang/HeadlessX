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

interface MarketplaceInspectWorkbenchProps {
    operatorLabel: string;
    description: string;
    endpoint: string;
    inputPlaceholder: string;
    marketplacePlaceholder: string;
    loadingLabel: string;
    idStatLabel: string;
    available: boolean;
    unavailableReason?: string | null;
    supportsReviews?: boolean;
    reviewPageLimitMax?: number;
    showMarketplaceInput?: boolean;
    showWaitForSelectorInput?: boolean;
    showTimeoutInput?: boolean;
}

type MarketplaceApiResponse = {
    success?: boolean;
    data?: any;
    error?:
        | string
        | {
            message?: string;
            code?: string;
        };
};

function readErrorMessage(response: MarketplaceApiResponse, status: number): string {
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

export function MarketplaceInspectWorkbench({
    operatorLabel,
    description,
    endpoint,
    inputPlaceholder,
    marketplacePlaceholder,
    loadingLabel,
    idStatLabel,
    available,
    unavailableReason,
    supportsReviews = false,
    reviewPageLimitMax = 5000,
    showMarketplaceInput = true,
    showWaitForSelectorInput = true,
    showTimeoutInput = true,
}: MarketplaceInspectWorkbenchProps) {
    const [input, setInput] = useState('');
    const [marketplace, setMarketplace] = useState('');
    const [includeReviews, setIncludeReviews] = useState(true);
    const [reviewPageLimit, setReviewPageLimit] = useState(1);
    const [reviewSortBy, setReviewSortBy] = useState<'recent' | 'relevant'>('recent');
    const [reviewStar, setReviewStar] = useState<'positive' | 'neutral' | 'negative'>('positive');
    const [reviewStopAtId, setReviewStopAtId] = useState('');
    const [stealth, setStealth] = useState(true);
    const [timeout, setTimeoutValue] = useState(60000);
    const [waitForSelector, setWaitForSelector] = useState('');
    const [isPending, setIsPending] = useState(false);
    const [result, setResult] = useState<MarketplaceApiResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [elapsedTime, setElapsedTime] = useState<number | null>(null);
    const [startTime, setStartTime] = useState<number | null>(null);

    const abortControllerRef = useRef<AbortController | null>(null);
    const inspectData = result?.data;
    const showInlineReviewsToggle = supportsReviews && !showTimeoutInput;

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

        const entity = inspectData.item || inspectData.product || inspectData || {};
        const recordId = inspectData.item?.itemId || inspectData.product?.productId || inspectData.asin || 'n/a';
        const title = entity.title || 'Untitled';
        const priceValue = typeof entity.price === 'object' && entity.price
            ? entity.price.value
            : entity.price;
        const priceCurrency = typeof entity.price === 'object' && entity.price
            ? entity.price.currency
            : null;
        const price = entity.priceText || (priceValue !== undefined && priceValue !== null
            ? `${priceCurrency || ''}${priceValue}`
            : 'n/a');
        const seller = typeof entity.seller === 'object' && entity.seller
            ? entity.seller.name || 'n/a'
            : entity.seller || 'n/a';
        const marketplaceDomain = inspectData.marketplace?.domain || (() => {
            try {
                return inspectData.url ? new URL(inspectData.url).hostname : 'n/a';
            } catch {
                return 'n/a';
            }
        })();
        const blocked = inspectData.diagnostics?.blocked === true
            ? 'yes'
            : inspectData.diagnostics?.blocked === false
                ? 'no'
                : 'n/a';
        const signalCount = Array.isArray(inspectData.diagnostics?.antiBotSignals)
            ? inspectData.diagnostics.antiBotSignals.length
            : 0;

        return {
            recordId,
            title,
            price,
            seller,
            marketplaceDomain,
            blocked,
            signalCount,
        };
    }, [inspectData]);

    const resetPendingState = () => {
        setIsPending(false);
        setStartTime(null);
        abortControllerRef.current = null;
    };

    const stopRun = () => {
        abortControllerRef.current?.abort();
        setError(`${operatorLabel} inspect cancelled`);
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
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    input: input.trim(),
                    ...(showMarketplaceInput && marketplace.trim() ? { marketplace: marketplace.trim() } : {}),
                    ...(supportsReviews
                        ? {
                            includeReviews,
                            reviewPageLimit: Math.max(1, Math.min(reviewPageLimitMax, reviewPageLimit || 1)),
                            reviewSortBy,
                            reviewStar,
                            ...(reviewStopAtId.trim() ? { reviewStopAtId: reviewStopAtId.trim() } : {}),
                        }
                        : {}),
                    ...(showTimeoutInput ? { timeout } : {}),
                    stealth,
                    ...(showWaitForSelectorInput && waitForSelector.trim()
                        ? { waitForSelector: waitForSelector.trim() }
                        : {}),
                }),
                signal: abortControllerRef.current.signal,
            });

            const payload = (await response.json().catch(() => null)) as MarketplaceApiResponse | null;
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

            setError(requestError instanceof Error ? requestError.message : `${operatorLabel} inspect failed`);
            resetPendingState();
        }
    };

    return (
        <WorkbenchLayout
            header={
                <PlaygroundHeaderShell
                    title={operatorLabel}
                    description={description}
                    iconSlot={
                        <div className="absolute inset-0 flex items-center justify-center rounded-2xl border border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.22),_transparent_58%),radial-gradient(circle_at_bottom_right,_rgba(16,185,129,0.16),_transparent_54%),linear-gradient(135deg,rgba(255,255,255,1),rgba(241,245,249,1))] text-slate-900">
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
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.2),_transparent_62%),linear-gradient(135deg,rgba(255,255,255,1),rgba(240,249,255,1))] text-slate-900 ring-1 ring-slate-200">
                            <HugeiconsIcon icon={Search01Icon} className="h-5 w-5" />
                        </div>
                    }
                    title="Inspect Config"
                    description="Run a metadata inspect request with optional marketplace and extraction waits."
                    disabled={!available}
                >
                    <div className="space-y-5">
                        {!available && (
                            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-700">
                                {unavailableReason || `${operatorLabel} operator is not available right now.`}
                            </div>
                        )}

                        <div className="space-y-2">
                            <label className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
                                URL or ID
                            </label>
                            <input
                                type="text"
                                value={input}
                                onChange={(event) => setInput(event.target.value)}
                                placeholder={inputPlaceholder}
                                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-900 outline-none transition-colors placeholder:text-slate-400 hover:border-slate-300 hover:bg-white focus:border-slate-400"
                            />
                        </div>

                        {showMarketplaceInput && (
                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
                                    Marketplace
                                </label>
                                <input
                                    type="text"
                                    value={marketplace}
                                    onChange={(event) => setMarketplace(event.target.value)}
                                    placeholder={marketplacePlaceholder}
                                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-900 outline-none transition-colors placeholder:text-slate-400 hover:border-slate-300 hover:bg-white focus:border-slate-400"
                                />
                            </div>
                        )}

                        <div className="grid gap-3 sm:grid-cols-2">
                            {showTimeoutInput ? (
                                <div className="space-y-2">
                                    <label className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Timeout (ms)</label>
                                    <input
                                        type="number"
                                        min={5000}
                                        max={180000}
                                        value={timeout}
                                        onChange={(event) => setTimeoutValue(Math.max(5000, Math.min(180000, Number(event.target.value) || 5000)))}
                                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-900 outline-none transition-colors hover:border-slate-300 hover:bg-white focus:border-slate-400"
                                    />
                                </div>
                            ) : showInlineReviewsToggle ? (
                                <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
                                    <input
                                        type="checkbox"
                                        className="h-4 w-4 rounded border-slate-300"
                                        checked={includeReviews}
                                        onChange={(event) => setIncludeReviews(event.target.checked)}
                                    />
                                    Include reviews
                                </label>
                            ) : (
                                <div />
                            )}
                            <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
                                <input
                                    type="checkbox"
                                    className="h-4 w-4 rounded border-slate-300"
                                    checked={stealth}
                                    onChange={(event) => setStealth(event.target.checked)}
                                />
                                Stealth mode
                            </label>
                        </div>

                        {supportsReviews && (
                            <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                <div className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Review Options</div>

                                {!showInlineReviewsToggle && (
                                    <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700">
                                        <input
                                            type="checkbox"
                                            className="h-4 w-4 rounded border-slate-300"
                                            checked={includeReviews}
                                            onChange={(event) => setIncludeReviews(event.target.checked)}
                                        />
                                        Include reviews
                                    </label>
                                )}

                                <div className="grid gap-3 sm:grid-cols-2">
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Review pages</label>
                                        <input
                                            type="number"
                                            min={1}
                                            max={reviewPageLimitMax}
                                            value={reviewPageLimit}
                                            disabled={!includeReviews}
                                            onChange={(event) =>
                                                setReviewPageLimit(
                                                    Math.max(1, Math.min(reviewPageLimitMax, Number(event.target.value) || 1))
                                                )
                                            }
                                            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-900 outline-none transition-colors hover:border-slate-300 focus:border-slate-400 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Review sort</label>
                                        <select
                                            value={reviewSortBy}
                                            disabled={!includeReviews}
                                            onChange={(event) => setReviewSortBy(event.target.value as 'recent' | 'relevant')}
                                            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-900 outline-none transition-colors hover:border-slate-300 focus:border-slate-400 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                                        >
                                            <option value="recent">recent</option>
                                            <option value="relevant">relevant</option>
                                        </select>
                                    </div>
                                </div>

                                <div className="grid gap-3 sm:grid-cols-2">
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Rating type</label>
                                        <select
                                            value={reviewStar}
                                            disabled={!includeReviews}
                                            onChange={(event) => setReviewStar(event.target.value as 'positive' | 'neutral' | 'negative')}
                                            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-900 outline-none transition-colors hover:border-slate-300 focus:border-slate-400 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                                        >
                                            <option value="positive">Positive</option>
                                            <option value="neutral">Neutral</option>
                                            <option value="negative">Negative</option>
                                        </select>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Review stop ID</label>
                                        <input
                                            type="text"
                                            value={reviewStopAtId}
                                            disabled={!includeReviews}
                                            onChange={(event) => setReviewStopAtId(event.target.value)}
                                            placeholder="optional"
                                            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-900 outline-none transition-colors placeholder:text-slate-400 hover:border-slate-300 focus:border-slate-400 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                                        />
                                    </div>
                                </div>
                            </div>
                        )}

                        {showWaitForSelectorInput && (
                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Wait Selector (optional)</label>
                                <input
                                    type="text"
                                    value={waitForSelector}
                                    onChange={(event) => setWaitForSelector(event.target.value)}
                                    placeholder="example: [data-testid='price']"
                                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-900 outline-none transition-colors placeholder:text-slate-400 hover:border-slate-300 hover:bg-white focus:border-slate-400"
                                />
                            </div>
                        )}

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
                            <div className="mt-1 text-lg font-bold text-slate-900">{operatorLabel} structured dataset</div>
                        </div>
                    }
                >
                    {isPending && (
                        <div className="absolute inset-0 flex items-center justify-center gap-3 text-sm font-semibold text-slate-600">
                            <HugeiconsIcon icon={Loading03Icon} className="h-5 w-5 animate-spin text-emerald-500" />
                            {loadingLabel}
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
                                <ResultStat label={idStatLabel} value={summary.recordId} />
                                <ResultStat label="Price" value={String(summary.price)} />
                                <ResultStat label="Blocked" value={summary.blocked} />
                            </div>

                            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                                <div className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Listing</div>
                                <div className="mt-2 text-sm font-semibold text-slate-900">{summary.title}</div>
                                <div className="mt-1 text-xs text-slate-500">
                                    Marketplace: {summary.marketplaceDomain} • Seller: {summary.seller} • Signals: {summary.signalCount}
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
                            body={`Run a ${operatorLabel} inspect request to view structured metadata here.`}
                        />
                    )}
                </ResultsPanelShell>
            }
        />
    );
}
