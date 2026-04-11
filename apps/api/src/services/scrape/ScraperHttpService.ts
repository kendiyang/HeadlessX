import axios, { type AxiosResponse } from 'axios';
import { prisma } from '../../database/client';
import { configService } from '../config/ConfigService';
import {
    createProxyAgentBundle,
    normalizeConfiguredProxyUrl,
} from '../proxy/ProxyConnection';
import { markdownService } from './MarkdownService';
import type { ScrapeOptions, ScrapeResult } from './ScraperService';
import { extractWebsiteMetadata } from './WebsiteLinkUtils';

export interface ScraperHttpOptions extends ScrapeOptions {
    maxRedirects?: number;
    headers?: Record<string, string>;
    sessionKey?: string;
    userAgentJitter?: boolean;
    minDelayMs?: number;
    maxDelayMs?: number;
    forceWwwAmazonHost?: boolean;
}

export interface ScraperHttpDebugInfo {
    requestedUrl: string;
    finalUrl: string;
    statusCode: number;
    delayMs: number;
    userAgent: string;
    userAgentChromeMajor: number | null;
    cookieSentCount: number;
    setCookieCount: number;
    redirectCount: number;
    sessionKey: string | null;
    forceWwwAmazonHost: boolean;
}

const DEFAULT_HTTP_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_HTTP_USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const BASE_HEADERS: Record<string, string> = {
    'User-Agent': DEFAULT_HTTP_USER_AGENT,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    Connection: 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Cache-Control': 'max-age=0',
};

interface HttpCookieEntry {
    name: string;
    value: string;
    domain: string;
    path: string;
    secure: boolean;
    hostOnly: boolean;
    expiresAt: number | null;
}

interface RedirectFetchResult {
    response: AxiosResponse<string>;
    finalUrl: string;
    finalRequestHeaders: Record<string, string>;
    finalCookieHeader: string | null;
    redirectCount: number;
    finalSetCookieCount: number;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_SESSION_COOKIES = 256;

class ScraperHttpService {
    private static instance: ScraperHttpService;
    private readonly cookieJarBySession = new Map<string, Map<string, HttpCookieEntry>>();

    private constructor() {}

    public static getInstance(): ScraperHttpService {
        if (!ScraperHttpService.instance) {
            ScraperHttpService.instance = new ScraperHttpService();
        }

        return ScraperHttpService.instance;
    }

    private normalizeTargetUrl(inputUrl: string, forceWwwAmazonHost = false): string {
        let parsed: URL;

        try {
            parsed = new URL(inputUrl);
        } catch {
            throw new Error(`Invalid URL: ${inputUrl}`);
        }

        if (!['http:', 'https:'].includes(parsed.protocol)) {
            throw new Error(`Unsupported URL protocol: ${parsed.protocol}`);
        }

        if (forceWwwAmazonHost) {
            parsed = this.forceAmazonWwwHost(parsed);
        }

        return parsed.toString();
    }

    private isAmazonHostname(hostname: string): boolean {
        const normalized = hostname.trim().toLowerCase();
        return normalized === 'amazon.com' || normalized.endsWith('.amazon.com');
    }

