import { buildDiagnostics } from '../commerce/CommerceInspectCore';

const DEFAULT_REDDIT_HOST = 'www.reddit.com';
const REDDIT_HOST_PATTERN = /^(?:[a-z0-9-]+\.)*reddit\.com$/i;
const REDDIT_SHORT_HOST_PATTERN = /^(?:[a-z0-9-]+\.)*redd\.it$/i;
const POST_ID_PATTERN = /^[a-z0-9]{5,8}$/i;
const DEFAULT_TIMEOUT_MS = 45000;
const MIN_TIMEOUT_MS = 3000;
const MAX_TIMEOUT_MS = 120000;
const DEFAULT_LIMIT = 100;
const MIN_LIMIT = 1;
const MAX_LIMIT = 500;
const DEFAULT_DEPTH = 4;
const MIN_DEPTH = 0;
const MAX_DEPTH = 10;
const REDDIT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const REDDIT_TIMEFRAMES = ['hour', 'day', 'week', 'month', 'year', 'all'] as const;

export type RedditTimeframe = (typeof REDDIT_TIMEFRAMES)[number];

export interface RedditInspectInput {
    input: string;
    sort?: string;
    timeframe?: RedditTimeframe;
    limit?: number;
    depth?: number;
    timeout?: number;
    includeRaw?: boolean;
}

export interface RedditPostRecord {
    id: string | null;
    fullname: string | null;
    subreddit: string | null;
    subredditId: string | null;
    title: string | null;
    author: string | null;
    authorFullname: string | null;
    score: number | null;
    upvoteRatio: number | null;
    commentCount: number | null;
    createdUtc: number | null;
    permalink: string | null;
    url: string | null;
    selfText: string | null;
    flair: string | null;
    domain: string | null;
    thumbnail: string | null;
    over18: boolean | null;
    spoiler: boolean | null;
    locked: boolean | null;
    archived: boolean | null;
    stickied: boolean | null;
    isSelf: boolean | null;
}

export interface RedditCommentRecord {
    id: string | null;
    fullname: string | null;
    parentId: string | null;
    depth: number | null;
    author: string | null;
    authorFullname: string | null;
    body: string | null;
    score: number | null;
    createdUtc: number | null;
    permalink: string | null;
    isSubmitter: boolean | null;
    distinguished: string | null;
    stickied: boolean | null;
    controversiality: number | null;
    edited: boolean | number | null;
}

export interface RedditInspectResult {
    input: string;
    target: {
        mode: 'thread' | 'listing';
        url: string;
        jsonUrl: string;
        subreddit: string | null;
        postId: string | null;
        sort: string | null;
        timeframe: RedditTimeframe | null;
    };
    thread: {
        post: RedditPostRecord | null;
        comments: RedditCommentRecord[];
        totalComments: number | null;
        moreComments: number;
    } | null;
    listing: {
        posts: RedditPostRecord[];
        after: string | null;
        before: string | null;
        dist: number | null;
    } | null;
    diagnostics: {
        blocked: boolean;
        warnings: string[];
        crawledUrls: string[];
        antiBotSignals: string[];
        generatedAt: string;
    };
    raw?: unknown;
}

interface NormalizedRedditTarget {
    mode: 'thread' | 'listing';
    url: string;
    jsonUrl: string;
    subreddit: string | null;
    postId: string | null;
    sort: string | null;
    timeframe: RedditTimeframe | null;
}

interface CommentCollectionState {
    items: RedditCommentRecord[];
    moreComments: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    return null;
}

function asString(value: unknown): string | null {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
    }
    return null;
}

function asNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string') {
        const parsed = Number.parseFloat(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return null;
}

function asInteger(value: unknown): number | null {
    const numeric = asNumber(value);
    return numeric !== null ? Math.trunc(numeric) : null;
}

function asBoolean(value: unknown): boolean | null {
    if (typeof value === 'boolean') {
        return value;
    }
    return null;
}

function toAbsoluteRedditUrl(value: string | null): string | null {
    if (!value) {
        return null;
    }

    if (/^https?:\/\//i.test(value)) {
        return value;
    }

    if (value.startsWith('/')) {
        return `https://${DEFAULT_REDDIT_HOST}${value}`;
    }

    return value;
}

function looksLikeListing(value: unknown): boolean {
    const record = asRecord(value);
    if (!record) {
        return false;
    }

    const kind = asString(record.kind);
    const data = asRecord(record.data);
    const children = Array.isArray(data?.children) ? data.children : null;

    return kind?.toLowerCase() === 'listing' && Array.isArray(children);
}

