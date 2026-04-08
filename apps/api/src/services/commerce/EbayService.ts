import {
    asRecord,
    asString,
    buildDiagnostics,
    cleanText,
    CommerceInspectInput,
    createDom,
    findFirstBySchemaType,
    parseCurrency,
    parseNumericPrice,
    readJsonLdObjects,
    resolveMarketplaceInputUrl,
    scrapeCommercePage,
    selectAttribute,
    selectText,
} from './CommerceInspectCore';

export interface EbayInspectInput extends CommerceInspectInput {
    marketplace?: string;
}

export interface EbayInspectResult {
    input: string;
    marketplace: {
        domain: string;
        host: string;
    };
    item: {
        itemId: string | null;
        url: string;
        canonicalUrl: string | null;
        title: string | null;
        subtitle: string | null;
        condition: string | null;
        seller: string | null;
        priceText: string | null;
        price: number | null;
        currency: string | null;
        availability: string | null;
        imageUrl: string | null;
        description: string | null;
    };
    diagnostics: {
        blocked: boolean;
        warnings: string[];
        crawledUrls: string[];
        antiBotSignals: string[];
        generatedAt: string;
    };
}

const DEFAULT_EBAY_HOST = 'www.ebay.com';
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

const TITLE_SELECTORS = [
    'h1.x-item-title__mainTitle span',
    '#itemTitle',
    'h1[itemprop="name"]',
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
] as const;

const IMAGE_SELECTORS = [
    'meta[property="og:image"]',
    '#icImg',
    '.ux-image-carousel-item img',
] as const;

function currencyFromEbayHost(host: string): string | null {
    const normalized = host.trim().toLowerCase();
    for (const [suffix, currency] of Object.entries(EBAY_SUFFIX_CURRENCY_MAP)) {
        if (normalized === `ebay.${suffix}` || normalized.endsWith(`.ebay.${suffix}`)) {
            return currency;
        }
    }

    return null;
}

function normalizeHost(marketplace?: string): string {
    const raw = marketplace?.trim().toLowerCase();
    if (!raw) {
        return DEFAULT_EBAY_HOST;
    }

    const cleaned = raw
        .replace(/^https?:\/\//i, '')
        .replace(/[/?#].*$/, '')
        .replace(/:\d+$/, '');
    if (EBAY_HOST_PATTERN.test(cleaned)) {
        return cleaned;
    }

    if (/^[a-z]{2}(?:\.[a-z]{2})?$/.test(cleaned) || cleaned === 'com' || cleaned === 'co.uk') {
        return `www.ebay.${cleaned}`;
    }

    throw new EbayServiceError(
        'Marketplace must be an eBay domain such as ebay.com or co.uk.',
        'INVALID_EBAY_MARKETPLACE',
        400
    );
}

function extractItemId(url: string): string | null {
    return url.match(/\/itm\/(?:[^/]+\/)?(\d{9,20})/i)?.[1] || null;
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
            notes: [
                'eBay pages can trigger anti-bot checks depending on IP/session trust.',
                'Use stable browser profiles and realistic pacing for better extraction reliability.',
            ],
        };
    }

    public async inspect(input: EbayInspectInput): Promise<EbayInspectResult> {
        const host = normalizeHost(input.marketplace);
        const targetUrl = resolveMarketplaceInputUrl(input.input, {
            defaultHost: host,
            hostPattern: EBAY_HOST_PATTERN,
            idPathBuilder: (value) => (/^\d{9,20}$/.test(value) ? `/itm/${value}` : null),
        });

        if (!targetUrl) {
            throw new EbayServiceError(
                'Input must be an eBay URL/path or a valid numeric item ID.',
                'INVALID_EBAY_INPUT',
                400
            );
        }

        const payload = await scrapeCommercePage('ebay', targetUrl, {
            timeout: input.timeout,
            stealth: input.stealth,
            waitForSelector: input.waitForSelector,
        });

        if (payload.detection.blocked) {
            const signalSummary = payload.detection.matchedSignals.length > 0
                ? ` Signals: ${payload.detection.matchedSignals.join(', ')}`
                : '';
            throw new EbayServiceError(
                `eBay blocked the inspection request. Try a warmed profile or proxy.${signalSummary}`,
                'EBAY_BLOCKED',
                429
            );
        }

        const document = createDom(payload.html, payload.url);
        const schemaItems = readJsonLdObjects(document);
        const product = findFirstBySchemaType(schemaItems, 'Product');
        const offer = asRecord(product?.offers) || findFirstBySchemaType(schemaItems, 'Offer');

        const schemaPrice = asString(offer?.price);
        const schemaCurrency = asString(offer?.priceCurrency);
        const schemaAvailability = asString(offer?.availability);
        const schemaSeller = asString(asRecord(offer?.seller)?.name);
        const schemaDescription = asString(product?.description);

        const priceText =
            selectText(document, PRICE_SELECTORS) ||
            cleanText(schemaCurrency && schemaPrice ? `${schemaCurrency} ${schemaPrice}` : schemaPrice);

        const seller =
            selectText(document, SELLER_SELECTORS) ||
            schemaSeller ||
            asString(asRecord(product?.brand)?.name);

        const imageFromSchema = Array.isArray(product?.image)
            ? asString(product?.image[0])
            : asString(product?.image);

        return {
            input: input.input,
            marketplace: {
                domain: host,
                host,
            },
            item: {
                itemId: extractItemId(payload.url),
                url: payload.url,
                canonicalUrl: selectAttribute(document, ['link[rel="canonical"]'], 'href'),
                title: selectText(document, TITLE_SELECTORS) || asString(product?.name),
                subtitle: selectText(document, SUBTITLE_SELECTORS),
                condition: selectText(document, CONDITION_SELECTORS),
                seller,
                priceText,
                price: parseNumericPrice(priceText || schemaPrice),
                currency: parseCurrency(schemaCurrency || priceText) || currencyFromEbayHost(host),
                availability: selectText(document, AVAILABILITY_SELECTORS) || schemaAvailability,
                imageUrl: selectAttribute(document, IMAGE_SELECTORS, 'content') || selectAttribute(document, IMAGE_SELECTORS, 'src') || imageFromSchema,
                description:
                    selectAttribute(document, DESCRIPTION_SELECTORS, 'content') ||
                    selectText(document, DESCRIPTION_SELECTORS) ||
                    schemaDescription,
            },
            diagnostics: buildDiagnostics({
                blocked: false,
                warnings: [],
                crawledUrls: [payload.url],
                antiBotSignals: payload.detection.matchedSignals,
            }),
        };
    }
}

export const ebayService = new EbayService();