    private forceAmazonWwwHost(url: URL): URL {
        const normalizedHost = url.hostname.toLowerCase();
        if (!this.isAmazonHostname(normalizedHost)) {
            return url;
        }

        if (!normalizedHost.startsWith('www.')) {
            url.hostname = `www.${normalizedHost}`;
        }

        return url;
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    private randomInt(min: number, max: number): number {
        if (max <= min) {
            return min;
        }
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    private buildJitteredUserAgent(baseUserAgent: string): string {
        const chromeMatch = baseUserAgent.match(/Chrome\/(\d+)\.(\d+)\.(\d+)\.(\d+)/i);
        if (!chromeMatch) {
            return baseUserAgent;
        }

        const major = this.randomInt(100, 199);
        return baseUserAgent.replace(
            /Chrome\/\d+\.\d+\.\d+\.\d+/i,
            `Chrome/${major}.${chromeMatch[2]}.${chromeMatch[3]}.${chromeMatch[4]}`
        );
    }

    private normalizeDelayBounds(options: ScraperHttpOptions): { min: number; max: number } {
        const min = Math.max(0, Math.floor(options.minDelayMs ?? 0));
        const max = Math.max(min, Math.floor(options.maxDelayMs ?? min));
        return { min, max };
    }

    private maybeGetSessionStore(sessionKey?: string): Map<string, HttpCookieEntry> | null {
        const normalized = (sessionKey || '').trim();
        if (!normalized) {
            return null;
        }

        let store = this.cookieJarBySession.get(normalized);
        if (!store) {
            store = new Map<string, HttpCookieEntry>();
            this.cookieJarBySession.set(normalized, store);
        }

        return store;
    }

    private cleanupExpiredCookies(store: Map<string, HttpCookieEntry>): void {
        const now = Date.now();
        for (const [key, cookie] of store.entries()) {
            if (cookie.expiresAt !== null && cookie.expiresAt <= now) {
                store.delete(key);
            }
        }
    }

    private cookieKey(cookie: HttpCookieEntry): string {
        return `${cookie.name}|${cookie.domain}|${cookie.path}`;
    }

    private parseSetCookie(raw: string, responseUrl: string): HttpCookieEntry | null {
        const normalized = raw.trim();
        if (!normalized) {
            return null;
        }

        const response = new URL(responseUrl);
        const parts = normalized.split(';').map((part) => part.trim()).filter(Boolean);
        if (parts.length === 0) {
            return null;
        }

        const separatorIndex = parts[0].indexOf('=');
        if (separatorIndex <= 0) {
            return null;
        }

        const cookie: HttpCookieEntry = {
            name: parts[0].slice(0, separatorIndex).trim(),
            value: parts[0].slice(separatorIndex + 1),
            domain: response.hostname.toLowerCase(),
            path: '/',
            secure: false,
            hostOnly: true,
            expiresAt: null,
        };

        if (!cookie.name) {
            return null;
        }

        for (let index = 1; index < parts.length; index += 1) {
            const attr = parts[index];
            const attrSeparator = attr.indexOf('=');
            const attrName = (attrSeparator === -1 ? attr : attr.slice(0, attrSeparator)).trim().toLowerCase();
            const attrValue = (attrSeparator === -1 ? '' : attr.slice(attrSeparator + 1)).trim();

            if (attrName === 'domain' && attrValue) {
                cookie.domain = attrValue.toLowerCase().replace(/^\./, '');
                cookie.hostOnly = false;
                continue;
            }

            if (attrName === 'path' && attrValue) {
                cookie.path = attrValue.startsWith('/') ? attrValue : `/${attrValue}`;
                continue;
            }

            if (attrName === 'max-age' && attrValue) {
                const seconds = Number.parseInt(attrValue, 10);
                if (Number.isFinite(seconds)) {
                    cookie.expiresAt = Date.now() + seconds * 1000;
                }
                continue;
            }

            if (attrName === 'expires' && attrValue) {
                const timestamp = Date.parse(attrValue);
                if (Number.isFinite(timestamp)) {
                    cookie.expiresAt = timestamp;
                }
                continue;
            }

            if (attrName === 'secure') {
                cookie.secure = true;
            }
        }

        return cookie;
    }

    private isCookieDomainMatch(cookie: HttpCookieEntry, requestHost: string): boolean {
        if (cookie.hostOnly) {
            return requestHost === cookie.domain;
        }

        return requestHost === cookie.domain || requestHost.endsWith(`.${cookie.domain}`);
    }

    private isCookiePathMatch(cookie: HttpCookieEntry, requestPath: string): boolean {
        if (cookie.path === '/') {
            return true;
        }

        return requestPath.startsWith(cookie.path);
    }

    private readCookieHeader(sessionKey: string | undefined, requestUrl: string): string | null {
        const store = this.maybeGetSessionStore(sessionKey);
        if (!store) {
            return null;
        }

        this.cleanupExpiredCookies(store);
        const request = new URL(requestUrl);
        const requestHost = request.hostname.toLowerCase();
        const requestPath = request.pathname || '/';
        const isHttps = request.protocol === 'https:';
        const cookies: string[] = [];

        for (const cookie of store.values()) {
            if (cookie.secure && !isHttps) {
                continue;
            }
            if (!this.isCookieDomainMatch(cookie, requestHost)) {
                continue;
            }
            if (!this.isCookiePathMatch(cookie, requestPath)) {
                continue;
            }
            cookies.push(`${cookie.name}=${cookie.value}`);
        }

        return cookies.length > 0 ? cookies.join('; ') : null;
    }

    private writeResponseCookies(
        sessionKey: string | undefined,
        responseUrl: string,
        headers: AxiosResponse<string>['headers']
    ): void {
        const store = this.maybeGetSessionStore(sessionKey);
        if (!store) {
            return;
        }

        const setCookieHeader = headers['set-cookie'];
        const setCookies = Array.isArray(setCookieHeader)
            ? setCookieHeader
            : typeof setCookieHeader === 'string'
                ? [setCookieHeader]
                : [];

        if (setCookies.length === 0) {
            return;
        }

        for (const rawCookie of setCookies) {
            const parsed = this.parseSetCookie(rawCookie, responseUrl);
            if (!parsed) {
                continue;
            }

            const key = this.cookieKey(parsed);
            if (parsed.expiresAt !== null && parsed.expiresAt <= Date.now()) {
                store.delete(key);
            } else {
                store.set(key, parsed);
            }
        }

        if (store.size > MAX_SESSION_COOKIES) {
            const keys = Array.from(store.keys());
            const overflowCount = store.size - MAX_SESSION_COOKIES;
            for (let i = 0; i < overflowCount; i += 1) {
                store.delete(keys[i]);
            }
        }
    }

    private buildHeaders(
        _targetUrl: string,
        options: ScraperHttpOptions,
        cookieHeader: string | null
    ): Record<string, string> {
        const customHeaders = options.headers || {};
        const userAgentFromCustom = customHeaders['User-Agent'] || customHeaders['user-agent'];
        const baseUserAgent = userAgentFromCustom || BASE_HEADERS['User-Agent'];
        const userAgent = options.userAgentJitter ? this.buildJitteredUserAgent(baseUserAgent) : baseUserAgent;

        return {
            ...BASE_HEADERS,
            'User-Agent': userAgent,
            ...(cookieHeader ? { Cookie: cookieHeader } : {}),
            ...customHeaders,
            ...(customHeaders['User-Agent'] || customHeaders['user-agent'] ? {} : { 'User-Agent': userAgent }),
        };
    }

    private resolveRedirectUrl(
        currentUrl: string,
        response: AxiosResponse<string>,
        forceWwwAmazonHost = false
    ): string | null {
        if (!REDIRECT_STATUSES.has(response.status)) {
            return null;
        }

        const locationHeader = response.headers.location;
        if (!locationHeader || typeof locationHeader !== 'string') {
            return null;
        }

        try {
            const next = new URL(locationHeader, currentUrl);
            return this.normalizeTargetUrl(next.toString(), forceWwwAmazonHost);
        } catch {
            return null;
        }
    }

    private countCookiePairs(cookieHeader: string | null): number {
        if (!cookieHeader) {
            return 0;
        }

        return cookieHeader
            .split(';')
            .map((part) => part.trim())
            .filter(Boolean).length;
    }

    private extractChromeMajor(userAgent: string): number | null {
        const match = userAgent.match(/Chrome\/(\d+)\./i);
        if (!match?.[1]) {
            return null;
        }

        const major = Number.parseInt(match[1], 10);
        return Number.isFinite(major) ? major : null;
    }

    private async fetchWithRedirects(input: {
        url: string;
        timeoutMs: number;
        maxRedirects: number;
        options: ScraperHttpOptions;
        httpAgent: unknown;
        httpsAgent: unknown;
    }): Promise<RedirectFetchResult> {
        let currentUrl = input.url;
        let lastResponse: AxiosResponse<string> | null = null;
        let lastRequestHeaders: Record<string, string> = {};
        let lastCookieHeader: string | null = null;
        let lastSetCookieCount = 0;
        let redirectsFollowed = 0;

        for (let redirectCount = 0; redirectCount <= input.maxRedirects; redirectCount += 1) {
            const cookieHeader = this.readCookieHeader(input.options.sessionKey, currentUrl);
            const requestHeaders = this.buildHeaders(currentUrl, input.options, cookieHeader);

            const response = await axios.get<string>(currentUrl, {
                responseType: 'text',
                timeout: input.timeoutMs,
                maxRedirects: 0,
                httpAgent: input.httpAgent as any,
                httpsAgent: input.httpsAgent as any,
                decompress: true,
                validateStatus: () => true,
                headers: requestHeaders,
            });

            this.writeResponseCookies(input.options.sessionKey, currentUrl, response.headers);
            lastResponse = response;
            lastRequestHeaders = requestHeaders;
            lastCookieHeader = cookieHeader;
            const setCookieHeader = response.headers['set-cookie'];
            lastSetCookieCount = Array.isArray(setCookieHeader)
                ? setCookieHeader.length
                : typeof setCookieHeader === 'string'
                    ? 1
                    : 0;

            const redirectUrl = this.resolveRedirectUrl(
                currentUrl,
                response,
                input.options.forceWwwAmazonHost
            );

            if (!redirectUrl) {
                return {
                    response,
                    finalUrl: currentUrl,
                    finalRequestHeaders: lastRequestHeaders,
                    finalCookieHeader: lastCookieHeader,
                    redirectCount: redirectsFollowed,
                    finalSetCookieCount: lastSetCookieCount,
                };
            }

            if (redirectCount === input.maxRedirects) {
                return {
                    response,
                    finalUrl: currentUrl,
                    finalRequestHeaders: lastRequestHeaders,
                    finalCookieHeader: lastCookieHeader,
                    redirectCount: redirectsFollowed,
                    finalSetCookieCount: lastSetCookieCount,
                };
            }

            currentUrl = redirectUrl;
            redirectsFollowed += 1;
        }

        if (!lastResponse) {
            throw new Error('HTTP fetch failed before receiving a response');
        }

        return {
            response: lastResponse,
            finalUrl: currentUrl,
            finalRequestHeaders: lastRequestHeaders,
            finalCookieHeader: lastCookieHeader,
            redirectCount: redirectsFollowed,
            finalSetCookieCount: lastSetCookieCount,
        };
    }

    private resolveFinalUrl(response: AxiosResponse<string>, fallbackUrl: string): string {
        const redirectedUrl = (response.request as { res?: { responseUrl?: string } } | undefined)
            ?.res
            ?.responseUrl;

        if (redirectedUrl && typeof redirectedUrl === 'string') {
            return redirectedUrl;
        }

        return fallbackUrl;
    }

    private fallbackTitle(html: string): string {
        const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        return (match?.[1] || '').replace(/\s+/g, ' ').trim();
    }

    public async scrape(url: string, options: ScraperHttpOptions = {}): Promise<ScrapeResult> {
        const startTime = Date.now();
        let statusCode = 0;
        let errorMessage: string | undefined;

        try {
            const targetUrl = this.normalizeTargetUrl(url, options.forceWwwAmazonHost);
            const config = await configService.getConfig();

            const requestTimeout = options.timeout ?? config.browserTimeout ?? DEFAULT_HTTP_TIMEOUT_MS;
            const maxRedirects = Math.max(0, options.maxRedirects ?? DEFAULT_MAX_REDIRECTS);
            const delayBounds = this.normalizeDelayBounds(options);
            let appliedDelayMs = 0;
            const proxyUrl = config.proxyEnabled
                ? normalizeConfiguredProxyUrl(config.proxyUrl, config.proxyProtocol)
                : undefined;
            const agents = createProxyAgentBundle(proxyUrl);

            if (delayBounds.max > 0) {
                appliedDelayMs = this.randomInt(delayBounds.min, delayBounds.max);
                if (appliedDelayMs > 0) {
                    await this.sleep(appliedDelayMs);
                }
            }

            const {
                response,
                finalUrl,
                finalRequestHeaders,
                finalCookieHeader,
                redirectCount,
                finalSetCookieCount,
            } = await this.fetchWithRedirects({
                url: targetUrl,
                timeoutMs: requestTimeout,
                maxRedirects,
                options,
                httpAgent: agents.httpAgent,
                httpsAgent: agents.httpsAgent,
            });

            console.log("===================:",targetUrl)
            console.log("********************:",response.data.toString())

            statusCode = response.status;

            const responseReportedFinalUrl = this.resolveFinalUrl(response, targetUrl);
            const resolvedFinalUrl = finalUrl || responseReportedFinalUrl || targetUrl;
            const html = typeof response.data === 'string' ? response.data : String(response.data || '');
            const metadata = extractWebsiteMetadata(html, resolvedFinalUrl) as Record<string, any>;
            const title = metadata.title || this.fallbackTitle(html);
            const userAgent =
                finalRequestHeaders['User-Agent'] ||
                finalRequestHeaders['user-agent'] ||
                BASE_HEADERS['User-Agent'];
            const httpDebug: ScraperHttpDebugInfo = {
                requestedUrl: targetUrl,
                finalUrl: resolvedFinalUrl,
                statusCode: statusCode || 200,
                delayMs: appliedDelayMs,
                userAgent,
                userAgentChromeMajor: this.extractChromeMajor(userAgent),
                cookieSentCount: this.countCookiePairs(finalCookieHeader),
                setCookieCount: finalSetCookieCount,
                redirectCount,
                sessionKey: options.sessionKey?.trim() || null,
                forceWwwAmazonHost: options.forceWwwAmazonHost === true,
            };

            metadata.httpDebug = httpDebug;

            return {
                requestedUrl: url,
                url: resolvedFinalUrl,
                html,
                title,
                statusCode: statusCode || 200,
                metadata,
            };
        } catch (error) {
            errorMessage = error instanceof Error ? error.message : String(error);
            throw error;
        } finally {
            const duration = Date.now() - startTime;

            prisma.requestLog.create({
                data: {
                    api_key_id: options.apiKeyId,
                    url,
                    method: 'GET',
                    status_code: statusCode || (errorMessage ? 500 : 200),
                    duration_ms: duration,
                    error_message: errorMessage,
                },
            }).catch((logError) => {
                console.error('Failed to log HTTP scrape request:', logError);
            });
        }
    }

    public async scrapeContent(url: string, options: ScraperHttpOptions = {}): Promise<ScrapeResult> {
        const result = await this.scrape(url, options);
        result.markdown = await markdownService.convert(result.html);
        return result;
    }
}

export const scraperHttpService = ScraperHttpService.getInstance();
