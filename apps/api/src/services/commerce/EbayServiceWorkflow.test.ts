import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

process.env.DATABASE_URL ||= 'postgresql://user:pass@localhost:5432/headlessx_test';

function buildProductHtml(): string {
    return `
        <html>
            <head>
                <title>Demo eBay Listing</title>
                <link rel="canonical" href="https://www.ebay.com/itm/123456789012" />
                <meta property="og:image" content="https://i.ebayimg.com/images/g/demo/s-l1600.jpg" />
                <script type="application/ld+json">
                    {
                        "@context": "https://schema.org",
                        "@type": "Product",
                        "name": "Demo eBay Headphones",
                        "description": "Demo product description",
                        "brand": { "@type": "Brand", "name": "DemoBrand" },
                        "offers": {
                            "@type": "Offer",
                            "price": "145.50",
                            "priceCurrency": "USD",
                            "availability": "https://schema.org/InStock",
                            "seller": { "@type": "Organization", "name": "Demo Seller" }
                        },
                        "aggregateRating": {
                            "@type": "AggregateRating",
                            "ratingValue": "4.7",
                            "reviewCount": "36704"
                        }
                    }
                </script>
            </head>
            <body>
                <h1 class="x-item-title__mainTitle"><span>Demo eBay Headphones</span></h1>
                <div class="x-item-title__subTitle"><span>Limited Edition</span></div>
                <div class="x-item-condition-text"><span>New</span></div>
                <div class="x-sellercard-atf__info__about-seller"><a>Demo Seller</a></div>
                <div class="x-price-primary"><span>$145.50</span></div>
                <div class="x-quantity__availability">Limited quantity available</div>

                <div id="rwid">
                    <h2>Product ratings and reviews (2)</h2>
                    <div class="review-item" data-review-id="REV001">
                        <a class="review-item-title" href="/r/REV001">Great quality</a>
                        <div class="ebay-review-start-rating" aria-label="5.0 out of 5 stars"></div>
                        <span class="review-item-author">Alice</span>
                        <span class="review-item-date">Apr 3, 2025</span>
                        <div class="review-item-content">Works perfectly.</div>
                        <span class="review-item-helpful-count">12 helpful votes</span>
                        <span class="review-item-verified">Verified purchase</span>
                    </div>
                    <div class="review-item" data-review-id="REV002">
                        <a class="review-item-title" href="/r/REV002">Could be better</a>
                        <div class="ebay-review-start-rating" aria-label="2.0 out of 5 stars"></div>
                        <span class="review-item-author">Bob</span>
                        <span class="review-item-date">Apr 1, 2025</span>
                        <div class="review-item-content">Battery life is short.</div>
                        <span class="review-item-helpful-count">3 helpful votes</span>
                    </div>
                </div>
            </body>
        </html>
    `;
}