function listChildren(listing: unknown): Record<string, unknown>[] {
    const data = asRecord(asRecord(listing)?.data);
    const children = Array.isArray(data?.children) ? data.children : [];
    return children
        .map((entry) => asRecord(entry))
        .filter((entry): entry is Record<string, unknown> => Boolean(entry));
}

function normalizePathname(pathname: string): string {
    let normalized = pathname.replace(/\/{2,}/g, '/').trim();
    if (!normalized.startsWith('/')) {
        normalized = `/${normalized}`;
    }

    normalized = normalized.replace(/\.json$/i, '');
    if (normalized.length > 1 && normalized.endsWith('/')) {
        normalized = normalized.slice(0, -1);
    }

    return normalized || '/';
}

function extractSubreddit(pathname: string): string | null {
    return pathname.match(/\/r\/([^/]+)/i)?.[1] || null;
}

function extractPostId(pathname: string): string | null {
    return pathname.match(/\/comments\/([a-z0-9]{5,8})(?:\/|$)/i)?.[1]?.toLowerCase() || null;
}

function normalizeSort(value: string | undefined): string | null {
    if (typeof value !== 'string') {
        return null;
    }
    const normalized = value?.trim().toLowerCase();
    return normalized ? normalized : null;
}

function normalizeTimeframe(value: RedditTimeframe | undefined): RedditTimeframe | null {
    if (typeof value !== 'string') {
        return null;
    }

    const normalized = value.trim().toLowerCase();
    if (!normalized) {
        return null;
    }

    if ((REDDIT_TIMEFRAMES as readonly string[]).includes(normalized)) {
        return normalized as RedditTimeframe;
    }

    throw new RedditServiceError(
        `Timeframe must be one of: ${REDDIT_TIMEFRAMES.join(', ')}.`,
        'INVALID_REDDIT_TIMEFRAME',
        400
    );
}

function normalizeTimeout(timeout: number | undefined): number {
    if (timeout === undefined) {
        return DEFAULT_TIMEOUT_MS;
    }

    if (!Number.isFinite(timeout) || timeout < MIN_TIMEOUT_MS || timeout > MAX_TIMEOUT_MS) {
        throw new RedditServiceError(
            `Timeout must be between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS} milliseconds.`,
            'INVALID_REDDIT_TIMEOUT',
            400
        );
    }

    return Math.trunc(timeout);
}

function normalizeLimit(limit: number | undefined): number {
    if (limit === undefined) {
        return DEFAULT_LIMIT;
    }

    if (!Number.isFinite(limit) || limit < MIN_LIMIT || limit > MAX_LIMIT) {
        throw new RedditServiceError(
            `Limit must be between ${MIN_LIMIT} and ${MAX_LIMIT}.`,
            'INVALID_REDDIT_LIMIT',
            400
        );
    }

    return Math.trunc(limit);
}

function normalizeDepth(depth: number | undefined): number {
    if (depth === undefined) {
        return DEFAULT_DEPTH;
    }

    if (!Number.isFinite(depth) || depth < MIN_DEPTH || depth > MAX_DEPTH) {
        throw new RedditServiceError(
            `Depth must be between ${MIN_DEPTH} and ${MAX_DEPTH}.`,
            'INVALID_REDDIT_DEPTH',
            400
        );
    }

    return Math.trunc(depth);
}

function normalizeTargetInput(input: string): URL {
    const trimmed = input.trim();
    if (!trimmed) {
        throw new RedditServiceError(
            'Input must be a Reddit URL/path, a redd.it short URL, or a Reddit post ID.',
            'INVALID_REDDIT_INPUT',
            400
        );
    }

    if (POST_ID_PATTERN.test(trimmed)) {
        return new URL(`/comments/${trimmed.toLowerCase()}`, `https://${DEFAULT_REDDIT_HOST}`);
    }

    if (trimmed.startsWith('/')) {
        return new URL(trimmed, `https://${DEFAULT_REDDIT_HOST}`);
    }

    try {
        return new URL(trimmed);
    } catch {
        try {
            return new URL(`https://${trimmed}`);
        } catch {
            throw new RedditServiceError(
                'Input must be a valid Reddit URL/path or post ID.',
                'INVALID_REDDIT_INPUT',
                400
            );
        }
    }
}

