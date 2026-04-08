import { JSDOM } from 'jsdom';
import {
    antiBotDetectionService,
    type AntiBotDetectionResult,
    type AntiBotProvider,
} from '../scrape/AntiBotDetectionService';

export interface CommerceInspectInput {
    input: string;
    timeout?: number;
    stealth?: boolean;
    waitForSelector?: string;
}

export interface CommerceDiagnostics {
    blocked: boolean;
    warnings: string[];
    crawledUrls: string[];
    antiBotSignals: string[];
    generatedAt: string;
}

interface ResolveMarketplaceUrlOptions {
    defaultHost: string;
    hostPattern: RegExp;
    idPathBuilder?: (value: string) => string | null;
}

export interface CommerceScrapePayload {
    url: string;
    html: string;
    detection: AntiBotDetectionResult;
}

export function cleanText(value: string | null | undefined): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const normalized = value.replace(/\s+/g, ' ').trim();
    return normalized.length > 0 ? normalized : null;
}

export function dedupeStrings(values: Array<string | null | undefined>): string[] {
    const unique = new Set<string>();

    for (const value of values) {
        const normalized = cleanText(value);
        if (normalized) {
            unique.add(normalized);
        }
    }

    return Array.from(unique);
}

export function parseNumericPrice(value: string | null | undefined): number | null {
    const normalized = cleanText(value);
    if (!normalized) {
        return null;
    }

    const compact = normalized
        .replace(/\s+/g, '')
        .replace(/[^\d.,-]/g, '');
    if (!compact) {
        return null;
    }

    const sign = compact.startsWith('-') ? '-' : '';
    const numeric = compact.replace(/-/g, '');
    const lastComma = numeric.lastIndexOf(',');
    const lastDot = numeric.lastIndexOf('.');

    let canonical = numeric;

    if (lastComma !== -1 && lastDot !== -1) {
        const commaIsDecimal = lastComma > lastDot;
        canonical = commaIsDecimal
            ? numeric.replace(/\./g, '').replace(/,/g, '.')
            : numeric.replace(/,/g, '');
    } else if (lastComma !== -1) {
        const fractional = numeric.length - lastComma - 1;
        canonical = fractional > 0 && fractional <= 2
            ? numeric.replace(/,/g, '.')
            : numeric.replace(/,/g, '');
    } else if (lastDot !== -1) {
        const fractional = numeric.length - lastDot - 1;
        const hasMultipleDots = (numeric.match(/\./g) || []).length > 1;
        canonical = hasMultipleDots && fractional === 3
            ? numeric.replace(/\./g, '')
            : numeric;
    }

    const parsed = Number.parseFloat(`${sign}${canonical}`);

    return Number.isFinite(parsed) ? parsed : null;
}

export function parseCurrency(value: string | null | undefined): string | null {
    const normalized = cleanText(value);
    if (!normalized) {
        return null;
    }

    const uppercaseCode = normalized.match(/\b[A-Z]{3}\b/)?.[0];
    if (uppercaseCode) {
        return uppercaseCode;
    }

    const lower = normalized.toLowerCase();
    if (/(?:\bcad\b|ca\$)/i.test(lower)) {
        return 'CAD';
    }
    if (/(?:\baud\b|a\$)/i.test(lower)) {
        return 'AUD';
    }
    if (/(?:\bsgd\b|s\$)/i.test(lower)) {
        return 'SGD';
    }
    if (/(?:\bnzd\b|nz\$)/i.test(lower)) {
        return 'NZD';
    }
    if (/(?:\bmxn\b|mx\$)/i.test(lower)) {
        return 'MXN';
    }
    if (/(?:\bbrl\b|r\$)/i.test(lower)) {
        return 'BRL';
    }
    if (/(?:\binr\b|₹|rs\.?)/i.test(lower)) {
        return 'INR';
    }
    if (normalized.includes('£')) {
        return 'GBP';
    }
    if (normalized.includes('€')) {
        return 'EUR';
    }
    if (normalized.includes('¥')) {
        return 'JPY';
    }

    return null;
}

export function selectText(document: Document, selectors: readonly string[]): string | null {
    for (const selector of selectors) {
        try {
            const node = document.querySelector(selector);
            const value = cleanText(node?.textContent);
            if (value) {
                return value;
            }
        } catch {
            // Ignore invalid selector.
        }
    }

    return null;
}