function buildProductHtmlWithSellerFeedback(): string {
    return `
        <html>
            <head>
                <title>Demo eBay Listing</title>
                <link rel="canonical" href="https://www.ebay.com/itm/123456789012" />
                <script type="application/ld+json">
                    {
                        "@context": "https://schema.org",
                        "@type": "Product",
                        "name": "Demo eBay Headphones",
                        "aggregateRating": {
                            "@type": "AggregateRating",
                            "ratingValue": "4.7",
                            "reviewCount": "36704"
                        }
                    }
                </script>
            </head>
            <body>
                <h1 class="x-item-title__mainTitle"><span>Demo eBay Headphones</span></h1>
                <div class="x-price-primary"><span>$145.50</span></div>

                <div id="rwid">
                    <h2>Product ratings and reviews (1)</h2>
                    <div class="review-item" data-review-id="REV001">
                        <a class="review-item-title" href="/r/REV001">Product review</a>
                        <div class="ebay-review-start-rating" aria-label="5.0 out of 5 stars"></div>
                        <span class="review-item-author">ProductBuyer</span>
                        <span class="review-item-date">Apr 1, 2025</span>
                        <div class="review-item-content">Good product.</div>
                    </div>
                </div>

                <div class="x-feedback-detail-list" data-testid="x-feedback-detail-list">
                    <ul class="fdbk-detail-list__cards">
                        <li class="fdbk-container" data-testid="feedback-cards">
                            <div class="fdbk-container__details">
                                <div class="fdbk-container__details__top__text">
                                    <div class="fdbk-container__details__info">
                                        <div class="fdbk-container__details__info__icon">
                                            <svg data-test-id="shared-feedback-component-POSITIVE" data-test-type="positive" aria-label="Positive feedback rating"></svg>
                                        </div>
                                        <div class="fdbk-container__details__info__username">
                                            <span>BuyerOne (13)</span>
                                            <span>- Feedback left by buyer.</span>
                                        </div>
                                        <div class="fdbk-container__details__info__divide">
                                            <div class="fdbk-container__details__info__divide__list-bullet">
                                                <span class="fdbk-container__details__info__divide__time"><span>Past month</span></span>
                                            </div>
                                        </div>
                                        <div class="fdbk-container__details__verified__purchase"><span>Verified purchase</span></div>
                                    </div>
                                </div>
                                <div class="fdbk-container__details__top">
                                    <div class="fdbk-container__details__comment"><span>Packed carefully and shipped fast.</span></div>
                                </div>
                                <div class="fdbk-container__details__item-link">
                                    <a href="/itm/405377666393">Demo item A (#405377666393)</a>
                                </div>
                            </div>
                        </li>
                        <li class="fdbk-container" data-testid="feedback-cards">
                            <div class="fdbk-container__details">
                                <div class="fdbk-container__details__top__text">
                                    <div class="fdbk-container__details__info">
                                        <div class="fdbk-container__details__info__icon">
                                            <svg data-test-id="shared-feedback-component-NEGATIVE" data-test-type="negative" aria-label="Negative feedback rating"></svg>
                                        </div>
                                        <div class="fdbk-container__details__info__username">
                                            <span>BuyerTwo (7)</span>
                                            <span>- Feedback left by buyer.</span>
                                        </div>
                                        <div class="fdbk-container__details__info__divide">
                                            <div class="fdbk-container__details__info__divide__list-bullet">
                                                <span class="fdbk-container__details__info__divide__time"><span>Past 6 months</span></span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div class="fdbk-container__details__top">
                                    <div class="fdbk-container__details__comment"><span>Late shipment response.</span></div>
                                </div>
                                <div class="fdbk-container__details__item-link">
                                    <a href="/itm/389182448256">Demo item B (#389182448256)</a>
                                </div>
                            </div>
                        </li>
                    </ul>
                </div>
            </body>
        </html>
    `;
}

