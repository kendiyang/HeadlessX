import { JSDOM, VirtualConsole } from 'jsdom';
import { scraperHttpService } from '../scrape/ScraperHttpService';
import { antiBotDetectionService } from '../scrape/AntiBotDetectionService';

export type AmazonReviewSortBy = 'recent' | 'helpful';
export type AmazonReviewStar = 'all' | 'positive' | 'critical';

export interface AmazonInspectInput {
    input: string;
    marketplace?: string;
    includeReviews?: boolean;
    reviewPageLimit?: number;
    reviewSortBy?: AmazonReviewSortBy;
    reviewStar?: AmazonReviewStar;
    reviewerType?: string;
    reviewStopAtId?: string;
    timeout?: number;
    stealth?: boolean;
    waitForSelector?: string;
}

export interface AmazonPriceSnapshot {
    currentPriceText: string | null;
    currentPrice: number | null;
    currency: string | null;
    listPriceText: string | null;
    listPrice: number | null;
    dealPriceText: string | null;
    dealPrice: number | null;
    savingsText: string | null;
    savingsPercent: number | null;
    unitPriceText: string | null;
    couponText: string | null;
    offerSummaryText: string | null;
    offerListingUrl: string | null;
}

export interface AmazonReviewHistogramEntry {
    stars: number;
    percent: number | null;
    rawPercentText: string | null;
}

export interface AmazonReviewSummary {
    averageRatingText: string | null;
    averageRating: number | null;
    totalRatingsText: string | null;
    histogram: AmazonReviewHistogramEntry[];
}

export interface AmazonReviewItem {
    id: string | null;
    url: string | null;
    title: string | null;
    rating: number | null;
    author: string | null;
    date: string | null;
    country: string | null;
    verifiedPurchase: boolean;
    variation: string | null;
    helpfulVotes: number | null;
    text: string | null;
}

export interface AmazonProductSnapshot {
    asin: string | null;
    url: string;
    canonicalUrl: string | null;
    title: string | null;
    brand: string | null;
    ratingText: string | null;
    rating: number | null;
    ratingsCountText: string | null;
    ratingsCount: number | null;
    availability: string | null;
    merchantInfo: string | null;
    categoryPath: string[];
    featureBullets: string[];
    description: string | null;
    imageUrls: string[];
    detailBullets: Record<string, string>;
    badges: string[];
}

export interface AmazonMarketplaceSnapshot {
    sellerName: string | null;
    sellerId: string | null;
    sellerProfileUrl: string | null;
    shipsFrom: string | null;
    soldBy: string | null;
    fulfilledByAmazon: boolean | null;
    bestSellerRanks: Array<{
        rank: number;
        category: string;
    }>;
    marketplaceId: string | null;
}

export interface AmazonInspectResult {
    input: string;
    title: string | null;
    url: string;
    asin: string | null;
    brand: string | null;
    price: {
        value: number | null;
        currency: string | null;
    };
    reviewsCount: number | null;
    features: string[];
    seller: {
        name: string | null;
        id: string | null;
        url: string | null;
    };
    reviews: AmazonReviewItem[];
}

const JSDOM_SILENT_VIRTUAL_CONSOLE = new VirtualConsole();

interface ProductPageParseResult {
    product: AmazonProductSnapshot;
    pricing: AmazonPriceSnapshot;
    marketplaceData: AmazonMarketplaceSnapshot;
    reviewsSummary: AmazonReviewSummary;
    reviewListingUrl: string | null;
}

interface ReviewPageParseResult {
    summary: AmazonReviewSummary;
    reviews: AmazonReviewItem[];
    nextPageUrl: string | null;
    seeAllReviewsUrl: string | null;
}

const DEFAULT_AMAZON_HOST = 'www.amazon.com';
const DEFAULT_REVIEW_STAR: AmazonReviewStar = 'all';
const DEFAULT_REVIEW_SORT: AmazonReviewSortBy = 'recent';
const DEFAULT_REVIEW_PAGE_LIMIT = 1;
const MAX_REVIEW_PAGE_LIMIT = 5000;
const DEFAULT_SCRAPE_TIMEOUT_MS = 30_000;
const PRODUCT_BLOCK_RETRY_ATTEMPTS = 2;
const AMAZON_HTTP_DELAY_MIN_MS = 100;
const AMAZON_HTTP_DELAY_MAX_MS = 500;

const PRODUCT_TITLE_SELECTORS = [
    '#productTitle',
    '#title span',
    '[data-cy="title-recipe"]',
] as const;

const BRAND_SELECTORS = [
    '#bylineInfo',
    '#brand',
] as const;

const CURRENT_PRICE_SELECTORS = [
    '#corePriceDisplay_desktop_feature_div .a-price .a-offscreen',
    '#corePrice_feature_div .a-price .a-offscreen',
    '#priceblock_ourprice',
    '#priceblock_dealprice',
    '#priceblock_saleprice',
    '#tp_price_block_total_price_ww .a-offscreen',
] as const;

const LIST_PRICE_SELECTORS = [
    '#corePriceDisplay_desktop_feature_div .a-text-price .a-offscreen',
    '#corePriceDisplay_desktop_feature_div .basisPrice .a-offscreen',
    '#priceblock_listprice',
    '.priceBlockStrikePriceString',
] as const;

const DEAL_PRICE_SELECTORS = [
    '#corePriceDisplay_desktop_feature_div .savingPriceOverride .a-offscreen',
    '#priceblock_dealprice',
] as const;

const SAVINGS_SELECTORS = [
    '#corePriceDisplay_desktop_feature_div .savingsPercentage',
    '#dealBadge_feature_div',
    '#regularprice_savings',
] as const;

const UNIT_PRICE_SELECTORS = [
    '#corePriceDisplay_desktop_feature_div .pricePerUnit',
    '#corePriceDisplay_desktop_feature_div .a-size-mini.a-color-secondary',
] as const;

