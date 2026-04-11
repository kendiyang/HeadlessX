import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

process.env.DATABASE_URL ||= 'postgresql://user:pass@localhost:5432/headlessx_test';

function buildProductHtmlWithKeyItemFeatures(): string {
    return `
        <html>
            <head>
                <title>Demo Walmart Listing</title>
                <link rel="canonical" href="https://www.walmart.com/ip/123456789" />
                <meta name="description" content="Demo Walmart description." />
                <script type="application/ld+json">
                    {
                        "@context": "https://schema.org",
                        "@type": "Product",
                        "name": "Demo Walmart Headphones",
                        "offers": {
                            "@type": "Offer",
                            "price": "145.50",
                            "priceCurrency": "USD"
                        },
                        "aggregateRating": {
                            "@type": "AggregateRating",
                            "reviewCount": "42"
                        }
                    }
                </script>
            </head>
            <body>
                <h1 data-automation-id="product-title">Demo Walmart Headphones</h1>
                <span data-automation-id="product-price">$145.50</span>

                <section>
                    <h2>Key item features</h2>
                    <div>
                        <ul>
                            <li>Noise cancellation for office and travel</li>
                            <li>40-hour battery life on a single charge</li>
                        </ul>
                    </div>
                </section>
            </body>
        </html>
    `;
}

function buildProductHtmlWithExpandCollapseKeyFeatures(): string {
    return `
        <html>
            <head>
                <title>Demo Walmart Listing</title>
                <link rel="canonical" href="https://www.walmart.com/ip/123456789" />
            </head>
            <body>
                <h1 data-automation-id="product-title">Demo Walmart Headphones</h1>
                <span data-automation-id="product-price">$145.50</span>

                <section class="expand-collapse-section ba br3 b--lighter-gray">
                    <div
                        class="expand-collapse-header flex justify-between items-center w-100"
                        role="button"
                        tabindex="0"
                        aria-expanded="true"
                        aria-label="Key item features"
                    >
                        <h2 class="w-100 ma0 lh-copy pa3 f5 pv3">Key item features</h2>
                        <div class="pr3"><span class="dib pt0" aria-hidden="true">...</span></div>
                    </div>

                    <div class="Collapse_collapse__Ja6XL expand-collapse-content" data-testid="ui-collapse-panel" style="height: auto;">
                        <div class="ph3 pb2">
                            <span class="ld_Az" style="-webkit-line-clamp: 17;">
                                <div>
                                    <ul class="mv0 pl4">
                                        <li>Wireless over-ear comfort for long sessions</li>
                                        <li>Built-in mic for clear video meetings</li>
                                        <li>Fast USB-C charging support</li>
                                    </ul>
                                </div>
                            </span>
                        </div>
                    </div>
                </section>
            </body>
        </html>
    `;
}

function buildProductHtmlWithSpecificationBrand(): string {
    return `
        <html>
            <head>
                <title>Demo Walmart Listing</title>
                <link rel="canonical" href="https://www.walmart.com/ip/123456789" />
            </head>
            <body>
                <h1 data-automation-id="product-title">Demo Walmart Headphones</h1>
                <span data-automation-id="product-price">$145.50</span>

                <div data-testid="specifications">
                    <section id="specifications-wrapper" class="expand-collapse-section">
                        <div class="expand-collapse-content" data-testid="ui-collapse-panel">
                            <div>
                                <div class="pb2">
                                    <h3 class="flex items-center mv0 lh-copy f5 pb1 dark-gray">Brand</h3>
                                    <div class="mv0 lh-copy mid-gray f6">
                                        <span>Pure Encapsulations</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>
                </div>
            </body>
        </html>
    `;
}

function buildProductHtmlWithProductGroupReviewsOnly(): string {
    return `
        <html>
            <head>
                <title>Demo Walmart Listing</title>
                <link rel="canonical" href="https://www.walmart.com/ip/123456789" />
                <script type="application/ld+json">
                    [{
                        "@context":"https://schema.org/",
                        "@type":"ProductGroup",
                        "name":"Schema Group Product",
                        "aggregateRating":{
                            "@type":"AggregateRating",
                            "ratingValue":4.3,
                            "reviewCount":22
                        },
                        "review":[
                            {
                                "@type":"Review",
                                "datePublished":"2/2/2026",
                                "reviewBody":"Love their products",
                                "reviewRating":{"@type":"Rating","ratingValue":5},
                                "author":{"@type":"Person","name":"Tosha"}
                            },
                            {
                                "@type":"Review",
                                "name":"Suggested Ingredients",
                                "datePublished":"11/14/2023",
                                "reviewBody":"Helpful ingredients for eye health.",
                                "reviewRating":{"@type":"Rating","ratingValue":4},
                                "author":{"@type":"Person","name":"Arobbi"}
                            }
                        ],
                        "hasVariant":[
                            {
                                "@type":"Product",
                                "name":"Schema Variant Product",
                                "brand":{"@type":"Brand","name":"Pure Encapsulations"},
                                "offers":[{"@type":"Offer","priceCurrency":"USD","price":107}]
                            }
                        ]
                    }]
                </script>
            </head>
            <body>
                <h1 data-automation-id="product-title">Schema Group Product</h1>
                <span data-automation-id="product-price">$107.00</span>
            </body>
        </html>
    `;
}