describe('EbayService workflow', () => {
    it('uses HTTP scraping only and extracts product-page reviews', async () => {
        const ebayServiceModule = await import('./EbayService');
        const scraperHttpModule = await import('../scrape/ScraperHttpService');
        const scraperBrowserModule = await import('../scrape/ScraperService');
        const antiBotModule = await import('../scrape/AntiBotDetectionService');

        const originalHttpScrape = scraperHttpModule.scraperHttpService.scrape;
        const originalBrowserScrape = scraperBrowserModule.scraperService.scrape;
        const originalDetect = antiBotModule.antiBotDetectionService.detect;
        const requestedUrls: string[] = [];
        let browserScrapeCalls = 0;

        scraperHttpModule.scraperHttpService.scrape = async (url) => {
            requestedUrls.push(url);
            return {
                requestedUrl: url,
                url,
                html: buildProductHtml(),
                title: 'Demo eBay Listing',
                statusCode: 200,
                metadata: {},
            };
        };

        scraperBrowserModule.scraperService.scrape = async () => {
            browserScrapeCalls += 1;
            throw new Error('browser scraper should not be called');
        };

        antiBotModule.antiBotDetectionService.detect = () => ({
            provider: 'ebay',
            blocked: false,
            matchedSignals: [],
        });

        try {
            const result = await ebayServiceModule.ebayService.inspect({
                input: 'https://www.ebay.co.uk/itm/123456789012?var=1',
                includeReviews: true,
                reviewPageLimit: 3,
                reviewStar: 'all',
            });

            assert.equal(requestedUrls[0], 'https://www.ebay.co.uk/itm/123456789012');
            assert.equal(browserScrapeCalls, 0);
            assert.equal(result.asin, '123456789012');
            assert.equal(result.title, 'Demo eBay Headphones');
            assert.equal(result.reviewsCount, 36704);
            assert.equal(result.reviews.length, 2);
            assert.equal(Object.prototype.hasOwnProperty.call(result, 'item'), false);
            assert.equal(Object.prototype.hasOwnProperty.call(result, 'diagnostics'), false);
        } finally {
            scraperHttpModule.scraperHttpService.scrape = originalHttpScrape;
            scraperBrowserModule.scraperService.scrape = originalBrowserScrape;
            antiBotModule.antiBotDetectionService.detect = originalDetect;
        }
    });

    it('retries once when first HTTP response is blocked', async () => {
        const ebayServiceModule = await import('./EbayService');
        const scraperHttpModule = await import('../scrape/ScraperHttpService');
        const antiBotModule = await import('../scrape/AntiBotDetectionService');

        const originalHttpScrape = scraperHttpModule.scraperHttpService.scrape;
        const originalDetect = antiBotModule.antiBotDetectionService.detect;
        let scrapeCallCount = 0;

        scraperHttpModule.scraperHttpService.scrape = async (url) => {
            scrapeCallCount += 1;
            return {
                requestedUrl: url,
                url,
                html: scrapeCallCount === 1
                    ? '<html><body>Pardon our interruption</body></html>'
                    : buildProductHtml(),
                title: scrapeCallCount === 1 ? 'Blocked' : 'Demo eBay Listing',
                statusCode: 200,
                metadata: {},
            };
        };

        antiBotModule.antiBotDetectionService.detect = (_provider, _url, html) => {
            const blocked = html.toLowerCase().includes('pardon our interruption');
            return {
                provider: 'ebay',
                blocked,
                matchedSignals: blocked ? ['html:pardon our interruption'] : [],
            };
        };

        try {
            const result = await ebayServiceModule.ebayService.inspect({
                input: '123456789012',
                includeReviews: false,
            });

            assert.equal(scrapeCallCount, 2);
            assert.equal(result.asin, '123456789012');
        } finally {
            scraperHttpModule.scraperHttpService.scrape = originalHttpScrape;
            antiBotModule.antiBotDetectionService.detect = originalDetect;
        }
    });

    it('applies rating-type filtering for negative feedback', async () => {
        const ebayServiceModule = await import('./EbayService');
        const scraperHttpModule = await import('../scrape/ScraperHttpService');
        const antiBotModule = await import('../scrape/AntiBotDetectionService');

        const originalHttpScrape = scraperHttpModule.scraperHttpService.scrape;
        const originalDetect = antiBotModule.antiBotDetectionService.detect;

        scraperHttpModule.scraperHttpService.scrape = async (url) => ({
            requestedUrl: url,
            url,
            html: buildProductHtml(),
            title: 'Demo eBay Listing',
            statusCode: 200,
            metadata: {},
        });

        antiBotModule.antiBotDetectionService.detect = () => ({
            provider: 'ebay',
            blocked: false,
            matchedSignals: [],
        });

        try {
            const result = await ebayServiceModule.ebayService.inspect({
                input: '123456789012',
                includeReviews: true,
                reviewStar: 'negative',
                reviewPageLimit: 1,
            });

            assert.equal(result.reviews.length, 1);
            assert.equal(result.reviews[0]?.id, 'REV002');
        } finally {
            scraperHttpModule.scraperHttpService.scrape = originalHttpScrape;
            antiBotModule.antiBotDetectionService.detect = originalDetect;
        }
    });

    it('prioritizes comments from Seller feedback section when present', async () => {
        const ebayServiceModule = await import('./EbayService');
        const scraperHttpModule = await import('../scrape/ScraperHttpService');
        const antiBotModule = await import('../scrape/AntiBotDetectionService');

        const originalHttpScrape = scraperHttpModule.scraperHttpService.scrape;
        const originalDetect = antiBotModule.antiBotDetectionService.detect;

        scraperHttpModule.scraperHttpService.scrape = async (url) => ({
            requestedUrl: url,
            url,
            html: buildProductHtmlWithSellerFeedback(),
            title: 'Demo eBay Listing',
            statusCode: 200,
            metadata: {},
        });

        antiBotModule.antiBotDetectionService.detect = () => ({
            provider: 'ebay',
            blocked: false,
            matchedSignals: [],
        });

        try {
            const result = await ebayServiceModule.ebayService.inspect({
                input: '123456789012',
                includeReviews: true,
                reviewStar: 'all',
                reviewPageLimit: 3,
            });

            assert.equal(result.reviews.length, 2);
            assert.equal(result.reviews[0]?.author, 'BuyerOne (13)');
            assert.equal(result.reviews[1]?.author, 'BuyerTwo (7)');
            assert.equal(result.reviews.some((review) => review.id === 'REV001'), false);
            assert.equal(result.reviews[0]?.text, 'Packed carefully and shipped fast.');
            assert.equal(result.reviews[1]?.text, 'Late shipment response.');
            assert.equal(result.reviews[0]?.verifiedPurchase, true);
            assert.equal(result.reviews[0]?.rating, 5);
            assert.equal(result.reviews[1]?.rating, 1);
        } finally {
            scraperHttpModule.scraperHttpService.scrape = originalHttpScrape;
            antiBotModule.antiBotDetectionService.detect = originalDetect;
        }
    });
});
