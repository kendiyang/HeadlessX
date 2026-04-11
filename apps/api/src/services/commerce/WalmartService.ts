import {
    asRecord,
    asString,
    cleanText,
    createDom,
    dedupeStrings,
    findFirstBySchemaType,
    parseCurrency,
    parseNumericPrice,
    readJsonLdObjects,
    selectAttribute,
    selectText,
} from './CommerceInspectCore';
import { antiBotDetectionService } from '../scrape/AntiBotDetectionService';
import { scraperHttpService } from '../scrape/ScraperHttpService';

export type WalmartReviewSortBy = 'recent' | 'relevant' | 'helpful';
export type WalmartReviewStar = 'all' | 'positive' | 'neutral' | 'negative' | 'critical';

export interface WalmartInspectInput {
    input: string;
    includeReviews?: boolean;
    reviewPageLimit?: number;
    reviewSortBy?: WalmartReviewSortBy;
    reviewStar?: WalmartReviewStar;
    reviewerType?: string;
    reviewStopAtId?: string;
    timeout?: number;
    stealth?: boolean;
}

export interface WalmartReviewItem {
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

export interface WalmartInspectResult {
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
    reviews: WalmartReviewItem[];
}

const DEFAULT_WALMART_HOST = 'www.walmart.com';
const WALMART_HOST_PATTERN = /^(?:[a-z0-9-]+\.)*walmart\.(?:com|ca|com\.mx)$/i;
const DEFAULT_REVIEW_STAR: WalmartReviewStar = 'all';
const DEFAULT_REVIEW_SORT: WalmartReviewSortBy = 'recent';
const DEFAULT_REVIEW_PAGE_LIMIT = 1;
const MAX_REVIEW_PAGE_LIMIT = 5000;
const DEFAULT_SCRAPE_TIMEOUT_MS = 30_000;
const PRODUCT_BLOCK_RETRY_ATTEMPTS = 2;
const WALMART_HTTP_DELAY_MIN_MS = 100;
const WALMART_HTTP_DELAY_MAX_MS = 500;

const WALMART_SUFFIX_CURRENCY_MAP: Record<string, string> = {
    com: 'USD',
    ca: 'CAD',
    'com.mx': 'MXN',
};

const CURRENCY_CODE_SYMBOL_MAP: Record<string, string> = {
    USD: '$',
    CAD: '$',
    MXN: '$',
    EUR: '€',
    GBP: '£',
};

const TITLE_SELECTORS = [
    'h1[data-automation-id="product-title"]',
    'h1[itemprop="name"]',
    'h1',
] as const;

const BRAND_SELECTORS = [
    '[data-testid="product-brand"]',
    '[itemprop="brand"]',
] as const;

const SELLER_SELECTORS = [
    '[data-testid="sold-by"] a',
    '[data-automation-id="sold-and-shipped-by"]',
    '[data-testid="sold-by"]',
] as const;

const SELLER_PROFILE_SELECTORS = [
    '[data-testid="sold-by"] a[href]',
    'a[href*="/seller/"]',
    'a[href*="sellerId="]',
] as const;

const PRICE_SELECTORS = [
    '[itemprop="price"]',
    'span[data-automation-id="product-price"]',
    '[data-testid="price-wrap"] span',
    '[data-testid="price"]',
] as const;

const DESCRIPTION_SELECTORS = [
    'meta[name="description"]',
    '[itemprop="description"]',
    '[data-testid="product-description"]',
] as const;

const FEATURE_BULLET_SELECTORS = [
    '[data-testid="product-highlights"] li',
    '[data-testid="about-item"] li',
    '[data-testid="item-details"] li',
    '[data-testid="specifications"] li',
    '[data-testid="key-item-features"] li',
    '[data-testid="keyFeatures"] li',
    '[data-testid="key-features"] li',
    '[id="key-item-features"] li',
    '[id="keyFeatures"] li',
    '[id="key-features"] li',
    '[data-automation-id="key-features"] li',
    '#product-description ul li',
] as const;

const KEY_ITEM_FEATURES_HEADING_PATTERN = /\bkey\s*item\s*features\b/i;
const KEY_ITEM_FEATURES_HEADING_SELECTORS = [
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    '[role="heading"]',
    'span',
    'div',
    'strong',
] as const;

const KEY_ITEM_FEATURES_SECTION_SELECTORS = [
    'section.expand-collapse-section',
    'section[class*="expand-collapse-section"]',
] as const;
const BRAND_SPEC_LABEL_PATTERN = /^brand$/i;

const REVIEW_BLOCK_SELECTORS = [
    '[data-testid="review-list"] [data-testid="review"]',
    '[data-testid="reviews"] [data-testid="review"]',
    '[data-testid="review"]',
    '[itemprop="review"]',
] as const;

const REVIEW_LINK_SELECTORS = [
    'a[href*="review"]',
    'a[href*="/reviews/"]',
] as const;

const REVIEW_TITLE_SELECTORS = [
    '[data-testid="review-title"]',
    '[itemprop="name"]',
] as const;

const REVIEW_TEXT_SELECTORS = [
    '[data-testid="review-text"]',
    '[itemprop="reviewBody"]',
    '[data-testid="review-description"]',
] as const;

const REVIEW_AUTHOR_SELECTORS = [
    '[data-testid="review-author"]',
    '[itemprop="author"]',
] as const;

const REVIEW_DATE_SELECTORS = [
    '[data-testid="review-date"]',
    '[itemprop="datePublished"]',
    'time',
] as const;

const REVIEW_RATING_SELECTORS = [
    '[data-testid="review-rating"]',
    '[aria-label*="out of 5"]',
    '[itemprop="reviewRating"]',
] as const;

const REVIEW_HELPFUL_SELECTORS = [
    '[data-testid="review-helpful-count"]',
    '[data-testid="helpful-count"]',
] as const;

const REVIEW_VERIFIED_SELECTORS = [
    '[data-testid="review-verified-purchase"]',
    '[data-testid="verified-purchase"]',
] as const;

const REVIEW_COUNT_SELECTORS = [
    '[data-testid="review-count"]',
    '[data-testid="reviews-header"]',
    '[itemprop="reviewCount"]',
] as const;

function normalizeTimeoutMs(timeout?: number): number {
    if (typeof timeout !== 'number' || !Number.isFinite(timeout)) {
        return DEFAULT_SCRAPE_TIMEOUT_MS;
    }

    return Math.max(5_000, Math.min(180_000, Math.round(timeout)));
}

function parseInteger(value: string | null | undefined): number | null {
    const normalized = cleanText(value);
    if (!normalized) {
        return null;
    }

    const digits = normalized.replace(/[^0-9]/g, '');
    if (!digits) {
        return null;
    }

    const parsed = Number.parseInt(digits, 10);
    return Number.isFinite(parsed) ? parsed : null;
}

function parseRating(value: string | null | undefined): number | null {
    const normalized = cleanText(value);
    if (!normalized) {
        return null;
    }

    const match = normalized.match(/([0-9]+(?:\.[0-9]+)?)/);
    if (!match?.[1]) {
        return null;
    }

    const parsed = Number.parseFloat(match[1]);
    return Number.isFinite(parsed) ? parsed : null;
}

function parseDateValue(value: string | null | undefined): number | null {
    const normalized = cleanText(value);
    if (!normalized) {
        return null;
    }

    const timestamp = Date.parse(normalized);
    return Number.isFinite(timestamp) ? timestamp : null;
}

function parseFeatureBullets(document: Document): string[] {
    const fromStaticSelectors = (Array.from(document.querySelectorAll(FEATURE_BULLET_SELECTORS.join(','))) as Element[])
        .map((node) => cleanText(node.textContent))
        .filter((value) => Boolean(value && value.length > 2));

    return dedupeStrings([
        ...fromStaticSelectors,
        ...parseKeyItemFeaturesBySection(document),
        ...parseKeyItemFeaturesByHeading(document),
    ]);
}

function normalizeSpecLabel(value: string | null | undefined): string | null {
    const normalized = cleanText(value);
    if (!normalized) {
        return null;
    }

    return normalized.replace(/\s*:\s*$/, '');
}

function extractBrandValueFromLabel(labelNode: Element): string | null {
    let sibling: Element | null = labelNode.nextElementSibling;
    let steps = 0;

    while (sibling && steps < 3) {
        const value = cleanText(sibling.textContent);
        if (value && !BRAND_SPEC_LABEL_PATTERN.test(normalizeSpecLabel(value) || '')) {
            return value;
        }

        sibling = sibling.nextElementSibling;
        steps += 1;
    }

    const parent = labelNode.parentElement;
    if (!parent) {
        return null;
    }

    if (labelNode.tagName.toLowerCase() === 'th') {
        const rowValue = cleanText(parent.querySelector('td')?.textContent);
        if (rowValue) {
            return rowValue;
        }
    }

    if (labelNode.tagName.toLowerCase() === 'dt') {
        const detailValue = cleanText(parent.querySelector('dd')?.textContent);
        if (detailValue) {
            return detailValue;
        }
    }

    return null;
}

function parseBrandFromSpecifications(document: Document): string | null {
    const candidates = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6,th,dt,span,div')) as Element[];

    for (const node of candidates) {
        const label = normalizeSpecLabel(node.textContent);
        if (!label || !BRAND_SPEC_LABEL_PATTERN.test(label)) {
            continue;
        }

        const value = extractBrandValueFromLabel(node);
        if (value) {
            return value;
        }
    }

    return null;
}

function readKeyItemFeaturesHeadingText(node: Element): string | null {
    return cleanText(node.textContent) || cleanText(node.getAttribute('aria-label')) || cleanText(node.getAttribute('title'));
}

function parseKeyItemFeaturesBySection(document: Document): string[] {
    const sections = Array.from(document.querySelectorAll(KEY_ITEM_FEATURES_SECTION_SELECTORS.join(','))) as Element[];
    const extracted: string[] = [];

    for (const section of sections) {
        const headingCandidate = section.querySelector('h1,h2,h3,h4,h5,h6,.expand-collapse-header,[aria-label],[role="heading"]');
        const headingText = headingCandidate ? readKeyItemFeaturesHeadingText(headingCandidate) : null;

        if (!headingText || !KEY_ITEM_FEATURES_HEADING_PATTERN.test(headingText)) {
            continue;
        }

        const container =
            section.querySelector('.expand-collapse-content') ||
            section.querySelector('[data-testid="ui-collapse-panel"]') ||
            section;

        const bullets = extractBulletsFromContainer(container as Element);
        if (bullets.length > 0) {
            extracted.push(...bullets);
        }
    }

    return dedupeStrings(extracted);
}

function parseKeyItemFeaturesByHeading(document: Document): string[] {
    const candidates = Array.from(document.querySelectorAll(KEY_ITEM_FEATURES_HEADING_SELECTORS.join(','))) as Element[];
    const extracted: string[] = [];

    for (const heading of candidates) {
        const headingText = readKeyItemFeaturesHeadingText(heading);
        if (!headingText || !KEY_ITEM_FEATURES_HEADING_PATTERN.test(headingText)) {
            continue;
        }

        const scopedContainers = [
            heading.nextElementSibling,
            heading.nextElementSibling?.nextElementSibling || null,
            heading.parentElement,
            heading.parentElement?.nextElementSibling || null,
        ].filter((container): container is Element => Boolean(container));

        for (const container of scopedContainers) {
            const bullets = extractBulletsFromContainer(container);
            if (bullets.length === 0) {
                continue;
            }

            extracted.push(...bullets);
            break;
        }
    }

    return dedupeStrings(extracted);
}

function extractBulletsFromContainer(container: Element): string[] {
    const nodes = Array.from(container.querySelectorAll('li')) as Element[];
    if (nodes.length === 0 || nodes.length > 30) {
        return [];
    }

    return dedupeStrings(
        nodes
            .map((node) => cleanText(node.textContent))
            .filter((value) => Boolean(value && value.length > 2))
    );
}

function getWalmartSuffixFromHost(host: string): string | null {
    const normalized = host.trim().toLowerCase();
    const suffixes = Object.keys(WALMART_SUFFIX_CURRENCY_MAP).sort((left, right) => right.length - left.length);

    for (const suffix of suffixes) {
        if (normalized === `walmart.${suffix}` || normalized.endsWith(`.walmart.${suffix}`)) {
            return suffix;
        }
    }

    return null;
}

function currencyFromWalmartHost(host: string): string | null {
    const suffix = getWalmartSuffixFromHost(host);
    return suffix ? WALMART_SUFFIX_CURRENCY_MAP[suffix] || null : null;
}

function detectCurrencySymbol(value: string | null | undefined): string | null {
    const normalized = cleanText(value);
    if (!normalized) {
        return null;
    }

    const qualifiedDollar = normalized.match(/(CA\$|MX\$)/i);
    if (qualifiedDollar?.[1]) {
        return qualifiedDollar[1].toUpperCase();
    }

    const symbol = normalized.match(/[$€£]/);
    return symbol?.[0] || null;
}

function currencyCodeToSymbol(currency: string | null | undefined): string | null {
    const normalized = cleanText(currency)?.toUpperCase();
    if (!normalized) {
        return null;
    }

    return CURRENCY_CODE_SYMBOL_MAP[normalized] || null;
}

function resolvePriceCurrencySymbol(priceText: string | null, currencyCode: string | null): string | null {
    return detectCurrencySymbol(priceText) || currencyCodeToSymbol(currencyCode);
}

function extractProductId(url: string): string | null {
    const fromPath = url.match(/\/ip\/(?:[^/]+\/)?([0-9]{6,20})(?:[/?#]|$)/i)?.[1];
    if (fromPath) {
        return fromPath;
    }

    return url.match(/[?&](?:productId|sku)=([0-9]{6,20})(?:[&#]|$)/i)?.[1] || null;
}

function resolveInputUrl(input: string): string | null {
    const normalized = cleanText(input);
    if (!normalized) {
        return null;
    }

    if (/^\d{6,20}$/.test(normalized)) {
        return `https://${DEFAULT_WALMART_HOST}/ip/${normalized}`;
    }

    if (normalized.startsWith('/')) {
        const productId = extractProductId(normalized);
        if (productId) {
            return `https://${DEFAULT_WALMART_HOST}/ip/${productId}`;
        }
        return `https://${DEFAULT_WALMART_HOST}${normalized}`;
    }

    let candidateUrl: URL | null = null;

    if (/^https?:\/\//i.test(normalized)) {
        try {
            candidateUrl = new URL(normalized);
        } catch {
            return null;
        }
    } else if (/walmart\./i.test(normalized)) {
        try {
            candidateUrl = new URL(`https://${normalized.replace(/^\/+/, '')}`);
        } catch {
            return null;
        }
    }

    if (!candidateUrl || !WALMART_HOST_PATTERN.test(candidateUrl.hostname)) {
        return null;
    }

    const productId = extractProductId(candidateUrl.toString());
    if (productId) {
        return `https://${candidateUrl.hostname}/ip/${productId}`;
    }

    return candidateUrl.toString();
}

function toAbsoluteUrl(value: string | null | undefined, pageUrl: string, fallbackHost: string): string | null {
    const normalized = cleanText(value);
    if (!normalized) {
        return null;
    }

    try {
        return new URL(normalized, pageUrl).toString();
    } catch {
        try {
            return new URL(normalized, `https://${fallbackHost}`).toString();
        } catch {
            return null;
        }
    }
}

function selectFirstFromRoot(root: Document | Element, selectors: readonly string[]): Element | null {
    for (const selector of selectors) {
        try {
            const node = root.querySelector(selector);
            if (node) {
                return node;
            }
        } catch {
            // Ignore invalid selector.
        }
    }

    return null;
}

function selectTextFromRoot(root: Document | Element, selectors: readonly string[]): string | null {
    const value = selectFirstFromRoot(root, selectors)?.textContent;
    return cleanText(value);
}

function selectAttributeFromRoot(
    root: Document | Element,
    selectors: readonly string[],
    attribute: string
): string | null {
    for (const selector of selectors) {
        try {
            const node = root.querySelector(selector);
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

function parseReviewIdFromUrl(value: string | null | undefined): string | null {
    const normalized = cleanText(value);
    if (!normalized) {
        return null;
    }

    const pathMatch = normalized.match(/\/reviews?\/([A-Za-z0-9-]{6,64})(?:[/?#]|$)/i);
    if (pathMatch?.[1]) {
        return pathMatch[1];
    }

    const queryMatch = normalized.match(/[?&]review(?:Id|id)=([A-Za-z0-9-]{6,64})(?:[&#]|$)/i);
    if (queryMatch?.[1]) {
        return queryMatch[1];
    }

    return null;
}

function extractSellerIdFromUrl(value: string | null | undefined): string | null {
    const normalized = cleanText(value);
    if (!normalized) {
        return null;
    }

    const pathMatch = normalized.match(/\/seller\/([^/?#]+)/i);
    if (pathMatch?.[1]) {
        return pathMatch[1];
    }

    const queryMatch = normalized.match(/[?&](?:sellerId|seller)=([^&#]+)/i);
    if (queryMatch?.[1]) {
        return queryMatch[1];
    }

    return null;
}

function buildReviewKey(review: WalmartReviewItem): string {
    return review.id || review.url || `${review.author || 'unknown'}|${review.date || 'unknown'}|${review.title || 'untitled'}`;
}

function matchReviewStarSelection(review: WalmartReviewItem, reviewStar: WalmartReviewStar): boolean {
    const rating = review.rating;
    if (!rating || reviewStar === 'all') {
        return true;
    }

    if (reviewStar === 'positive') {
        return rating >= 4;
    }

    if (reviewStar === 'neutral') {
        return rating >= 3 && rating < 4;
    }

    if (reviewStar === 'negative') {
        return rating < 3;
    }

    // Legacy alias for older clients.
    if (reviewStar === 'critical') {
        return rating < 3;
    }

    return true;
}

function sortReviews(reviews: WalmartReviewItem[], reviewSortBy: WalmartReviewSortBy): WalmartReviewItem[] {
    const indexed = reviews.map((review, index) => ({ review, index }));

    indexed.sort((left, right) => {
        if (reviewSortBy === 'relevant' || reviewSortBy === 'helpful') {
            const helpfulDelta = (right.review.helpfulVotes || 0) - (left.review.helpfulVotes || 0);
            if (helpfulDelta !== 0) {
                return helpfulDelta;
            }
            return left.index - right.index;
        }

        const leftDate = parseDateValue(left.review.date);
        const rightDate = parseDateValue(right.review.date);
        if (leftDate !== null && rightDate !== null && rightDate !== leftDate) {
            return rightDate - leftDate;
        }

        if (leftDate === null && rightDate !== null) {
            return 1;
        }
        if (leftDate !== null && rightDate === null) {
            return -1;
        }

        return left.index - right.index;
    });

    return indexed.map((entry) => entry.review);
}

function isSchemaType(item: Record<string, unknown>, schemaType: string): boolean {
    const expected = schemaType.toLowerCase();
    const type = item['@type'];
    const list = Array.isArray(type) ? type : [type];

    return list.some((entry) => typeof entry === 'string' && entry.toLowerCase() === expected);
}

function toReviewRecordList(value: unknown): Record<string, unknown>[] {
    if (!value) {
        return [];
    }

    if (Array.isArray(value)) {
        return value.flatMap((item) => toReviewRecordList(item));
    }

    const record = asRecord(value);
    return record ? [record] : [];
}

function parseSchemaReview(
    rawReview: Record<string, unknown>,
    pageUrl: string,
    host: string
): WalmartReviewItem | null {
    const reviewAuthor = asRecord(rawReview.author);
    const reviewRating = asRecord(rawReview.reviewRating);
    const reviewUrl = toAbsoluteUrl(asString(rawReview.url), pageUrl, host);
    const reviewId =
        parseReviewIdFromUrl(reviewUrl) ||
        cleanText(asString(rawReview.identifier));

    const review: WalmartReviewItem = {
        id: reviewId,
        url: reviewUrl,
        title: asString(rawReview.name),
        rating: parseRating(asString(reviewRating?.ratingValue) || asString(rawReview.reviewRating)),
        author: asString(reviewAuthor?.name) || asString(rawReview.author),
        date: asString(rawReview.datePublished),
        country: null,
        verifiedPurchase: false,
        variation: null,
        helpfulVotes: parseInteger(asString(rawReview.upvoteCount) || asString(rawReview.interactionCount)),
        text: asString(rawReview.reviewBody),
    };

    if (!review.id && !review.title && !review.text && !review.author) {
        return null;
    }

    return review;
}

function parseDomReviews(document: Document, pageUrl: string, host: string): WalmartReviewItem[] {
    const blocks = Array.from(document.querySelectorAll(REVIEW_BLOCK_SELECTORS.join(',')));

    return blocks.map((block) => {
        const linkNode = selectFirstFromRoot(block, REVIEW_LINK_SELECTORS);
        const link = toAbsoluteUrl(linkNode?.getAttribute('href') || null, pageUrl, host);
        const blockId =
            cleanText(block.getAttribute('data-review-id')) ||
            cleanText(block.getAttribute('id')) ||
            null;
        const ratingText =
            selectTextFromRoot(block, REVIEW_RATING_SELECTORS) ||
            selectAttributeFromRoot(block, REVIEW_RATING_SELECTORS, 'aria-label') ||
            selectAttributeFromRoot(block, REVIEW_RATING_SELECTORS, 'title');
        const fullText = cleanText(block.textContent)?.toLowerCase() || '';
        const verifiedPurchase =
            Boolean(selectTextFromRoot(block, REVIEW_VERIFIED_SELECTORS)) ||
            fullText.includes('verified purchase');

        return {
            id: blockId || parseReviewIdFromUrl(link),
            url: link,
            title: selectTextFromRoot(block, REVIEW_TITLE_SELECTORS),
            rating: parseRating(ratingText),
            author: selectTextFromRoot(block, REVIEW_AUTHOR_SELECTORS),
            date:
                selectTextFromRoot(block, REVIEW_DATE_SELECTORS) ||
                selectAttributeFromRoot(block, REVIEW_DATE_SELECTORS, 'datetime'),
            country: null,
            verifiedPurchase,
            variation: null,
            helpfulVotes: parseInteger(selectTextFromRoot(block, REVIEW_HELPFUL_SELECTORS)),
            text: selectTextFromRoot(block, REVIEW_TEXT_SELECTORS),
        } satisfies WalmartReviewItem;
    });
}

export class WalmartServiceError extends Error {
    public readonly code: string;
    public readonly statusCode: number;

    constructor(message: string, code: string, statusCode = 500) {
        super(message);
        this.name = 'WalmartServiceError';
        this.code = code;
        this.statusCode = statusCode;
    }
}

class WalmartService {
    public isConfigured(): boolean {
        return true;
    }

    public getStatus() {
        return {
            status: 'online',
            service: 'walmart-catalog-inspector-v1',
            defaults: {
                includeReviews: true,
                reviewPageLimit: DEFAULT_REVIEW_PAGE_LIMIT,
                reviewSortBy: DEFAULT_REVIEW_SORT,
                reviewStar: DEFAULT_REVIEW_STAR,
            },
            notes: [
                'Walmart pages can trigger anti-bot checks depending on IP/session trust and request pacing.',
                'Review extraction reads directly from the fetched product page HTML (no extra review-page crawl).',
            ],
        };
    }

    public async inspect(input: WalmartInspectInput): Promise<WalmartInspectResult> {
        const targetUrl = resolveInputUrl(input.input);

        if (!targetUrl) {
            throw new WalmartServiceError(
                'Input must be a Walmart URL/path or a valid numeric product ID.',
                'INVALID_WALMART_INPUT',
                400
            );
        }

        const reviewPageLimit = Math.max(
            1,
            Math.min(input.reviewPageLimit || DEFAULT_REVIEW_PAGE_LIMIT, MAX_REVIEW_PAGE_LIMIT)
        );
        const reviewStar = input.reviewStar || DEFAULT_REVIEW_STAR;
        const reviewSortBy = input.reviewSortBy || DEFAULT_REVIEW_SORT;
        const requestTimeoutMs = normalizeTimeoutMs(input.timeout);
        const sessionKey = `walmart:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;

        let scrapeResult: Awaited<ReturnType<typeof scraperHttpService.scrape>> | null = null;
        let detectionSignals: string[] = [];

        for (let attempt = 1; attempt <= PRODUCT_BLOCK_RETRY_ATTEMPTS; attempt += 1) {
            const candidateResult = await scraperHttpService.scrape(targetUrl, {
                jsEnabled: true,
                timeout: requestTimeoutMs,
                stealth: input.stealth,
                screenshotOnError: false,
                sessionKey,
                userAgentJitter: true,
                minDelayMs: WALMART_HTTP_DELAY_MIN_MS,
                maxDelayMs: WALMART_HTTP_DELAY_MAX_MS,
            });

            const antiBot = antiBotDetectionService.detect('walmart', candidateResult.url, candidateResult.html);
            detectionSignals = antiBot.matchedSignals;

            if (!antiBot.blocked) {
                scrapeResult = candidateResult;
                break;
            }

            if (attempt < PRODUCT_BLOCK_RETRY_ATTEMPTS) {
                continue;
            }

            const signalSummary = antiBot.matchedSignals.length > 0
                ? ` Signals: ${antiBot.matchedSignals.join(', ')}`
                : '';
            throw new WalmartServiceError(
                `Walmart blocked the inspection request. Try a warmed session, backoff, or proxy.${signalSummary}`,
                'WALMART_BLOCKED',
                429
            );
        }

        if (!scrapeResult) {
            const signalSummary = detectionSignals.length > 0
                ? ` Signals: ${detectionSignals.join(', ')}`
                : '';
            throw new WalmartServiceError(
                `Walmart blocked the inspection request. Try a warmed session, backoff, or proxy.${signalSummary}`,
                'WALMART_BLOCKED',
                429
            );
        }

        const resolvedHost = (() => {
            try {
                return new URL(scrapeResult.url).hostname.toLowerCase();
            } catch {
                return DEFAULT_WALMART_HOST;
            }
        })();

        const document = createDom(scrapeResult.html, scrapeResult.url);
        const schemaItems = readJsonLdObjects(document);
        const product = findFirstBySchemaType(schemaItems, 'Product');
        const productGroup = findFirstBySchemaType(schemaItems, 'ProductGroup');
        const offer =
            asRecord(product?.offers) ||
            asRecord(productGroup?.offers) ||
            findFirstBySchemaType(schemaItems, 'Offer');
        const aggregateRating =
            asRecord(product?.aggregateRating) ||
            asRecord(productGroup?.aggregateRating) ||
            findFirstBySchemaType(schemaItems, 'AggregateRating');

        const schemaPrice = asString(offer?.price);
        const schemaCurrency = asString(offer?.priceCurrency);
        const schemaSeller = asString(asRecord(offer?.seller)?.name);
        const schemaBrand =
            asString(asRecord(product?.brand)?.name) ||
            asString(product?.brand) ||
            asString(asRecord(productGroup?.brand)?.name) ||
            asString(productGroup?.brand);
        const schemaDescription = asString(product?.description) || asString(productGroup?.description);
        const schemaReviewCount =
            asString(aggregateRating?.reviewCount) ||
            asString(aggregateRating?.ratingCount);

        const priceText =
            selectText(document, PRICE_SELECTORS) ||
            cleanText(schemaCurrency && schemaPrice ? `${schemaCurrency} ${schemaPrice}` : schemaPrice);

        const seller =
            selectText(document, SELLER_SELECTORS) ||
            schemaSeller ||
            schemaBrand;

        const canonicalUrl = toAbsoluteUrl(
            selectAttribute(document, ['link[rel="canonical"]'], 'href'),
            scrapeResult.url,
            resolvedHost
        );
        const sellerProfileUrl = toAbsoluteUrl(
            selectAttribute(document, SELLER_PROFILE_SELECTORS, 'href'),
            scrapeResult.url,
            resolvedHost
        );

        const description =
            selectAttribute(document, DESCRIPTION_SELECTORS, 'content') ||
            selectText(document, DESCRIPTION_SELECTORS) ||
            schemaDescription;
        const features = dedupeStrings([
            ...parseFeatureBullets(document),
            description,
        ]);

        const domReviews = parseDomReviews(document, scrapeResult.url, resolvedHost);
        const schemaReviewRecords = [
            ...toReviewRecordList(product?.review),
            ...toReviewRecordList(productGroup?.review),
            ...schemaItems
                .filter((item) => isSchemaType(item, 'Product') || isSchemaType(item, 'ProductGroup'))
                .flatMap((item) => toReviewRecordList(item.review)),
        ];
        const parsedSchemaReviews = schemaReviewRecords
            .map((review) => parseSchemaReview(review, scrapeResult.url, resolvedHost))
            .filter((review): review is WalmartReviewItem => Boolean(review));
        const standaloneSchemaReviews = schemaItems
            .filter((item) => isSchemaType(item, 'Review'))
            .map((review) => parseSchemaReview(review, scrapeResult.url, resolvedHost))
            .filter((review): review is WalmartReviewItem => Boolean(review));
        const reviewPool = sortReviews(
            [...domReviews, ...parsedSchemaReviews, ...standaloneSchemaReviews],
            reviewSortBy
        );
        const reviewItemLimit = Math.max(1, Math.min(reviewPageLimit * 10, MAX_REVIEW_PAGE_LIMIT));
        const reviews: WalmartReviewItem[] = [];
        const seenReviewKeys = new Set<string>();

        if (input.includeReviews !== false) {
            for (const review of reviewPool) {
                if (!matchReviewStarSelection(review, reviewStar)) {
                    continue;
                }

                const key = buildReviewKey(review);
                if (seenReviewKeys.has(key)) {
                    continue;
                }
                seenReviewKeys.add(key);

                reviews.push(review);

                if (input.reviewStopAtId && review.id === input.reviewStopAtId) {
                    break;
                }

                if (reviews.length >= reviewItemLimit) {
                    break;
                }
            }
        }

        const reviewsCount =
            parseInteger(schemaReviewCount) ||
            parseInteger(selectText(document, REVIEW_COUNT_SELECTORS)) ||
            (reviews.length > 0 ? reviews.length : null);
        const productId = extractProductId(scrapeResult.url);
        const resolvedPriceValue = parseNumericPrice(priceText || schemaPrice);
        const resolvedCurrencyCode =
            parseCurrency(schemaCurrency || priceText) ||
            currencyFromWalmartHost(resolvedHost);
        const resolvedBrand =
            selectText(document, BRAND_SELECTORS) ||
            parseBrandFromSpecifications(document) ||
            schemaBrand;

        return {
            input: input.input,
            title: selectText(document, TITLE_SELECTORS) || asString(product?.name) || asString(productGroup?.name),
            url: canonicalUrl || scrapeResult.url,
            asin: productId,
            brand: resolvedBrand,
            price: {
                value: resolvedPriceValue,
                currency: resolvePriceCurrencySymbol(priceText, resolvedCurrencyCode),
            },
            reviewsCount,
            features,
            seller: {
                name: seller,
                id: extractSellerIdFromUrl(sellerProfileUrl),
                url: sellerProfileUrl,
            },
            reviews,
        };
    }
}

export const walmartService = new WalmartService();