const COUPON_SELECTORS = [
    '#couponTextpctch',
    '#vpcButton .a-color-success',
    '#couponFeature [data-csa-c-content-id="coupon"]',
] as const;

const RATING_TEXT_SELECTORS = [
    '#acrPopover',
    '[data-hook="rating-out-of-text"]',
    '.a-icon-alt',
] as const;

const RATING_COUNT_SELECTORS = [
    '#acrCustomerReviewText',
    '[data-hook="total-review-count"]',
] as const;

const AVAILABILITY_SELECTORS = [
    '#availability span',
    '#availability',
    '#availabilityInsideBuyBox_feature_div',
] as const;

const MERCHANT_INFO_SELECTORS = [
    '#merchant-info',
    '#merchantInfoFeature_feature_div',
    '#exports_desktop_qualifiedBuybox_buybox_tabular_feature_div',
] as const;

const REVIEW_BLOCK_SELECTORS = [
    '[data-hook="review"]',
    'div[id^="customer_review-"]',
] as const;

const REVIEW_TITLE_SELECTORS = [
    '[data-hook="review-title"] span',
    '[data-hook="review-title"]',
] as const;

const REVIEW_TEXT_SELECTORS = [
    '[data-hook="review-body"] span',
    '[data-hook="review-body"]',
] as const;

const REVIEW_RATING_SELECTORS = [
    '[data-hook="review-star-rating"]',
    '[data-hook="cmps-review-star-rating"]',
] as const;

const REVIEW_AUTHOR_SELECTORS = [
    '.a-profile-name',
    '.review-byline a',
] as const;

const REVIEW_DATE_SELECTORS = [
    '[data-hook="review-date"]',
    '.review-date',
] as const;

const REVIEW_VARIATION_SELECTORS = [
    '[data-hook="format-strip"]',
    '.review-format-strip',
] as const;

const REVIEW_HELPFUL_SELECTORS = [
    '[data-hook="helpful-vote-statement"]',
    '.cr-vote-text',
] as const;

const REVIEW_SUMMARY_AVERAGE_SELECTORS = [
    '[data-hook="cr-average-stars-rating-text"]',
    '#cm_cr-review_list .a-icon-alt',
] as const;

const REVIEW_SUMMARY_TOTAL_SELECTORS = [
    '[data-hook="total-review-count"]',
    '#filter-info-section',
] as const;

const ABOUT_ITEM_BULLET_SELECTORS = [
    '#feature-bullets li span.a-list-item',
    '#featurebullets_feature_div li span.a-list-item',
    '#richProductInformation_feature_div li span.a-list-item',
    '#productFactsDesktopExpander li span.a-list-item',
    '#nic-po-expander-content li span.a-list-item',
    '#pqv-feature-bullets li span.a-list-item',
] as const;

const PRODUCT_DESCRIPTION_SELECTORS = [
    '#productDescription p',
    '#productDescription span',
    '#productDescription_feature_div p',
    '#productDescription_feature_div li span.a-list-item',
    '#pqv-description p',
    '#pqv-description li span.a-list-item',
    '#aplus p',
] as const;

const CURRENCY_SYMBOL_MAP: Record<string, string> = {
    '€': 'EUR',
    '£': 'GBP',
    '¥': 'JPY',
    '₹': 'INR',
};

const CURRENCY_CODE_SYMBOL_MAP: Record<string, string> = {
    USD: '$',
    CAD: '$',
    AUD: '$',
    SGD: '$',
    MXN: '$',
    BRL: 'R$',
    EUR: '€',
    GBP: '£',
    JPY: '¥',
    INR: '₹',
    SEK: 'kr',
    PLN: 'zl',
    TRY: 'TRY',
    AED: 'AED',
    SAR: 'SAR',
    EGP: 'EGP',
};

const AMAZON_MARKETPLACE_SUFFIXES = [
    'com',
    'ca',
    'co.uk',
    'de',
    'fr',
    'it',
    'es',
    'nl',
    'se',
    'pl',
    'be',
    'co.jp',
    'com.au',
    'com.mx',
    'com.br',
    'com.tr',
    'sg',
    'in',
    'ae',
    'sa',
    'eg',
] as const;

const AMAZON_LOCALE_SUFFIX_MAP: Record<string, (typeof AMAZON_MARKETPLACE_SUFFIXES)[number]> = {
    us: 'com',
    com: 'com',
    ca: 'ca',
    uk: 'co.uk',
    gb: 'co.uk',
    de: 'de',
    fr: 'fr',
    it: 'it',
    es: 'es',
    nl: 'nl',
    se: 'se',
    pl: 'pl',
    be: 'be',
    jp: 'co.jp',
    mx: 'com.mx',
    au: 'com.au',
    br: 'com.br',
    tr: 'com.tr',
    sg: 'sg',
    in: 'in',
    ae: 'ae',
    sa: 'sa',
    eg: 'eg',
};

const AMAZON_SUFFIX_CURRENCY_MAP: Partial<Record<(typeof AMAZON_MARKETPLACE_SUFFIXES)[number], string>> = {
    com: 'USD',
    ca: 'CAD',
    'co.uk': 'GBP',
    de: 'EUR',
    fr: 'EUR',
    it: 'EUR',
    es: 'EUR',
    nl: 'EUR',
    se: 'SEK',
    pl: 'PLN',
    be: 'EUR',
    'co.jp': 'JPY',
    'com.au': 'AUD',
    'com.mx': 'MXN',
    'com.br': 'BRL',
    'com.tr': 'TRY',
    sg: 'SGD',
    in: 'INR',
    ae: 'AED',
    sa: 'SAR',
    eg: 'EGP',
};

function cleanText(value: string | null | undefined): string {
    return (value || '').replace(/\s+/g, ' ').trim();
}

function nullableText(value: string | null | undefined): string | null {
    const normalized = cleanText(value);
    return normalized || null;
}