function normalizeRedditTarget(input: RedditInspectInput, limit: number, depth: number): NormalizedRedditTarget {
    const targetUrl = normalizeTargetInput(input.input);
    const protocol = targetUrl.protocol.toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') {
        throw new RedditServiceError('Only HTTP and HTTPS Reddit URLs are supported.', 'INVALID_REDDIT_INPUT', 400);
    }

    let normalizedUrl = targetUrl;
    const host = targetUrl.hostname.toLowerCase();

    if (REDDIT_SHORT_HOST_PATTERN.test(host)) {
        const shortId = targetUrl.pathname.split('/').filter(Boolean)[0] || '';
        if (!POST_ID_PATTERN.test(shortId)) {
            throw new RedditServiceError(
                'redd.it links must include a valid Reddit post ID.',
                'INVALID_REDDIT_INPUT',
                400
            );
        }

        normalizedUrl = new URL(`/comments/${shortId.toLowerCase()}`, `https://${DEFAULT_REDDIT_HOST}`);
    } else if (!REDDIT_HOST_PATTERN.test(host)) {
        throw new RedditServiceError(
            'Input must target reddit.com or redd.it.',
            'INVALID_REDDIT_INPUT',
            400
        );
    } else if (host !== DEFAULT_REDDIT_HOST) {
        normalizedUrl = new URL(targetUrl.toString());
        normalizedUrl.hostname = DEFAULT_REDDIT_HOST;
        normalizedUrl.protocol = 'https:';
        normalizedUrl.port = '';
    }

    const normalizedPath = normalizePathname(normalizedUrl.pathname);
    const mode: 'thread' | 'listing' = /\/comments\/[a-z0-9]{5,8}(?:\/|$)/i.test(normalizedPath) ? 'thread' : 'listing';
    const subreddit = extractSubreddit(normalizedPath);
    const postId = extractPostId(normalizedPath);
    const sort = normalizeSort(input.sort);
    const timeframe = normalizeTimeframe(input.timeframe);

    const canonicalUrl = new URL(normalizedPath, `https://${DEFAULT_REDDIT_HOST}`);

    const jsonUrl = new URL(`${normalizedPath}.json`, `https://${DEFAULT_REDDIT_HOST}`);
    const mergedSearch = new URLSearchParams(normalizedUrl.search);
    mergedSearch.set('raw_json', '1');

    if (sort) {
        mergedSearch.set('sort', sort);
    }
    if (timeframe) {
        mergedSearch.set('t', timeframe);
    }
    if (mode === 'thread') {
        mergedSearch.set('limit', String(limit));
        mergedSearch.set('depth', String(depth));
    } else {
        mergedSearch.set('limit', String(limit));
    }

    jsonUrl.search = mergedSearch.toString();

    return {
        mode,
        url: canonicalUrl.toString(),
        jsonUrl: jsonUrl.toString(),
        subreddit,
        postId,
        sort,
        timeframe,
    };
}

function normalizeThumbnail(value: string | null): string | null {
    if (!value) {
        return null;
    }
    const normalized = value.trim().toLowerCase();
    if (normalized === 'self' || normalized === 'default' || normalized === 'nsfw' || normalized === 'image') {
        return null;
    }
    return value;
}

function mapPostRecord(raw: Record<string, unknown>): RedditPostRecord {
    return {
        id: asString(raw.id),
        fullname: asString(raw.name),
        subreddit: asString(raw.subreddit),
        subredditId: asString(raw.subreddit_id),
        title: asString(raw.title),
        author: asString(raw.author),
        authorFullname: asString(raw.author_fullname),
        score: asInteger(raw.score),
        upvoteRatio: asNumber(raw.upvote_ratio),
        commentCount: asInteger(raw.num_comments),
        createdUtc: asNumber(raw.created_utc),
        permalink: toAbsoluteRedditUrl(asString(raw.permalink)),
        url: toAbsoluteRedditUrl(asString(raw.url_overridden_by_dest) || asString(raw.url)),
        selfText: asString(raw.selftext),
        flair: asString(raw.link_flair_text),
        domain: asString(raw.domain),
        thumbnail: normalizeThumbnail(asString(raw.thumbnail)),
        over18: asBoolean(raw.over_18),
        spoiler: asBoolean(raw.spoiler),
        locked: asBoolean(raw.locked),
        archived: asBoolean(raw.archived),
        stickied: asBoolean(raw.stickied),
        isSelf: asBoolean(raw.is_self),
    };
}