export function selectAttribute(
    document: Document,
    selectors: readonly string[],
    attribute: string
): string | null {
    for (const selector of selectors) {
        try {
            const node = document.querySelector(selector);
            const value = cleanText(node?.getAttribute(attribute));
            if (value) {
                return value;
            }
        } catch {
            // Ignore invalid selector.
        }
    }

    return null;
}

export function resolveMarketplaceInputUrl(
    input: string,
    options: ResolveMarketplaceUrlOptions
): string | null {
    const trimmed = input.trim();
    if (!trimmed) {
        return null;
    }

    const sanitize = (rawHost: string): string => rawHost.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
    const host = sanitize(options.defaultHost);

    const normalizeUrl = (raw: string): URL | null => {
        try {
            return new URL(raw);
        } catch {
            return null;
        }
    };

    const fromHttp = normalizeUrl(trimmed);
    if (fromHttp && options.hostPattern.test(fromHttp.hostname)) {
        return fromHttp.toString();
    }

    if (trimmed.startsWith('/')) {
        return `https://${host}${trimmed}`;
    }

    const prefixed = normalizeUrl(`https://${trimmed}`);
    if (prefixed && options.hostPattern.test(prefixed.hostname)) {
        return prefixed.toString();
    }

    if (options.idPathBuilder) {
        const path = options.idPathBuilder(trimmed);
        if (path) {
            return `https://${host}${path}`;
        }
    }

    return null;
}

export async function scrapeCommercePage(
    provider: AntiBotProvider,
    targetUrl: string,
    options: Pick<CommerceInspectInput, 'timeout' | 'stealth' | 'waitForSelector'>
): Promise<CommerceScrapePayload> {
    const { scraperService } = await import('../scrape/ScraperService');
    const scrapeResult = await scraperService.scrape(targetUrl, {
        jsEnabled: true,
        timeout: options.timeout,
        stealth: options.stealth,
        waitForSelector: options.waitForSelector,
        screenshotOnError: false,
    });

    return {
        url: scrapeResult.url,
        html: scrapeResult.html,
        detection: antiBotDetectionService.detect(provider, scrapeResult.url, scrapeResult.html),
    };
}

export function createDom(html: string, pageUrl: string): Document {
    return new JSDOM(html, { url: pageUrl }).window.document;
}

function flattenJsonLd(payload: unknown): unknown[] {
    if (!payload) {
        return [];
    }

    if (Array.isArray(payload)) {
        return payload.flatMap((item) => flattenJsonLd(item));
    }

    if (typeof payload === 'object') {
        const value = payload as Record<string, unknown>;
        const graph = value['@graph'];
        if (Array.isArray(graph)) {
            return [value, ...flattenJsonLd(graph)];
        }
        return [value];
    }

    return [];
}

export function readJsonLdObjects(document: Document): Record<string, unknown>[] {
    const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
    const output: Record<string, unknown>[] = [];

    for (const script of scripts) {
        const text = cleanText(script.textContent);
        if (!text) {
            continue;
        }

        try {
            const parsed = JSON.parse(text) as unknown;
            for (const item of flattenJsonLd(parsed)) {
                if (item && typeof item === 'object' && !Array.isArray(item)) {
                    output.push(item as Record<string, unknown>);
                }
            }
        } catch {
            // Ignore malformed schema blocks.
        }
    }

    return output;
}

export function findFirstBySchemaType(
    items: Record<string, unknown>[],
    schemaType: string
): Record<string, unknown> | null {
    const expected = schemaType.toLowerCase();

    for (const item of items) {
        const type = item['@type'];
        const list = Array.isArray(type) ? type : [type];
        const matched = list.some((entry) => {
            if (typeof entry !== 'string') {
                return false;
            }
            return entry.toLowerCase() === expected;
        });

        if (matched) {
            return item;
        }
    }

    return null;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    return null;
}

export function asString(value: unknown): string | null {
    if (typeof value === 'string') {
        return cleanText(value);
    }
    if (typeof value === 'number') {
        return cleanText(String(value));
    }
    return null;
}

export function buildDiagnostics(input: {
    blocked: boolean;
    warnings: Array<string | null | undefined>;
    crawledUrls: Array<string | null | undefined>;
    antiBotSignals: Array<string | null | undefined>;
}): CommerceDiagnostics {
    return {
        blocked: input.blocked,
        warnings: dedupeStrings(input.warnings),
        crawledUrls: dedupeStrings(input.crawledUrls),
        antiBotSignals: dedupeStrings(input.antiBotSignals),
        generatedAt: new Date().toISOString(),
    };
}
