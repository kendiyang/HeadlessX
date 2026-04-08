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

export interface WalmartInspectInput extends CommerceInspectInput {
    marketplace?: string;
}

export interface WalmartInspectResult {
    input: string;
    marketplace: {
        domain: string;
        host: string;
    };
    product: {
        productId: string | null;
        url: string;
        canonicalUrl: string | null;
        title: string | null;
        brand: string | null;
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

const DEFAULT_WALMART_HOST = 'www.walmart.com';
const WALMART_HOST_PATTERN = /^(?:[a-z0-9-]+\.)*walmart\.(?:com|ca|com\.mx)$/i;
const WALMART_SUFFIX_CURRENCY_MAP: Record<string, string> = {
    com: 'USD',
    ca: 'CAD',
    'com.mx': 'MXN',
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

const PRICE_SELECTORS = [
    '[itemprop="price"]',
    'span[data-automation-id="product-price"]',
    '[data-testid="price-wrap"] span',
    '[data-testid="price"]',
] as const;

const AVAILABILITY_SELECTORS = [
    '[data-automation-id="fulfillment-summary"]',
    '[data-testid="fulfillment-shipping-text"]',
    '[itemprop="availability"]',
] as const;

const DESCRIPTION_SELECTORS = [
    'meta[name="description"]',
    '[itemprop="description"]',
] as const;

const IMAGE_SELECTORS = [
    'meta[property="og:image"]',
    'meta[name="twitter:image"]',
    'img[data-testid="hero-image"]',
] as const;

function currencyFromWalmartHost(host: string): string | null {
    const normalized = host.trim().toLowerCase();
    for (const [suffix, currency] of Object.entries(WALMART_SUFFIX_CURRENCY_MAP)) {
        if (normalized === `walmart.${suffix}` || normalized.endsWith(`.walmart.${suffix}`)) {
            return currency;
        }
    }

    return null;
}

function normalizeHost(marketplace?: string): string {
    const raw = marketplace?.trim().toLowerCase();
    if (!raw) {
        return DEFAULT_WALMART_HOST;
    }

    const cleaned = raw
        .replace(/^https?:\/\//i, '')
        .replace(/[/?#].*$/, '')
        .replace(/:\d+$/, '');
    if (WALMART_HOST_PATTERN.test(cleaned)) {
        return cleaned;
    }

    if (cleaned === 'com' || cleaned === 'ca' || cleaned === 'mx') {
        return `www.walmart.${cleaned}`;
    }

    throw new WalmartServiceError(
        'Marketplace must be a Walmart domain such as walmart.com.',
        'INVALID_WALMART_MARKETPLACE',
        400
    );
}

function extractProductId(url: string): string | null {
    return url.match(/\/ip\/(?:[^/]+\/)?(\d{6,20})/i)?.[1] || null;
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
            notes: [
                'Walmart pages can trigger anti-bot challenges for low-trust sessions.',
                'Use a warmed browser profile and stable proxy region for better consistency.',
            ],
        };
    }

    public async inspect(input: WalmartInspectInput): Promise<WalmartInspectResult> {
        const host = normalizeHost(input.marketplace);
        const targetUrl = resolveMarketplaceInputUrl(input.input, {
            defaultHost: host,
            hostPattern: WALMART_HOST_PATTERN,
            idPathBuilder: (value) => (/^\d{6,20}$/.test(value) ? `/ip/${value}` : null),
        });

        if (!targetUrl) {
            throw new WalmartServiceError(
                'Input must be a Walmart URL/path or a valid numeric product ID.',
                'INVALID_WALMART_INPUT',
                400
            );
        }

        const payload = await scrapeCommercePage('walmart', targetUrl, {
            timeout: input.timeout,
            stealth: input.stealth,
            waitForSelector: input.waitForSelector,
        });

        if (payload.detection.blocked) {
            const signalSummary = payload.detection.matchedSignals.length > 0
                ? ` Signals: ${payload.detection.matchedSignals.join(', ')}`
                : '';
            throw new WalmartServiceError(
                `Walmart blocked the inspection request. Try a warmed profile or proxy.${signalSummary}`,
                'WALMART_BLOCKED',
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
        const schemaDescription = asString(product?.description);
        const brandSchema = asRecord(product?.brand);

        const priceText =
            selectText(document, PRICE_SELECTORS) ||
            cleanText(schemaCurrency && schemaPrice ? `${schemaCurrency} ${schemaPrice}` : schemaPrice);

        const imageFromSchema = Array.isArray(product?.image)
            ? asString(product?.image[0])
            : asString(product?.image);

        return {
            input: input.input,
            marketplace: {
                domain: host,
                host,
            },
            product: {
                productId: extractProductId(payload.url),
                url: payload.url,
                canonicalUrl: selectAttribute(document, ['link[rel="canonical"]'], 'href'),
                title: selectText(document, TITLE_SELECTORS) || asString(product?.name),
                brand: selectText(document, BRAND_SELECTORS) || asString(brandSchema?.name),
                seller: selectText(document, SELLER_SELECTORS) || asString(asRecord(offer?.seller)?.name),
                priceText,
                price: parseNumericPrice(priceText || schemaPrice),
                currency: parseCurrency(schemaCurrency || priceText) || currencyFromWalmartHost(host),
                availability: selectText(document, AVAILABILITY_SELECTORS) || schemaAvailability,
                imageUrl:
                    selectAttribute(document, IMAGE_SELECTORS, 'content') ||
                    selectAttribute(document, IMAGE_SELECTORS, 'src') ||
                    imageFromSchema,
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

export const walmartService = new WalmartService();