function mapCommentRecord(raw: Record<string, unknown>, depth: number): RedditCommentRecord {
    const editedValue = raw.edited;
    let edited: boolean | number | null = null;
    if (typeof editedValue === 'boolean') {
        edited = editedValue;
    } else if (typeof editedValue === 'number' && Number.isFinite(editedValue)) {
        edited = editedValue;
    }

    return {
        id: asString(raw.id),
        fullname: asString(raw.name),
        parentId: asString(raw.parent_id),
        depth,
        author: asString(raw.author),
        authorFullname: asString(raw.author_fullname),
        body: asString(raw.body),
        score: asInteger(raw.score),
        createdUtc: asNumber(raw.created_utc),
        permalink: toAbsoluteRedditUrl(asString(raw.permalink)),
        isSubmitter: asBoolean(raw.is_submitter),
        distinguished: asString(raw.distinguished),
        stickied: asBoolean(raw.stickied),
        controversiality: asInteger(raw.controversiality),
        edited,
    };
}

function collectComments(
    listing: unknown,
    state: CommentCollectionState,
    options: { limit: number; maxDepth: number }
) {
    if (state.items.length >= options.limit) {
        return;
    }

    const children = listChildren(listing);
    for (const child of children) {
        if (state.items.length >= options.limit) {
            return;
        }

        const kind = asString(child.kind)?.toLowerCase();
        const data = asRecord(child.data);

        if (!kind || !data) {
            continue;
        }

        if (kind === 't1') {
            const depth = asInteger(data.depth) ?? 0;
            if (depth <= options.maxDepth) {
                state.items.push(mapCommentRecord(data, depth));
            }

            if (depth < options.maxDepth) {
                const replies = data.replies;
                if (replies && typeof replies === 'object') {
                    collectComments(replies, state, options);
                }
            }
            continue;
        }

        if (kind === 'more') {
            const moreCount = asInteger(data.count);
            if (moreCount !== null && moreCount > 0) {
                state.moreComments += moreCount;
                continue;
            }

            const childrenIds = Array.isArray(data.children) ? data.children.length : 0;
            state.moreComments += childrenIds > 0 ? childrenIds : 1;
        }
    }
}

function parseThreadPayload(payload: unknown, limit: number, depth: number): {
    post: RedditPostRecord | null;
    comments: RedditCommentRecord[];
    totalComments: number | null;
    moreComments: number;
} {
    const payloadArray = Array.isArray(payload) ? payload : [];
    const postListing = payloadArray[0];
    const commentsListing = payloadArray[1];

    const postChildren = listChildren(postListing);
    const postChild = postChildren.find((entry) => asString(entry.kind)?.toLowerCase() === 't3');
    const postData = asRecord(postChild?.data);
    const post = postData ? mapPostRecord(postData) : null;

    const commentState: CommentCollectionState = {
        items: [],
        moreComments: 0,
    };
    collectComments(commentsListing, commentState, {
        limit,
        maxDepth: depth,
    });

    return {
        post,
        comments: commentState.items,
        totalComments: asInteger(postData?.num_comments),
        moreComments: commentState.moreComments,
    };
}

function parseListingPayload(payload: unknown): {
    posts: RedditPostRecord[];
    after: string | null;
    before: string | null;
    dist: number | null;
} {
    const listing = Array.isArray(payload)
        ? payload.find((entry) => looksLikeListing(entry)) || payload[0]
        : payload;
    if (!looksLikeListing(listing)) {
        throw new RedditServiceError(
            'Reddit JSON payload did not contain a listing response.',
            'REDDIT_UNEXPECTED_RESPONSE',
            502
        );
    }

    const children = listChildren(listing);
    const posts = children
        .filter((entry) => asString(entry.kind)?.toLowerCase() === 't3')
        .map((entry) => asRecord(entry.data))
        .filter((entry): entry is Record<string, unknown> => Boolean(entry))
        .map((entry) => mapPostRecord(entry));

    const data = asRecord(asRecord(listing)?.data);
    return {
        posts,
        after: asString(data?.after),
        before: asString(data?.before),
        dist: asInteger(data?.dist),
    };
}