function parseInteger(value: string | null | undefined): number | null {
    const digits = (value || '').replace(/[^0-9]/g, '');
    if (!digits) {
        return null;
    }

    const parsed = Number.parseInt(digits, 10);
    return Number.isFinite(parsed) ? parsed : null;
}

function parseNumber(value: string | null | undefined): number | null {
    const raw = (value || '')
        .replace(/\s+/g, '')
        .replace(/[^0-9,.-]/g, '');
    if (!raw) {
        return null;
    }

    const sign = raw.startsWith('-') ? '-' : '';
    const numeric = raw.replace(/-/g, '');
    const lastComma = numeric.lastIndexOf(',');
    const lastDot = numeric.lastIndexOf('.');

    let normalized = numeric;
    if (lastComma !== -1 && lastDot !== -1) {
        const commaIsDecimal = lastComma > lastDot;
        normalized = commaIsDecimal
            ? numeric.replace(/\./g, '').replace(/,/g, '.')
            : numeric.replace(/,/g, '');
    } else if (lastComma !== -1) {
        const fractional = numeric.length - lastComma - 1;
        normalized = fractional > 0 && fractional <= 2
            ? numeric.replace(/,/g, '.')
            : numeric.replace(/,/g, '');
    } else if (lastDot !== -1) {
        const fractional = numeric.length - lastDot - 1;
        const hasMultipleDots = (numeric.match(/\./g) || []).length > 1;
        normalized = hasMultipleDots && fractional === 3
            ? numeric.replace(/\./g, '')
            : numeric;
    }

    const parsed = Number.parseFloat(`${sign}${normalized}`);
    return Number.isFinite(parsed) ? parsed : null;
}

function parsePercent(value: string | null | undefined): number | null {
    const normalized = cleanText(value);
    if (!normalized) {
        return null;
    }

    const match = normalized.match(/([0-9]+(?:\.[0-9]+)?)\s*%/);
    if (!match) {
        return null;
    }

    const parsed = Number.parseFloat(match[1]);
    return Number.isFinite(parsed) ? parsed : null;
}

function parseRating(value: string | null | undefined): number | null {
    const normalized = cleanText(value);
    if (!normalized) {
        return null;
    }

    const match = normalized.match(/([0-9]+(?:\.[0-9]+)?)/);
    if (!match) {
        return null;
    }

    const parsed = Number.parseFloat(match[1]);
    return Number.isFinite(parsed) ? parsed : null;
}