describe('WalmartService workflow', () => {
    it('extracts "Key item features" bullets into features field', async () => {
        const walmartServiceModule = await import('./WalmartService');
        const scraperHttpModule = await import('../scrape/ScraperHttpService');
        const antiBotModule = await import('../scrape/AntiBotDetectionService');

        const originalScrape = scraperHttpModule.scraperHttpService.scrape;
        const originalDetect = antiBotModule.antiBotDetectionService.detect;

        scraperHttpModule.scraperHttpService.scrape = async (url) => ({
            requestedUrl: url,
            url,
            html: buildProductHtmlWithKeyItemFeatures(),
            title: 'Demo Walmart Listing',
            statusCode: 200,
            metadata: {},
        });

        antiBotModule.antiBotDetectionService.detect = () => ({
            provider: 'walmart',
            blocked: false,
            matchedSignals: [],
        });

        try {
            const result = await walmartServiceModule.walmartService.inspect({
                input: '123456789',
                includeReviews: false,
            });

            assert.equal(result.url, 'https://www.walmart.com/ip/123456789');
            assert.equal(result.features.includes('Noise cancellation for office and travel'), true);
            assert.equal(result.features.includes('40-hour battery life on a single charge'), true);
        } finally {
            scraperHttpModule.scraperHttpService.scrape = originalScrape;
            antiBotModule.antiBotDetectionService.detect = originalDetect;
        }
    });

    it('extracts features from expand-collapse Key item features section list', async () => {
        const walmartServiceModule = await import('./WalmartService');
        const scraperHttpModule = await import('../scrape/ScraperHttpService');
        const antiBotModule = await import('../scrape/AntiBotDetectionService');

        const originalScrape = scraperHttpModule.scraperHttpService.scrape;
        const originalDetect = antiBotModule.antiBotDetectionService.detect;

        scraperHttpModule.scraperHttpService.scrape = async (url) => ({
            requestedUrl: url,
            url,
            html: buildProductHtmlWithExpandCollapseKeyFeatures(),
            title: 'Demo Walmart Listing',
            statusCode: 200,
            metadata: {},
        });

        antiBotModule.antiBotDetectionService.detect = () => ({
            provider: 'walmart',
            blocked: false,
            matchedSignals: [],
        });

        try {
            const result = await walmartServiceModule.walmartService.inspect({
                input: '123456789',
                includeReviews: false,
            });

            assert.equal(result.features.includes('Wireless over-ear comfort for long sessions'), true);
            assert.equal(result.features.includes('Built-in mic for clear video meetings'), true);
            assert.equal(result.features.includes('Fast USB-C charging support'), true);
        } finally {
            scraperHttpModule.scraperHttpService.scrape = originalScrape;
            antiBotModule.antiBotDetectionService.detect = originalDetect;
        }
    });

    it('extracts brand value from specifications section key/value block', async () => {
        const walmartServiceModule = await import('./WalmartService');
        const scraperHttpModule = await import('../scrape/ScraperHttpService');
        const antiBotModule = await import('../scrape/AntiBotDetectionService');

        const originalScrape = scraperHttpModule.scraperHttpService.scrape;
        const originalDetect = antiBotModule.antiBotDetectionService.detect;

        scraperHttpModule.scraperHttpService.scrape = async (url) => ({
            requestedUrl: url,
            url,
            html: buildProductHtmlWithSpecificationBrand(),
            title: 'Demo Walmart Listing',
            statusCode: 200,
            metadata: {},
        });

        antiBotModule.antiBotDetectionService.detect = () => ({
            provider: 'walmart',
            blocked: false,
            matchedSignals: [],
        });

        try {
            const result = await walmartServiceModule.walmartService.inspect({
                input: '123456789',
                includeReviews: false,
            });

            assert.equal(result.brand, 'Pure Encapsulations');
        } finally {
            scraperHttpModule.scraperHttpService.scrape = originalScrape;
            antiBotModule.antiBotDetectionService.detect = originalDetect;
        }
    });

    it('extracts reviews from ProductGroup JSON-LD when DOM review nodes are absent', async () => {
        const walmartServiceModule = await import('./WalmartService');
        const scraperHttpModule = await import('../scrape/ScraperHttpService');
        const antiBotModule = await import('../scrape/AntiBotDetectionService');

        const originalScrape = scraperHttpModule.scraperHttpService.scrape;
        const originalDetect = antiBotModule.antiBotDetectionService.detect;

        scraperHttpModule.scraperHttpService.scrape = async (url) => ({
            requestedUrl: url,
            url,
            html: buildProductHtmlWithProductGroupReviewsOnly(),
            title: 'Demo Walmart Listing',
            statusCode: 200,
            metadata: {},
        });

        antiBotModule.antiBotDetectionService.detect = () => ({
            provider: 'walmart',
            blocked: false,
            matchedSignals: [],
        });

        try {
            const result = await walmartServiceModule.walmartService.inspect({
                input: '123456789',
                includeReviews: true,
                reviewStar: 'all',
                reviewPageLimit: 1,
            });

            assert.equal(result.reviews.length, 2);
            assert.equal(result.reviewsCount, 22);
            assert.equal(result.reviews[0]?.author, 'Tosha');
            assert.equal(result.reviews[0]?.text, 'Love their products');
        } finally {
            scraperHttpModule.scraperHttpService.scrape = originalScrape;
            antiBotModule.antiBotDetectionService.detect = originalDetect;
        }
    });
});