async function fetchRedditJson(url: string, timeoutMs: number): Promise<unknown> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                accept: 'application/json',
                'user-agent': REDDIT_USER_AGENT,
            },
            signal: controller.signal,
        });

        const rawBody = await response.text();
        if (response.status === 429) {
            throw new RedditServiceError(
                'Reddit rate-limited this request. Retry with lower frequency or a trusted network identity.',
                'REDDIT_RATE_LIMITED',
                429
            );
        }

        if (response.status === 401 || response.status === 403) {
            throw new RedditServiceError(
                'Reddit rejected this request. The target may require auth or is blocked for this client.',
                'REDDIT_FORBIDDEN',
                403
            );
        }

        if (!response.ok) {
            const snippet = rawBody.replace(/\s+/g, ' ').trim().slice(0, 180);
            throw new RedditServiceError(
                `Reddit request failed with HTTP ${response.status}${snippet ? `: ${snippet}` : ''}.`,
                'REDDIT_REQUEST_FAILED',
                502
            );
        }

        const contentType = response.headers.get('content-type') || '';
        if (!/application\/json/i.test(contentType) && !rawBody.trim().startsWith('{') && !rawBody.trim().startsWith('[')) {
            throw new RedditServiceError(
                'Reddit responded without JSON. The endpoint may be challenged or temporarily unavailable.',
                'REDDIT_NON_JSON_RESPONSE',
                502
            );
        }

        try {
            return JSON.parse(rawBody) as unknown;
        } catch {
            throw new RedditServiceError(
                'Reddit returned malformed JSON.',
                'REDDIT_INVALID_JSON',
                502
            );
        }
    } catch (error) {
        if (error instanceof RedditServiceError) {
            throw error;
        }

        if (error instanceof DOMException && error.name === 'AbortError') {
            throw new RedditServiceError(
                `Reddit request timed out after ${timeoutMs}ms.`,
                'REDDIT_TIMEOUT',
                504
            );
        }

        throw new RedditServiceError(
            error instanceof Error ? error.message : 'Reddit inspect failed',
            'REDDIT_INSPECT_FAILED',
            500
        );
    } finally {
        clearTimeout(timeoutHandle);
    }
}

export class RedditServiceError extends Error {
    public readonly code: string;
    public readonly statusCode: number;

    constructor(message: string, code: string, statusCode = 500) {
        super(message);
        this.name = 'RedditServiceError';
        this.code = code;
        this.statusCode = statusCode;
    }
}

class RedditService {
    public isConfigured(): boolean {
        return true;
    }

    public getStatus() {
        return {
            status: 'online',
            service: 'reddit-json-inspector-v1',
            notes: [
                'Uses Reddit public JSON endpoints by appending .json to thread/listing URLs.',
                'No external API key is required, but Reddit can still rate-limit high-frequency traffic.',
            ],
        };
    }

    public async inspect(input: RedditInspectInput): Promise<RedditInspectResult> {
        const limit = normalizeLimit(input.limit);
        const depth = normalizeDepth(input.depth);
        const timeout = normalizeTimeout(input.timeout);
        const target = normalizeRedditTarget(input, limit, depth);
        const payload = await fetchRedditJson(target.jsonUrl, timeout);

        const warnings: string[] = [];
        let thread: RedditInspectResult['thread'] = null;
        let listing: RedditInspectResult['listing'] = null;

        if (target.mode === 'thread') {
            if (!Array.isArray(payload) || payload.length < 2 || !looksLikeListing(payload[0])) {
                throw new RedditServiceError(
                    'Reddit thread response did not match the expected [post, comments] JSON structure.',
                    'REDDIT_UNEXPECTED_RESPONSE',
                    502
                );
            }

            const parsedThread = parseThreadPayload(payload, limit, depth);
            if (!parsedThread.post) {
                warnings.push('Thread payload did not include a primary post node (t3).');
            }
            if (parsedThread.comments.length === 0) {
                warnings.push('No comments were extracted from the thread payload.');
            }

            thread = parsedThread;
        } else {
            const parsedListing = parseListingPayload(payload);
            if (parsedListing.posts.length === 0) {
                warnings.push('No posts were extracted from the listing payload.');
            }
            listing = parsedListing;
        }

        const result: RedditInspectResult = {
            input: input.input,
            target,
            thread,
            listing,
            diagnostics: buildDiagnostics({
                blocked: false,
                warnings,
                crawledUrls: [target.jsonUrl],
                antiBotSignals: [],
            }),
        };

        if (input.includeRaw) {
            result.raw = payload;
        }

        return result;
    }
}

export const redditService = new RedditService();