function detectCurrency(value: string | null | undefined): string | null {
    const normalized = cleanText(value);
    if (!normalized) {
        return null;
    }

    const explicitCode = normalized.match(/\b(USD|EUR|GBP|JPY|INR|CAD|AUD|SGD)\b/i);
    if (explicitCode) {
        return explicitCode[1].toUpperCase();
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
    if (/(?:\bmxn\b|mx\$)/i.test(lower)) {
        return 'MXN';
    }
    if (/(?:\bbrl\b|r\$)/i.test(lower)) {
        return 'BRL';
    }

    for (const [symbol, code] of Object.entries(CURRENCY_SYMBOL_MAP)) {
        if (normalized.includes(symbol)) {
            return code;
        }
    }

    return null;
}

function detectCurrencySymbol(value: string | null | undefined): string | null {
    const normalized = cleanText(value);
    if (!normalized) {
        return null;
    }

    const qualifiedDollar = normalized.match(/(CA\$|A\$|S\$|MX\$|R\$)/i);
    if (qualifiedDollar?.[1]) {
        return qualifiedDollar[1].toUpperCase();
    }

    const symbol = normalized.match(/[$€£¥₹]/);
    if (symbol?.[0]) {
        return symbol[0];
    }

    return null;
}

function currencyCodeToSymbol(currency: string | null | undefined): string | null {
    const normalized = cleanText(currency).toUpperCase();
    if (!normalized) {
        return null;
    }

    return CURRENCY_CODE_SYMBOL_MAP[normalized] || null;
}

function resolvePriceCurrencySymbol(pricing: AmazonPriceSnapshot): string | null {
    return (
        detectCurrencySymbol(pricing.currentPriceText) ||
        detectCurrencySymbol(pricing.dealPriceText) ||
        detectCurrencySymbol(pricing.listPriceText) ||
        currencyCodeToSymbol(pricing.currency)
    );
}

function dedupeStrings(values: Array<string | null | undefined>): string[] {
    return Array.from(new Set(values.map((value) => cleanText(value)).filter(Boolean)));
}

function selectFirst(root: Document | Element, selectors: readonly string[]): Element | null {
    for (const selector of selectors) {
        try {
            const node = root.querySelector(selector);
            if (node) {
                return node;
            }
        } catch {
            // Ignore invalid selectors and keep trying fallback selectors.
        }
    }

    return null;
}

function selectText(root: Document | Element, selectors: readonly string[]): string | null {
    return nullableText(selectFirst(root, selectors)?.textContent);
}

function toAbsoluteUrl(
    value: string | null | undefined,
    baseUrl: string,
    fallbackHost: string
): string | null {
    const normalized = cleanText(value);
    if (!normalized) {
        return null;
    }

    try {
        return new URL(normalized, baseUrl).toString();
    } catch {
        try {
            return new URL(normalized, `https://${fallbackHost}`).toString();
        } catch {
            return null;
        }
    }
}

function normalizeMarketplaceHost(rawHost: string): string {
    return rawHost
        .trim()
        .toLowerCase()
        .replace(/[/?#].*$/, '')
        .replace(/:\d+$/, '')
        .replace(/\.$/, '');
}

function getAmazonSuffixFromHost(hostname: string): (typeof AMAZON_MARKETPLACE_SUFFIXES)[number] | null {
    const normalized = normalizeMarketplaceHost(hostname);
    for (const suffix of AMAZON_MARKETPLACE_SUFFIXES) {
        if (normalized === `amazon.${suffix}` || normalized.endsWith(`.amazon.${suffix}`)) {
            return suffix;
        }
    }
    return null;
}

function isAllowedAmazonHost(hostname: string | null | undefined): boolean {
    if (!hostname) {
        return false;
    }

    return getAmazonSuffixFromHost(hostname) !== null;
}

function canonicalizeAmazonHost(hostname: string): string | null {
    const suffix = getAmazonSuffixFromHost(hostname);
    if (!suffix) {
        return null;
    }

    return `amazon.${suffix}`;
}

function parseAmazonHostFromInput(input?: string | null): string | null {
    const normalized = cleanText(input);
    if (!normalized) {
        return null;
    }

    const prefixed = /^https?:\/\//i.test(normalized) ? normalized : `https://${normalized}`;

    try {
        const parsed = new URL(prefixed);
        return canonicalizeAmazonHost(parsed.hostname);
    } catch {
        // Ignore parse failures.
    }

    return null;
}

function resolveAmazonHost(marketplace?: string, sourceInput?: string): string | null {
    const normalizedMarketplace = cleanText(marketplace)?.toLowerCase();
    if (normalizedMarketplace) {
        const marketplaceHost = parseAmazonHostFromInput(normalizedMarketplace);
        if (marketplaceHost) {
            return marketplaceHost;
        }

        const localeSuffix = AMAZON_LOCALE_SUFFIX_MAP[normalizedMarketplace];
        if (localeSuffix) {
            return `amazon.${localeSuffix}`;
        }

        const asSuffix = normalizedMarketplace as (typeof AMAZON_MARKETPLACE_SUFFIXES)[number];
        if (AMAZON_MARKETPLACE_SUFFIXES.includes(asSuffix)) {
            return `amazon.${asSuffix}`;
        }

        return null;
    }

    const fromInput = parseAmazonHostFromInput(sourceInput);
    if (fromInput) {
        return fromInput;
    }

    return DEFAULT_AMAZON_HOST;
}

function currencyFromMarketplaceHost(host: string): string | null {
    const suffix = getAmazonSuffixFromHost(host);
    if (!suffix) {
        return null;
    }

    return AMAZON_SUFFIX_CURRENCY_MAP[suffix] || null;
}

function normalizeTimeoutMs(timeout?: number): number {
    if (typeof timeout !== 'number' || !Number.isFinite(timeout)) {
        return DEFAULT_SCRAPE_TIMEOUT_MS;
    }

    return Math.max(5_000, Math.min(180_000, Math.round(timeout)));
}

function extractAsin(value: string | null | undefined): string | null {
    const normalized = cleanText(value);
    if (!normalized) {
        return null;
    }

    if (/^[A-Z0-9]{10}$/i.test(normalized)) {
        return normalized.toUpperCase();
    }

    const patterns = [
        /\/dp\/([A-Z0-9]{10})(?:[/?]|$)/i,
        /\/gp\/product\/([A-Z0-9]{10})(?:[/?]|$)/i,
        /\/product-reviews\/([A-Z0-9]{10})(?:[/?]|$)/i,
        /[?&]asin=([A-Z0-9]{10})(?:[&#]|$)/i,
    ];

    for (const pattern of patterns) {
        const match = normalized.match(pattern);
        if (match?.[1]) {
            return match[1].toUpperCase();
        }
    }

    return null;
}

function buildReviewKey(review: AmazonReviewItem): string {
    return (
        review.id ||
        review.url ||
        `${review.author || 'unknown'}|${review.date || 'unknown'}|${review.title || 'untitled'}`
    );
}

function parseReviewIdFromLink(link: string | null): string | null {
    const normalized = cleanText(link);
    if (!normalized) {
        return null;
    }

    const match = normalized.match(/\/customer-reviews\/([A-Z0-9]{8,20})(?:[/?]|$)/i);
    if (!match?.[1]) {
        return null;
    }

    return match[1].toUpperCase();
}

function matchReviewStarSelection(review: AmazonReviewItem, reviewStar: AmazonReviewStar): boolean {
    const rating = review.rating;
    if (!rating || reviewStar === 'all') {
        return true;
    }

    // Keep the existing business mapping semantics:
    // positive -> critical bucket, critical -> positive bucket.
    if (reviewStar === 'positive') {
        return rating <= 3;
    }

    if (reviewStar === 'critical') {
        return rating >= 4;
    }

    return true;
}

function extractSellerIdFromUrl(profileUrl: string | null): string | null {
    const normalized = cleanText(profileUrl);
    if (!normalized) {
        return null;
    }

    try {
        const parsed = new URL(normalized);
        const fromQuery = parsed.searchParams.get('seller');
        if (fromQuery) {
            return fromQuery;
        }
    } catch {
        // Fallback to regex path parsing for malformed URLs.
    }

    const regexMatch = normalized.match(/[?&]seller=([A-Z0-9]+)/i);
    if (regexMatch?.[1]) {
        return regexMatch[1].toUpperCase();
    }

    return null;
}

function parseCountryFromReviewDate(dateText: string | null): string | null {
    const normalized = cleanText(dateText);
    if (!normalized) {
        return null;
    }

    const match = normalized.match(/in\s+(.+?)\s+on\s+/i);
    if (!match?.[1]) {
        return null;
    }

    return nullableText(match[1]);
}

function parseBestSellerRanks(rawValue: string | null | undefined): Array<{ rank: number; category: string }> {
    const normalized = cleanText(rawValue);
    if (!normalized) {
        return [];
    }

    const ranks: Array<{ rank: number; category: string }> = [];
    const regex = /#([\d,]+)\s+in\s+([^#(]+?)(?=\s+#|\s*\(|$)/g;

    let match: RegExpExecArray | null = null;
    while ((match = regex.exec(normalized)) !== null) {
        const rank = parseInteger(match[1]);
        const category = cleanText(match[2]);
        if (!rank || !category) {
            continue;
        }
        ranks.push({ rank, category });
    }

    return ranks;
}

function normalizeDetailKey(rawKey: string): string {
    return cleanText(rawKey).replace(/\s+/g, ' ');
}

function getDetailValue(detailBullets: Record<string, string>, keyCandidates: string[]): string | null {
    const entries = Object.entries(detailBullets);

    for (const candidate of keyCandidates) {
        const normalizedCandidate = candidate.toLowerCase();
        const exact = entries.find(([key]) => key.toLowerCase() === normalizedCandidate);
        if (exact) {
            return exact[1];
        }

        const fuzzy = entries.find(([key]) => key.toLowerCase().includes(normalizedCandidate));
        if (fuzzy) {
            return fuzzy[1];
        }
    }

    return null;
}

function normalizeMarketplaceId(document: Document): string | null {
    const html = document.documentElement?.outerHTML || '';
    const match = html.match(/"marketplaceId"\s*:\s*"([^"]+)"/i);
    if (match?.[1]) {
        return match[1];
    }

    return null;
}

function parseMerchantInfo(rawText: string | null): {
    shipsFrom: string | null;
    soldBy: string | null;
    fulfilledByAmazon: boolean | null;
} {
    const normalized = cleanText(rawText);

    if (!normalized) {
        return {
            shipsFrom: null,
            soldBy: null,
            fulfilledByAmazon: null,
        };
    }

    const shipsFromMatch = normalized.match(/Ships\s+from\s+(.+?)(?:\.|,|;|$)/i);
    const soldByMatch = normalized.match(/Sold\s+by\s+(.+?)(?:\.|,|;|$)/i);
    const fulfilledByAmazon = /Fulfilled\s+by\s+Amazon/i.test(normalized)
        ? true
        : /sold\s+by\s+amazon/i.test(normalized)
            ? true
            : null;

    return {
        shipsFrom: nullableText(shipsFromMatch?.[1] || null),
        soldBy: nullableText(soldByMatch?.[1] || null),
        fulfilledByAmazon,
    };
}

function parseDetailBullets(document: Document): Record<string, string> {
    const details: Record<string, string> = {};

    const tableRows = document.querySelectorAll(
        '#productDetails_techSpec_section_1 tr, #productDetails_detailBullets_sections1 tr, #prodDetails tr'
    );

    for (const row of tableRows) {
        const key = normalizeDetailKey(
            row.querySelector('th')?.textContent || row.querySelector('td:first-child')?.textContent || ''
        );
        const value = nullableText(row.querySelector('td')?.textContent || '');

        if (key && value && !(key in details)) {
            details[key] = value;
        }
    }

    const bulletItems = document.querySelectorAll('#detailBullets_feature_div li, #detailBulletsWrapper_feature_div li');

    for (const item of bulletItems) {
        const content = cleanText(item.textContent);
        if (!content.includes(':')) {
            continue;
        }

        const separator = content.indexOf(':');
        const key = normalizeDetailKey(content.slice(0, separator));
        const value = nullableText(content.slice(separator + 1));

        if (key && value && !(key in details)) {
            details[key] = value;
        }
    }

    return details;
}

function parseHistogram(document: Document): AmazonReviewHistogramEntry[] {
    const rows = Array.from(document.querySelectorAll('#histogramTable tr'));

    const histogram = rows
        .map((row) => {
            const starsText = cleanText(row.querySelector('td.a-text-left a')?.textContent || row.textContent);
            const stars = parseInteger(starsText);
            const percentText =
                nullableText(row.querySelector('td.a-text-right')?.textContent) ||
                nullableText(row.querySelector('a[aria-label*="%"]')?.getAttribute('aria-label')) ||
                nullableText(row.textContent?.match(/[0-9]+%/)?.[0] || null);

            if (!stars) {
                return null;
            }

            return {
                stars,
                percent: parsePercent(percentText),
                rawPercentText: percentText,
            } satisfies AmazonReviewHistogramEntry;
        })
        .filter((value): value is AmazonReviewHistogramEntry => Boolean(value))
        .sort((left, right) => right.stars - left.stars);

    return histogram;
}

function parseAboutItemBullets(document: Document): string[] {
    return dedupeStrings(
        (Array.from(document.querySelectorAll(ABOUT_ITEM_BULLET_SELECTORS.join(','))) as Element[])
            .map((node) => cleanText(node.textContent))
            .filter((value) => {
                const lowered = value.toLowerCase();
                return (
                    value.length > 3 &&
                    value !== '/' &&
                    !lowered.includes('make sure this fits')
                );
            })
    );
}

function parseProductDescriptionText(document: Document): string | null {
    const values = dedupeStrings(
        (Array.from(document.querySelectorAll(PRODUCT_DESCRIPTION_SELECTORS.join(','))) as Element[])
            .map((node) => cleanText(node.textContent))
            .filter((value) => value.length > 8)
    );

    if (values.length === 0) {
        return null;
    }

    return values.join(' ');
}

function resolveInputUrl(input: string, host: string): string | null {
    const normalized = cleanText(input);
    if (!normalized) {
        return null;
    }

    if (/^[A-Z0-9]{10}$/i.test(normalized)) {
        return `https://${host}/dp/${normalized.toUpperCase()}?th=1`;
    }

    if (normalized.startsWith('/')) {
        const pathAsin = extractAsin(normalized);
        if (pathAsin) {
            return `https://${host}/dp/${pathAsin}?th=1`;
        }
    }

    let candidateUrl: string | null = null;

    if (/^https?:\/\//i.test(normalized)) {
        try {
            const parsed = new URL(normalized);
            candidateUrl = isAllowedAmazonHost(parsed.hostname) ? parsed.toString() : null;
        } catch {
            return null;
        }
    }

    if (!candidateUrl && /amazon\./i.test(normalized)) {
        try {
            const parsed = new URL(`https://${normalized.replace(/^\/+/, '')}`);
            candidateUrl = isAllowedAmazonHost(parsed.hostname) ? parsed.toString() : null;
        } catch {
            return null;
        }
    }

    if (!candidateUrl) {
        return null;
    }

    const asin = extractAsin(candidateUrl);
    if (asin) {
        return `https://${host}/dp/${asin}?th=1`;
    }

    return null;
}

function extractImageUrls(document: Document): string[] {
    const images: string[] = [];

    const landingImage = document.querySelector('#landingImage, #imgBlkFront');
    const direct =
        landingImage?.getAttribute('data-old-hires') ||
        landingImage?.getAttribute('src') ||
        landingImage?.getAttribute('data-a-dynamic-image');

    if (direct) {
        images.push(direct);
    }

    const dynamicImageRaw = landingImage?.getAttribute('data-a-dynamic-image');
    if (dynamicImageRaw) {
        try {
            const parsed = JSON.parse(dynamicImageRaw) as Record<string, [number, number]>;
            images.push(...Object.keys(parsed));
        } catch {
            // Ignore malformed dynamic image payloads.
        }
    }

    const thumbs = document.querySelectorAll('#altImages img, #imageBlockThumbs img');
    for (const thumb of thumbs) {
        const src = thumb.getAttribute('src') || thumb.getAttribute('data-src');
        if (src) {
            images.push(src.replace(/\._[A-Z0-9_,]+_\./, '.'));
        }
    }

    return dedupeStrings(images);
}

export class AmazonServiceError extends Error {
    public readonly code: string;
    public readonly statusCode: number;

    constructor(message: string, code: string, statusCode = 500) {
        super(message);
        this.name = 'AmazonServiceError';
        this.code = code;
        this.statusCode = statusCode;
    }
}

class AmazonService {
    public isConfigured(): boolean {
        return true;
    }

    public getStatus() {
        return {
            status: 'online',
            service: 'amazon-catalog-inspector-v1',
            defaults: {
                includeReviews: true,
                reviewPageLimit: DEFAULT_REVIEW_PAGE_LIMIT,
                reviewSortBy: DEFAULT_REVIEW_SORT,
                reviewStar: DEFAULT_REVIEW_STAR,
            },
            notes: [
                'Amazon pages can return anti-bot checkpoints and captcha walls depending on IP/session trust.',
                'Review extraction runs directly on the fetched product page HTML (no extra review-page crawl).',
            ],
        };
    }

    private parseProductPage(html: string, pageUrl: string, host: string, fallbackAsin: string | null): ProductPageParseResult {
        const dom = new JSDOM(html, {
            url: pageUrl,
            virtualConsole: JSDOM_SILENT_VIRTUAL_CONSOLE,
        });
        const document = dom.window.document;

        const detailBullets = parseDetailBullets(document);

        const canonicalUrl =
            document.querySelector('link[rel="canonical"]')?.getAttribute('href') ||
            null;

        const resolvedAsin =
            extractAsin(fallbackAsin) ||
            extractAsin(pageUrl) ||
            extractAsin(canonicalUrl) ||
            extractAsin(document.querySelector('#ASIN')?.getAttribute('value') || null) ||
            extractAsin(getDetailValue(detailBullets, ['ASIN']));

        const title = selectText(document, PRODUCT_TITLE_SELECTORS);
        const brand = nullableText(
            selectText(document, BRAND_SELECTORS)?.replace(/^Visit\s+the\s+/i, '').replace(/\s+Store$/i, '')
        );

        const ratingText = selectText(document, RATING_TEXT_SELECTORS);
        const ratingsCountText = selectText(document, RATING_COUNT_SELECTORS);

        const offerListingLink = document.querySelector('a[href*="/gp/offer-listing/"], a[href*="/gp/aod/ajax"]');
        const offerListingUrl = toAbsoluteUrl(
            offerListingLink?.getAttribute('href') || null,
            pageUrl,
            host
        );

        const merchantInfo = selectText(document, MERCHANT_INFO_SELECTORS);
        const merchantInfoParsed = parseMerchantInfo(merchantInfo);

        const shipsFrom =
            getDetailValue(detailBullets, ['Ships from']) ||
            merchantInfoParsed.shipsFrom;

        const soldBy =
            getDetailValue(detailBullets, ['Sold by']) ||
            merchantInfoParsed.soldBy;

        const sellerProfileLink = document.querySelector('#sellerProfileTriggerId, #merchant-info a[href*="seller"]');
        const sellerProfileUrl = toAbsoluteUrl(
            sellerProfileLink?.getAttribute('href') || null,
            pageUrl,
            host
        );

        const fulfilledByAmazon =
            merchantInfoParsed.fulfilledByAmazon ??
            (merchantInfo ? /fulfilled\s+by\s+amazon/i.test(merchantInfo) : null);

        const badges = dedupeStrings(
            (Array.from(
                document.querySelectorAll(
                    '#zeitgeistBadge_feature_div *, #acBadge_feature_div *, .a-badge-label, .dealBadgeText'
                )
            ) as Element[])
                .map((node) => cleanText(node.textContent))
                .filter((value) => value.length > 1 && value.length < 64)
        );

        const categoryPath = dedupeStrings(
            (Array.from(document.querySelectorAll('#wayfinding-breadcrumbs_feature_div li a')) as Element[]).map((node) => node.textContent)
        );

        const featureBullets = parseAboutItemBullets(document);

        const description = parseProductDescriptionText(document);

        const currentPriceText = selectText(document, CURRENT_PRICE_SELECTORS);
        const listPriceText = selectText(document, LIST_PRICE_SELECTORS);
        const dealPriceText = selectText(document, DEAL_PRICE_SELECTORS);

        const pricing: AmazonPriceSnapshot = {
            currentPriceText,
            currentPrice: parseNumber(currentPriceText),
            currency:
                detectCurrency(currentPriceText || listPriceText || dealPriceText) ||
                currencyFromMarketplaceHost(host),
            listPriceText,
            listPrice: parseNumber(listPriceText),
            dealPriceText,
            dealPrice: parseNumber(dealPriceText),
            savingsText: selectText(document, SAVINGS_SELECTORS),
            savingsPercent: parsePercent(selectText(document, SAVINGS_SELECTORS)),
            unitPriceText: selectText(document, UNIT_PRICE_SELECTORS),
            couponText: selectText(document, COUPON_SELECTORS),
            offerSummaryText: nullableText(offerListingLink?.textContent),
            offerListingUrl,
        };

        const reviewsSummary: AmazonReviewSummary = {
            averageRatingText:
                selectText(document, ['#acrPopover', '[data-hook="rating-out-of-text"]']) ||
                ratingText,
            averageRating:
                parseRating(selectText(document, ['#acrPopover', '[data-hook="rating-out-of-text"]'])) ||
                parseRating(ratingText),
            totalRatingsText: ratingsCountText,
            histogram: parseHistogram(document),
        };

        const bestSellerRaw =
            getDetailValue(detailBullets, ['Best Sellers Rank', 'Amazon Best Sellers Rank']) ||
            selectText(document, ['#SalesRank', '#detailBulletsWrapper_feature_div']);

        const reviewListingAnchor = document.querySelector(
            'a[data-hook="see-all-reviews-link-foot"], a[data-hook="see-all-reviews-link"], #acrCustomerReviewLink'
        );

        const product: AmazonProductSnapshot = {
            asin: resolvedAsin,
            url: pageUrl,
            canonicalUrl: toAbsoluteUrl(canonicalUrl, pageUrl, host),
            title,
            brand,
            ratingText,
            rating: parseRating(ratingText),
            ratingsCountText,
            ratingsCount: parseInteger(ratingsCountText),
            availability: selectText(document, AVAILABILITY_SELECTORS),
            merchantInfo,
            categoryPath,
            featureBullets,
            description,
            imageUrls: extractImageUrls(document),
            detailBullets,
            badges,
        };

        const marketplaceData: AmazonMarketplaceSnapshot = {
            sellerName: soldBy,
            sellerId: extractSellerIdFromUrl(sellerProfileUrl),
            sellerProfileUrl,
            shipsFrom,
            soldBy,
            fulfilledByAmazon,
            bestSellerRanks: parseBestSellerRanks(bestSellerRaw),
            marketplaceId: normalizeMarketplaceId(document),
        };

        return {
            product,
            pricing,
            marketplaceData,
            reviewsSummary,
            reviewListingUrl: toAbsoluteUrl(reviewListingAnchor?.getAttribute('href') || null, pageUrl, host),
        };
    }

    private parseReviewPage(html: string, pageUrl: string, host: string): ReviewPageParseResult {
        const dom = new JSDOM(html, {
            url: pageUrl,
            virtualConsole: JSDOM_SILENT_VIRTUAL_CONSOLE,
        });
        const document = dom.window.document;

        const reviews = (Array.from(document.querySelectorAll(REVIEW_BLOCK_SELECTORS.join(','))) as Element[]).map((block) => {
            const linkEl = selectFirst(block, ['a[data-hook="review-title"]', 'a.a-link-normal']);
            const link = toAbsoluteUrl(linkEl?.getAttribute('href') || null, pageUrl, host);
            const blockId =
                block.getAttribute('id')?.replace(/^customer_review-/i, '') ||
                block.getAttribute('data-review-id') ||
                null;
            const reviewId = blockId || parseReviewIdFromLink(link);

            const date = selectText(block, REVIEW_DATE_SELECTORS);

            return {
                id: reviewId,
                url: link,
                title: selectText(block, REVIEW_TITLE_SELECTORS),
                rating: parseRating(selectText(block, REVIEW_RATING_SELECTORS)),
                author: selectText(block, REVIEW_AUTHOR_SELECTORS),
                date,
                country: parseCountryFromReviewDate(date),
                verifiedPurchase: Boolean(selectText(block, ['[data-hook="avp-badge"]'])),
                variation: selectText(block, REVIEW_VARIATION_SELECTORS),
                helpfulVotes: parseInteger(selectText(block, REVIEW_HELPFUL_SELECTORS)),
                text: selectText(block, REVIEW_TEXT_SELECTORS),
            } satisfies AmazonReviewItem;
        });

        const nextPageUrl = toAbsoluteUrl(
            selectFirst(document, ['li.a-last a', 'ul.a-pagination li.a-last a', 'a[data-hook="pagination-next"]'])?.getAttribute('href') || null,
            pageUrl,
            host
        );

        const seeAllReviewsUrl = toAbsoluteUrl(
            selectFirst(document, [
                '#reviews-medley-footer a[data-hook="see-all-reviews-link-foot"]',
                'a[data-hook="see-all-reviews-link-foot"]',
                'a[data-hook="see-all-reviews-link"]',
            ])?.getAttribute('href') || null,
            pageUrl,
            host
        );

        const summary: AmazonReviewSummary = {
            averageRatingText: selectText(document, REVIEW_SUMMARY_AVERAGE_SELECTORS),
            averageRating: parseRating(selectText(document, REVIEW_SUMMARY_AVERAGE_SELECTORS)),
            totalRatingsText: selectText(document, REVIEW_SUMMARY_TOTAL_SELECTORS),
            histogram: parseHistogram(document),
        };

        return {
            summary,
            reviews,
            nextPageUrl,
            seeAllReviewsUrl,
        };
    }

    private collectReviewsFromProductPage(input: {
        html: string;
        pageUrl: string;
        host: string;
        reviewStar: AmazonReviewStar;
        reviewStopAtId?: string;
        reviewPageLimit: number;
    }): {
        summary: AmazonReviewSummary;
        reviews: AmazonReviewItem[];
    } {
        const parsed = this.parseReviewPage(input.html, input.pageUrl, input.host);
        const reviewItemLimit = Math.max(
            1,
            Math.min((input.reviewPageLimit || DEFAULT_REVIEW_PAGE_LIMIT) * 10, MAX_REVIEW_PAGE_LIMIT)
        );
        const seen = new Set<string>();
        const reviews: AmazonReviewItem[] = [];

        for (const review of parsed.reviews) {
            if (!matchReviewStarSelection(review, input.reviewStar)) {
                continue;
            }

            const key = buildReviewKey(review);
            if (seen.has(key)) {
                continue;
            }

            seen.add(key);
            reviews.push(review);

            if (input.reviewStopAtId && review.id === input.reviewStopAtId) {
                break;
            }

            if (reviews.length >= reviewItemLimit) {
                break;
            }
        }

        return {
            summary: parsed.summary,
            reviews,
        };
    }

    public async inspect(input: AmazonInspectInput): Promise<AmazonInspectResult> {
        const host = resolveAmazonHost(input.marketplace, input.input);
        if (!host) {
            throw new AmazonServiceError(
                'Marketplace must be a valid Amazon domain or locale (for example: amazon.com, co.uk, us, jp).',
                'INVALID_AMAZON_MARKETPLACE',
                400
            );
        }

        const asinFromInput = extractAsin(input.input);
        const reviewStar = input.reviewStar || DEFAULT_REVIEW_STAR;
        const reviewPageLimit = Math.max(
            1,
            Math.min(input.reviewPageLimit || DEFAULT_REVIEW_PAGE_LIMIT, MAX_REVIEW_PAGE_LIMIT)
        );
        const requestTimeoutMs = normalizeTimeoutMs(input.timeout);
        const sessionKey = `amazon:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;

        const productUrl = resolveInputUrl(input.input, host);

        if (!productUrl) {
            throw new AmazonServiceError(
                'Input must be an Amazon URL/hosted path or a valid 10-character ASIN.',
                'INVALID_AMAZON_INPUT',
                400
            );
        }

        let productResult: Awaited<ReturnType<typeof scraperHttpService.scrape>> | null = null;
        let lastProductBlockSignals: string[] = [];

        for (let attempt = 1; attempt <= PRODUCT_BLOCK_RETRY_ATTEMPTS; attempt += 1) {
            const candidateProductResult = await scraperHttpService.scrape(productUrl, {
                jsEnabled: true,
                timeout: requestTimeoutMs,
                stealth: input.stealth,
                waitForSelector: input.waitForSelector,
                screenshotOnError: false,
                sessionKey,
                userAgentJitter: true,
                minDelayMs: AMAZON_HTTP_DELAY_MIN_MS,
                maxDelayMs: AMAZON_HTTP_DELAY_MAX_MS,
                forceWwwAmazonHost: true,
            });

            const productAntiBot = antiBotDetectionService.detect(
                'amazon',
                candidateProductResult.url,
                candidateProductResult.html
            );

            if (!productAntiBot.blocked) {
                productResult = candidateProductResult;
                break;
            }

            lastProductBlockSignals = productAntiBot.matchedSignals;

            if (attempt < PRODUCT_BLOCK_RETRY_ATTEMPTS) {
                continue;
            }

            const signalSummary = productAntiBot.matchedSignals.length > 0
                ? ` Signals: ${productAntiBot.matchedSignals.join(', ')}`
                : '';
            throw new AmazonServiceError(
                `Amazon blocked the product inspection request. Try a different session, backoff, or proxy.${signalSummary}`,
                'AMAZON_BLOCKED',
                429
            );
        }

        if (!productResult) {
            const signalSummary = lastProductBlockSignals.length > 0
                ? ` Signals: ${lastProductBlockSignals.join(', ')}`
                : '';
            throw new AmazonServiceError(
                `Amazon blocked the product inspection request. Try a different session, backoff, or proxy.${signalSummary}`,
                'AMAZON_BLOCKED',
                429
            );
        }

        const parsedProduct = this.parseProductPage(productResult.html, productResult.url, host, asinFromInput);
        const asin = parsedProduct.product.asin || asinFromInput;

        if (!asin) {
            // Keep running with best-effort product payload even if ASIN parsing fails.
        }

        let reviewItems: AmazonReviewItem[] = [];
        let reviewSummary: AmazonReviewSummary = parsedProduct.reviewsSummary;

        if (input.includeReviews !== false) {
            const reviewResult = this.collectReviewsFromProductPage({
                html: productResult.html,
                pageUrl: productResult.url,
                host,
                reviewPageLimit,
                reviewStar,
                reviewStopAtId: input.reviewStopAtId,
            });

            reviewItems = reviewResult.reviews;
            reviewSummary = reviewResult.summary;
        }

        const resolvedPriceValue =
            parsedProduct.pricing.currentPrice ??
            parsedProduct.pricing.dealPrice ??
            parsedProduct.pricing.listPrice ??
            null;
        const resolvedReviewsCount =
            parsedProduct.product.ratingsCount ??
            parseInteger(reviewSummary.totalRatingsText) ??
            parseInteger(parsedProduct.product.ratingsCountText);
        const resolvedFeatures = dedupeStrings([
            ...parsedProduct.product.featureBullets,
            parsedProduct.product.description,
        ]);
        const resolvedSellerId =
            parsedProduct.marketplaceData.sellerId ||
            extractSellerIdFromUrl(parsedProduct.marketplaceData.sellerProfileUrl);

        return {
            input: input.input,
            title: parsedProduct.product.title,
            url: parsedProduct.product.canonicalUrl || parsedProduct.product.url,
            asin: asin || null,
            brand: parsedProduct.product.brand,
            price: {
                value: resolvedPriceValue,
                currency: resolvePriceCurrencySymbol(parsedProduct.pricing),
            },
            reviewsCount: resolvedReviewsCount,
            features: resolvedFeatures,
            seller: {
                name: parsedProduct.marketplaceData.sellerName || parsedProduct.marketplaceData.soldBy,
                id: resolvedSellerId,
                url: parsedProduct.marketplaceData.sellerProfileUrl,
            },
            reviews: reviewItems,
        };
    }
}

export const amazonService = new AmazonService();
