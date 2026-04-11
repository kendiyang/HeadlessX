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

export type EbayReviewSortBy = 'recent' | 'relevant' | 'helpful';
export type EbayReviewStar = 'all' | 'positive' | 'neutral' | 'negative' | 'critical';

export interface EbayInspectInput {
    input: string;
    includeReviews?: boolean;
    reviewPageLimit?: number;
    reviewSortBy?: EbayReviewSortBy;
    reviewStar?: EbayReviewStar;
    reviewerType?: string;
    reviewStopAtId?: string;
    timeout?: number;
    stealth?: boolean;
}

export interface EbayReviewItem {
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

export interface EbayInspectResult {
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
    reviews: EbayReviewItem[];
}

const DEFAULT_EBAY_HOST = 'www.ebay.com';
const DEFAULT_REVIEW_STAR: EbayReviewStar = 'all';
const DEFAULT_REVIEW_SORT: EbayReviewSortBy = 'recent';
const DEFAULT_REVIEW_PAGE_LIMIT = 1;
const MAX_REVIEW_PAGE_LIMIT = 5000;
const DEFAULT_SCRAPE_TIMEOUT_MS = 30_000;
const PRODUCT_BLOCK_RETRY_ATTEMPTS = 2;
const EBAY_HTTP_DELAY_MIN_MS = 100;
const EBAY_HTTP_DELAY_MAX_MS = 500;

const EBAY_HOST_PATTERN =
    /^(?:[a-z0-9-]+\.)*ebay\.(?:com|ca|com\.au|co\.uk|de|fr|it|es|nl|be|at|ch|ie|pl|com\.hk|com\.sg|ph)$/i;

const EBAY_SUFFIX_CURRENCY_MAP: Record<string, string> = {
    com: 'USD',
    ca: 'CAD',
    'com.au': 'AUD',
    'co.uk': 'GBP',
    de: 'EUR',
    fr: 'EUR',
    it: 'EUR',
    es: 'EUR',
    nl: 'EUR',
    be: 'EUR',
    at: 'EUR',
    ch: 'CHF',
    ie: 'EUR',
    pl: 'PLN',
    'com.hk': 'HKD',
    'com.sg': 'SGD',
    ph: 'PHP',
};

const CURRENCY_CODE_SYMBOL_MAP: Record<string, string> = {
    USD: '$',
    CAD: '$',
    AUD: '$',
    SGD: '$',
    HKD: '$',
    PHP: 'PHP',
    EUR: '€',
    GBP: '£',
    CHF: 'CHF',
    PLN: 'zl',
    JPY: '¥',
};

const TITLE_SELECTORS = [
    'h1.x-item-title__mainTitle span',
    '#itemTitle',
    'h1[itemprop="name"]',
] as const;

const BRAND_SELECTORS = [
    '[data-testid="ux-labels-values"] [itemprop="brand"]',
    '.ux-labels-values__values-content [itemprop="brand"]',
    '.ux-labels-values--brand .ux-labels-values__values-content',
] as const;

const SUBTITLE_SELECTORS = [
    '.x-item-title__subTitle span',
    '.it-ttl',
] as const;

const CONDITION_SELECTORS = [
    '.x-item-condition-text span',
    '#vi-itm-cond',
] as const;

const SELLER_SELECTORS = [
    '.x-sellercard-atf__info__about-seller a',
    '#RightSummaryPanel .mbg-nw',
] as const;

const SELLER_PROFILE_SELECTORS = [
    '.x-sellercard-atf__info__about-seller a[href]',
    '#RightSummaryPanel .mbg-nw[href]',
    'a[href*="/usr/"]',
    'a[href*="seller="]',
] as const;

const PRICE_SELECTORS = [
    '.x-price-primary span',
    '#prcIsum',
    '#mm-saleDscPrc',
    '[itemprop="price"]',
] as const;

const AVAILABILITY_SELECTORS = [
    '.x-quantity__availability',
    '#qtySubTxt',
] as const;

const DESCRIPTION_SELECTORS = [
    'meta[name="description"]',
    '[itemprop="description"]',
    '.x-item-description-child',
    '#viTabs_0_is',
] as const;

const FEATURE_BULLET_SELECTORS = [
    '.ux-layout-section__item ul li',
    '.x-about-this-item ul li',
    '#viTabs_0_is ul li',
    '#vi-desc-maincntr ul li',
] as const;

const IMAGE_SELECTORS = [
    'meta[property="og:image"]',
    '#icImg',
    '.ux-image-carousel-item img',
] as const;

const REVIEW_BLOCK_SELECTORS = [
    '#rwid .review-item',
    '[data-testid="x-review-section"] [data-testid="review-item"]',
    '[data-testid="x-review-section"] .review-item',
    '#reviews .review-item',
    '[itemprop="review"]',
] as const;

const REVIEW_LINK_SELECTORS = [
    'a.review-item-title',
    'a[data-testid="review-title-link"]',
    'a[href*="/r/"]',
] as const;

const REVIEW_TITLE_SELECTORS = [
    '.review-item-title',
    '[data-testid="review-title"]',
    '[itemprop="name"]',
] as const;

const REVIEW_TEXT_SELECTORS = [
    '.review-item-content',
    '[data-testid="review-text"]',
    '[itemprop="reviewBody"]',
] as const;

const REVIEW_AUTHOR_SELECTORS = [
    '.review-item-author',
    '[data-testid="review-author"]',
    '[itemprop="author"]',
] as const;

const REVIEW_DATE_SELECTORS = [
    '.review-item-date',
    '[data-testid="review-date"]',
    '[itemprop="datePublished"]',
] as const;

const REVIEW_RATING_SELECTORS = [
    '.ebay-review-start-rating',
    '[data-testid="review-star-rating"]',
    '[itemprop="reviewRating"]',
] as const;

const REVIEW_HELPFUL_SELECTORS = [
    '.review-item-helpful-count',
    '[data-testid="review-helpful-count"]',
] as const;

const REVIEW_VERIFIED_SELECTORS = [
    '.review-item-verified',
    '[data-testid="review-verified"]',
] as const;

const REVIEW_COUNT_SELECTORS = [
    '#rwid h2',
    '[data-testid="x-review-section"] h2',
    '[data-testid="x-star-rating"]',
] as const;

const SELLER_FEEDBACK_SECTION_SELECTORS = [
    'ul.fdbk-detail-list__cards',
    '.x-feedback-detail-list',
    '[data-testid="x-feedback-detail-list"]',
    '.fdbk-detail-list',
    '[data-testid="x-feedback-detail-seller-rating"]',
    '.x-feedback-detail-seller-rating',
    '#seller-feedback',
    '[id*="seller-feedback"]',
    '[class*="seller-feedback"]',
    '[data-testid*="seller-feedback"]',
    '[id*="sellerFeedback"]',
    '[class*="sellerFeedback"]',
    '[data-testid*="sellerFeedback"]',
] as const;

const SELLER_FEEDBACK_BLOCK_SELECTORS = [
    'li.fdbk-container[data-testid="feedback-cards"]',
    'li.fdbk-container',
    'li[data-testid="feedback-cards"]',
    '.fdbk-container',
    '.feedback-item',
    '[data-feedback-id]',
    '[data-testid*="feedback-item"]',
    '[class*="feedback-item"]',
    '.review-item',
    'li',
    'article',
] as const;

const SELLER_FEEDBACK_LINK_SELECTORS = [
    '.fdbk-container__details__item-link a',
    '.fdbk-container__details__top a',
    'a.feedback-item-title',
    'a[href*="/fdbk/"]',
    'a[href*="feedback"]',
    'a[href*="/usr/"]',
] as const;

const SELLER_FEEDBACK_TITLE_SELECTORS = [
    '.fdbk-container__details__item-link a',
    '.fdbk-container__details__item-link span',
    '.fdbk-container__details__top a',
    '.feedback-item-title',
    '[data-testid*="feedback-title"]',
    '[class*="feedback-title"]',
    'a[href*="/fdbk/"]',
    'a[href*="feedback"]',
] as const;

const SELLER_FEEDBACK_TEXT_SELECTORS = [
    '.fdbk-container__details__comment span',
    '.fdbk-container__details__comment',
    '.feedback-item-comment',
    '.feedback-comment',
    '[data-testid*="feedback-comment"]',
    '[data-testid*="feedback-text"]',
    '[class*="feedback-comment"]',
    '[class*="feedback-text"]',
    'blockquote',
    'p',
] as const;

const SELLER_FEEDBACK_AUTHOR_SELECTORS = [
    '.fdbk-container__details__info__username > span:first-child',
    '.fdbk-container__details__info__username',
    '.feedback-item-author',
    '.feedback-author',
    '[data-testid*="feedback-author"]',
    '[class*="feedback-author"]',
    'a[href*="/usr/"]',
] as const;

const SELLER_FEEDBACK_DATE_SELECTORS = [
    '.fdbk-container__details__info__divide__time span',
    '.fdbk-container__details__info__divide__time',
    'time',
    '.feedback-item-date',
    '.feedback-date',
    '[data-testid*="feedback-date"]',
    '[datetime]',
] as const;

const SELLER_FEEDBACK_RATING_SELECTORS = [
    '.fdbk-container__details__info__icon [data-test-id]',
    '.fdbk-container__details__info__icon [data-test-type]',
    '.fdbk-container__details__info__icon [aria-label]',
    '.fdbk-container__details__info__icon .icon--feedback-positive',
    '.fdbk-container__details__info__icon .icon--feedback-neutral',
    '.fdbk-container__details__info__icon .icon--feedback-negative',
    '.feedback-item-rating',
    '.feedback-rating',
    '[data-testid*="feedback-rating"]',
    '[class*="feedback-rating"]',
    '[aria-label*="out of 5"]',
    '.ebay-review-start-rating',
] as const;

const SELLER_FEEDBACK_HELPFUL_SELECTORS = [
    '.fdbk-container__details__helpful-count',
    '.feedback-item-helpful-count',
    '.feedback-helpful-count',
    '[data-testid*="feedback-helpful"]',
] as const;

const SELLER_FEEDBACK_VERIFIED_SELECTORS = [
    '.fdbk-container__details__verified__purchase span',
    '.fdbk-container__details__verified__purchase',
    '.feedback-item-verified',
    '.feedback-verified',
    '[data-testid*="feedback-verified"]',
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
    return dedupeStrings(
        (Array.from(document.querySelectorAll(FEATURE_BULLET_SELECTORS.join(','))) as Element[])
            .map((node) => cleanText(node.textContent))
            .filter((value) => Boolean(value && value.length > 2))
    );
}

function getEbaySuffixFromHost(host: string): string | null {
    const normalized = host.trim().toLowerCase();
    const suffixes = Object.keys(EBAY_SUFFIX_CURRENCY_MAP).sort((left, right) => right.length - left.length);

    for (const suffix of suffixes) {
        if (normalized === `ebay.${suffix}` || normalized.endsWith(`.ebay.${suffix}`)) {
            return suffix;
        }
    }

    return null;
}

function currencyFromEbayHost(host: string): string | null {
    const suffix = getEbaySuffixFromHost(host);
    return suffix ? EBAY_SUFFIX_CURRENCY_MAP[suffix] || null : null;
}

function detectCurrencySymbol(value: string | null | undefined): string | null {
    const normalized = cleanText(value);
    if (!normalized) {
        return null;
    }

    const qualifiedDollar = normalized.match(/(CA\$|A\$|S\$|HK\$)/i);
    if (qualifiedDollar?.[1]) {
        return qualifiedDollar[1].toUpperCase();
    }

    const symbol = normalized.match(/[$€£¥]/);
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

function extractItemId(url: string): string | null {
    const fromPath = url.match(/\/itm\/(?:[^/]+\/)?(\d{9,20})(?:[/?#]|$)/i)?.[1];
    if (fromPath) {
        return fromPath;
    }

    return url.match(/[?&]item=([0-9]{9,20})(?:[&#]|$)/i)?.[1] || null;
}

function resolveInputUrl(input: string): string | null {
    const normalized = cleanText(input);
    if (!normalized) {
        return null;
    }

    if (/^\d{9,20}$/.test(normalized)) {
        return `https://${DEFAULT_EBAY_HOST}/itm/${normalized}`;
    }

    if (normalized.startsWith('/')) {
        const itemId = extractItemId(normalized);
        if (itemId) {
            return `https://${DEFAULT_EBAY_HOST}/itm/${itemId}`;
        }
        return `https://${DEFAULT_EBAY_HOST}${normalized}`;
    }

    let candidateUrl: URL | null = null;

    if (/^https?:\/\//i.test(normalized)) {
        try {
            candidateUrl = new URL(normalized);
        } catch {
            return null;
        }
    } else if (/ebay\./i.test(normalized)) {
        try {
            candidateUrl = new URL(`https://${normalized.replace(/^\/+/, '')}`);
        } catch {
            return null;
        }
    }

    if (!candidateUrl || !EBAY_HOST_PATTERN.test(candidateUrl.hostname)) {
        return null;
    }

    const itemId = extractItemId(candidateUrl.toString());
    if (itemId) {
        return `https://${candidateUrl.hostname}/itm/${itemId}`;
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

    const pathMatch = normalized.match(/\/(?:r|review)\/([A-Za-z0-9-]{6,40})(?:[/?#]|$)/i);
    if (pathMatch?.[1]) {
        return pathMatch[1];
    }

    const queryMatch = normalized.match(/[?&]reviewid=([A-Za-z0-9-]{6,40})(?:[&#]|$)/i);
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

    const pathMatch = normalized.match(/\/usr\/([^/?#]+)/i);
    if (pathMatch?.[1]) {
        return pathMatch[1];
    }

    const queryMatch = normalized.match(/[?&]seller=([^&#]+)/i);
    if (queryMatch?.[1]) {
        return queryMatch[1];
    }

    return null;
}

function buildReviewKey(review: EbayReviewItem): string {
    return review.id || review.url || `${review.author || 'unknown'}|${review.date || 'unknown'}|${review.title || 'untitled'}`;
}

function matchReviewStarSelection(review: EbayReviewItem, reviewStar: EbayReviewStar): boolean {
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

function sortReviews(reviews: EbayReviewItem[], reviewSortBy: EbayReviewSortBy): EbayReviewItem[] {
    const indexed = reviews.map((review, index) => ({
        review,
        index,
    }));

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
): EbayReviewItem | null {
    const reviewAuthor = asRecord(rawReview.author);
    const reviewRating = asRecord(rawReview.reviewRating);
    const reviewUrl = toAbsoluteUrl(asString(rawReview.url), pageUrl, host);
    const reviewId = parseReviewIdFromUrl(reviewUrl);

    const review: EbayReviewItem = {
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

function parseSellerFeedbackRating(block: Element): number | null {
    const explicitType =
        cleanText(selectAttributeFromRoot(block, SELLER_FEEDBACK_RATING_SELECTORS, 'data-test-type'))?.toLowerCase() ||
        cleanText(selectAttributeFromRoot(block, SELLER_FEEDBACK_RATING_SELECTORS, 'data-testid'))?.toLowerCase() ||
        null;

    if (explicitType) {
        if (explicitType.includes('positive')) {
            return 5;
        }
        if (explicitType.includes('neutral')) {
            return 3;
        }
        if (explicitType.includes('negative')) {
            return 1;
        }
    }

    const ratingLabel =
        selectTextFromRoot(block, SELLER_FEEDBACK_RATING_SELECTORS) ||
        selectAttributeFromRoot(block, SELLER_FEEDBACK_RATING_SELECTORS, 'aria-label') ||
        selectAttributeFromRoot(block, SELLER_FEEDBACK_RATING_SELECTORS, 'title');
    const parsedNumeric = parseRating(ratingLabel);
    if (parsedNumeric !== null) {
        return parsedNumeric;
    }

    const normalizedLabel = cleanText(ratingLabel)?.toLowerCase() || '';
    if (normalizedLabel.includes('positive')) {
        return 5;
    }
    if (normalizedLabel.includes('neutral')) {
        return 3;
    }
    if (normalizedLabel.includes('negative')) {
        return 1;
    }

    return null;
}

function findSellerFeedbackSections(document: Document): Element[] {
    const sections: Element[] = [];
    const seen = new Set<Element>();
    const append = (node: Element | null) => {
        if (!node || seen.has(node)) {
            return;
        }
        seen.add(node);
        sections.push(node);
    };

    for (const selector of SELLER_FEEDBACK_SECTION_SELECTORS) {
        try {
            const matches = Array.from(document.querySelectorAll(selector));
            matches.forEach((node) => append(node));
        } catch {
            // Ignore invalid selector.
        }
    }

    const headingCandidates = Array.from(document.querySelectorAll('h1, h2, h3, h4, span, div, strong, p'));
    for (const node of headingCandidates) {
        const text = cleanText(node.textContent)?.toLowerCase() || '';
        if (!text || !text.includes('seller feedback') || text.length > 100) {
            continue;
        }
        append(node.closest('section, article, aside, div') || node);
    }

    return sections;
}

function parseSellerFeedbackReviews(document: Document, pageUrl: string, host: string): EbayReviewItem[] {
    const sections = findSellerFeedbackSections(document);
    const reviews: EbayReviewItem[] = [];

    for (const section of sections) {
        const blocks: Element[] = [];
        const seenBlocks = new Set<Element>();

        for (const selector of SELLER_FEEDBACK_BLOCK_SELECTORS) {
            try {
                const matches = Array.from(section.querySelectorAll(selector));
                for (const match of matches) {
                    if (seenBlocks.has(match)) {
                        continue;
                    }
                    seenBlocks.add(match);
                    blocks.push(match);
                }
            } catch {
                // Ignore invalid selector.
            }
        }

        for (const block of blocks) {
            const linkNode = selectFirstFromRoot(block, SELLER_FEEDBACK_LINK_SELECTORS);
            const link = toAbsoluteUrl(linkNode?.getAttribute('href') || null, pageUrl, host);
            const blockId =
                cleanText(block.getAttribute('data-feedback-id')) ||
                cleanText(block.getAttribute('data-review-id')) ||
                cleanText(block.getAttribute('id')) ||
                null;
            const fullText = cleanText(block.textContent) || '';
            const fullTextLower = fullText.toLowerCase();
            const authorRaw = selectTextFromRoot(block, SELLER_FEEDBACK_AUTHOR_SELECTORS);
            const author = authorRaw?.replace(/\s*-\s*feedback left by buyer\.?$/i, '') || authorRaw;
            const review = {
                id: blockId || parseReviewIdFromUrl(link),
                url: link,
                title: selectTextFromRoot(block, SELLER_FEEDBACK_TITLE_SELECTORS),
                rating: parseSellerFeedbackRating(block),
                author,
                date:
                    selectTextFromRoot(block, SELLER_FEEDBACK_DATE_SELECTORS) ||
                    selectAttributeFromRoot(block, SELLER_FEEDBACK_DATE_SELECTORS, 'datetime'),
                country: null,
                verifiedPurchase:
                    Boolean(selectTextFromRoot(block, SELLER_FEEDBACK_VERIFIED_SELECTORS)) ||
                    fullTextLower.includes('verified purchase'),
                variation: null,
                helpfulVotes: parseInteger(selectTextFromRoot(block, SELLER_FEEDBACK_HELPFUL_SELECTORS)),
                text: selectTextFromRoot(block, SELLER_FEEDBACK_TEXT_SELECTORS),
            } satisfies EbayReviewItem;

            if (!review.id && !review.title && !review.text && !review.author && !review.date && !review.rating) {
                continue;
            }

            if (
                !review.text &&
                !review.title &&
                !review.rating &&
                !review.author &&
                fullTextLower.includes('seller feedback') &&
                fullText.length <= 80
            ) {
                continue;
            }

            reviews.push(review);
        }
    }

    return reviews;
}

function parseDomReviews(document: Document, pageUrl: string, host: string): EbayReviewItem[] {
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
        const verifiedPurchase = Boolean(selectTextFromRoot(block, REVIEW_VERIFIED_SELECTORS))
            || fullText.includes('verified purchase');

        return {
            id: blockId || parseReviewIdFromUrl(link),
            url: link,
            title: selectTextFromRoot(block, REVIEW_TITLE_SELECTORS),
            rating: parseRating(ratingText),
            author: selectTextFromRoot(block, REVIEW_AUTHOR_SELECTORS),
            date: selectTextFromRoot(block, REVIEW_DATE_SELECTORS),
            country: null,
            verifiedPurchase,
            variation: null,
            helpfulVotes: parseInteger(selectTextFromRoot(block, REVIEW_HELPFUL_SELECTORS)),
            text: selectTextFromRoot(block, REVIEW_TEXT_SELECTORS),
        } satisfies EbayReviewItem;
    });
}

export class EbayServiceError extends Error {
    public readonly code: string;
    public readonly statusCode: number;

    constructor(message: string, code: string, statusCode = 500) {
        super(message);
        this.name = 'EbayServiceError';
        this.code = code;
        this.statusCode = statusCode;
    }
}

class EbayService {
    public isConfigured(): boolean {
        return true;
    }

    public getStatus() {
        return {
            status: 'online',
            service: 'ebay-catalog-inspector-v1',
            defaults: {
                includeReviews: true,
                reviewPageLimit: DEFAULT_REVIEW_PAGE_LIMIT,
                reviewSortBy: DEFAULT_REVIEW_SORT,
                reviewStar: DEFAULT_REVIEW_STAR,
            },
            notes: [
                'eBay pages can trigger anti-bot checks depending on IP/session trust and request pacing.',
                'Review extraction reads directly from the fetched product page HTML (no extra review-page crawl).',
            ],
        };
    }

    public async inspect(input: EbayInspectInput): Promise<EbayInspectResult> {
        const targetUrl = resolveInputUrl(input.input);

        if (!targetUrl) {
            throw new EbayServiceError(
                'Input must be an eBay URL/path or a valid numeric item ID.',
                'INVALID_EBAY_INPUT',
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
        const sessionKey = `ebay:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;

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
                minDelayMs: EBAY_HTTP_DELAY_MIN_MS,
                maxDelayMs: EBAY_HTTP_DELAY_MAX_MS,
            });

            const antiBot = antiBotDetectionService.detect('ebay', candidateResult.url, candidateResult.html);
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
            throw new EbayServiceError(
                `eBay blocked the inspection request. Try a warmed session, backoff, or proxy.${signalSummary}`,
                'EBAY_BLOCKED',
                429
            );
        }

        if (!scrapeResult) {
            const signalSummary = detectionSignals.length > 0
                ? ` Signals: ${detectionSignals.join(', ')}`
                : '';
            throw new EbayServiceError(
                `eBay blocked the inspection request. Try a warmed session, backoff, or proxy.${signalSummary}`,
                'EBAY_BLOCKED',
                429
            );
        }

        const resolvedHost = (() => {
            try {
                return new URL(scrapeResult.url).hostname.toLowerCase();
            } catch {
                return DEFAULT_EBAY_HOST;
            }
        })();

        const document = createDom(scrapeResult.html, scrapeResult.url);
        const schemaItems = readJsonLdObjects(document);
        const product = findFirstBySchemaType(schemaItems, 'Product');
        const offer = asRecord(product?.offers) || findFirstBySchemaType(schemaItems, 'Offer');
        const aggregateRating = asRecord(product?.aggregateRating) || findFirstBySchemaType(schemaItems, 'AggregateRating');

        const schemaPrice = asString(offer?.price);
        const schemaCurrency = asString(offer?.priceCurrency);
        const schemaAvailability = asString(offer?.availability);
        const schemaSeller = asString(asRecord(offer?.seller)?.name);
        const schemaBrand = asString(asRecord(product?.brand)?.name) || asString(product?.brand);
        const schemaDescription = asString(product?.description);
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

        const imageFromSchema = Array.isArray(product?.image)
            ? asString(product?.image[0])
            : asString(product?.image);
        const description =
            selectAttribute(document, DESCRIPTION_SELECTORS, 'content') ||
            selectText(document, DESCRIPTION_SELECTORS) ||
            schemaDescription;
        const features = dedupeStrings([
            ...parseFeatureBullets(document),
            description,
        ]);

        const sellerFeedbackReviews = parseSellerFeedbackReviews(document, scrapeResult.url, resolvedHost);
        const domReviews = parseDomReviews(document, scrapeResult.url, resolvedHost);
        const productSchemaReviews = toReviewRecordList(product?.review)
            .map((review) => parseSchemaReview(review, scrapeResult.url, resolvedHost))
            .filter((review): review is EbayReviewItem => Boolean(review));
        const standaloneSchemaReviews = schemaItems
            .filter((item) => isSchemaType(item, 'Review'))
            .map((review) => parseSchemaReview(review, scrapeResult.url, resolvedHost))
            .filter((review): review is EbayReviewItem => Boolean(review));
        const reviewPool = sortReviews(
            sellerFeedbackReviews.length > 0
                ? sellerFeedbackReviews
                : [...domReviews, ...productSchemaReviews, ...standaloneSchemaReviews],
            reviewSortBy
        );
        const reviewItemLimit = Math.max(1, Math.min(reviewPageLimit * 10, MAX_REVIEW_PAGE_LIMIT));
        const reviews: EbayReviewItem[] = [];
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
        const itemId = extractItemId(scrapeResult.url);
        const resolvedPriceValue = parseNumericPrice(priceText || schemaPrice);
        const resolvedCurrencyCode =
            parseCurrency(schemaCurrency || priceText) ||
            currencyFromEbayHost(resolvedHost);
        const resolvedBrand =
            selectText(document, BRAND_SELECTORS) ||
            schemaBrand;

        return {
            input: input.input,
            title: selectText(document, TITLE_SELECTORS) || asString(product?.name),
            url: canonicalUrl || scrapeResult.url,
            asin: itemId,
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

export const ebayService = new EbayService();
