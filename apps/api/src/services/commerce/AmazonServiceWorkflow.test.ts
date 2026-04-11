import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

process.env.DATABASE_URL ||= 'postgresql://user:pass@localhost:5432/headlessx_test';

function buildProductHtml(): string {
    return `
        <html>
            <head><title>Demo Product</title></head>
            <body>
                <span id="productTitle">Demo Product Title</span>
                <a id="bylineInfo">Visit the DemoBrand Store</a>
                <span id="acrCustomerReviewText">36,704 ratings</span>
                <div id="feature-bullets">
                    <ul>
                        <li><span class="a-list-item">Feature one</span></li>
                        <li><span class="a-list-item">Feature two</span></li>
                    </ul>
                </div>
                <div id="merchant-info">Sold by Demo Seller.</div>
                <a
                    id="sellerProfileTriggerId"
                    href="/gp/help/seller/at-a-glance.html/ref=dp_merchant_link?ie=UTF8&seller=A210SJF12S88M5&asin=B012345678"
                >Seller</a>
                <ul id="cm-cr-dp-review-list" data-hook="top-customer-reviews-widget">
                    <li id="RTESTREV001" data-hook="review">
                        <a data-hook="review-title" href="/gp/customer-reviews/RTESTREV001"><span>Great value</span></a>
                        <i data-hook="review-star-rating"><span class="a-icon-alt">5.0 out of 5 stars</span></i>
                        <span class="a-profile-name">User One</span>
                        <span data-hook="review-date">Reviewed in the United States on January 1, 2025</span>
                        <span data-hook="review-body"><span>Loved it.</span></span>
                    </li>
                    <li id="RTESTREV002" data-hook="review">
                        <a data-hook="review-title" href="/gp/customer-reviews/RTESTREV002"><span>Could be better</span></a>
                        <i data-hook="review-star-rating"><span class="a-icon-alt">2.0 out of 5 stars</span></i>
                        <span class="a-profile-name">User Two</span>
                        <span data-hook="review-date">Reviewed in the United States on January 2, 2025</span>
                        <span data-hook="review-body"><span>Not ideal.</span></span>
                    </li>
                </ul>
            </body>
        </html>
    `;
}

describe('AmazonService workflow', () => {
    it('builds ASIN product URL with th=1 and extracts reviews directly from product page HTML', async () => {
        const amazonServiceModule = await import('./AmazonService');
        const scraperHttpModule = await import('../scrape/ScraperHttpService');
        const antiBotModule = await import('../scrape/AntiBotDetectionService');

        const originalScrape = scraperHttpModule.scraperHttpService.scrape;
        const originalDetect = antiBotModule.antiBotDetectionService.detect;
        const requestedUrls: string[] = [];

        scraperHttpModule.scraperHttpService.scrape = async (url) => {
            requestedUrls.push(url);
            return {
                requestedUrl: url,
                url,
                html: buildProductHtml(),
                title: 'Demo Product',
                statusCode: 200,
                metadata: {},
            };
        };

        antiBotModule.antiBotDetectionService.detect = () => ({
            provider: 'amazon',
            blocked: false,
            matchedSignals: [],
        });

        try {
            const result = await amazonServiceModule.amazonService.inspect({
                input: 'B012345678',
                reviewStar: 'all',
                reviewPageLimit: 3,
            });

            assert.equal(requestedUrls[0], 'https://www.amazon.com/dp/B012345678?th=1');
            assert.equal(requestedUrls.filter((url) => url.includes('/product-reviews/')).length, 0);

            assert.equal(result.seller.id, 'A210SJF12S88M5');
            assert.equal(result.reviews.length, 2);
            assert.equal(result.title, 'Demo Product Title');
            assert.equal(result.features.length >= 2, true);
        } finally {
            scraperHttpModule.scraperHttpService.scrape = originalScrape;
            antiBotModule.antiBotDetectionService.detect = originalDetect;
        }
    });

    it('retries once with HTTP scraper when product page is blocked by checkpoint', async () => {
        const amazonServiceModule = await import('./AmazonService');
        const scraperHttpModule = await import('../scrape/ScraperHttpService');
        const antiBotModule = await import('../scrape/AntiBotDetectionService');

        const originalScrape = scraperHttpModule.scraperHttpService.scrape;
        const originalDetect = antiBotModule.antiBotDetectionService.detect;
        let scrapeCallCount = 0;

        scraperHttpModule.scraperHttpService.scrape = async (url) => {
            scrapeCallCount += 1;

            return {
                requestedUrl: url,
                url,
                html: scrapeCallCount === 1
                    ? '<html><body>/errors/validatecaptcha</body></html>'
                    : buildProductHtml(),
                title: scrapeCallCount === 1 ? 'Checkpoint' : 'Demo Product',
                statusCode: 200,
                metadata: {},
            };
        };

        antiBotModule.antiBotDetectionService.detect = (_provider, _url, html) => {
            const blocked = html.includes('/errors/validatecaptcha');
            return {
                provider: 'amazon',
                blocked,
                matchedSignals: blocked ? ['html:/errors/validatecaptcha'] : [],
            };
        };

        try {
            const result = await amazonServiceModule.amazonService.inspect({
                input: 'B012345678',
                includeReviews: false,
            });

            assert.equal(scrapeCallCount, 2);
            assert.equal(result.asin, 'B012345678');
        } finally {
            scraperHttpModule.scraperHttpService.scrape = originalScrape;
            antiBotModule.antiBotDetectionService.detect = originalDetect;
        }
    });

    it('applies reviewStar filtering on reviews extracted from product page', async () => {
        const amazonServiceModule = await import('./AmazonService');
        const scraperHttpModule = await import('../scrape/ScraperHttpService');
        const antiBotModule = await import('../scrape/AntiBotDetectionService');

        const originalScrape = scraperHttpModule.scraperHttpService.scrape;
        const originalDetect = antiBotModule.antiBotDetectionService.detect;
        const requestedUrls: string[] = [];

        scraperHttpModule.scraperHttpService.scrape = async (url) => {
            requestedUrls.push(url);
            return {
                requestedUrl: url,
                url,
                html: buildProductHtml(),
                title: 'Demo Product',
                statusCode: 200,
                metadata: {},
            };
        };

        antiBotModule.antiBotDetectionService.detect = () => ({
            provider: 'amazon',
            blocked: false,
            matchedSignals: [],
        });

        try {
            const result = await amazonServiceModule.amazonService.inspect({
                input: 'B012345678',
                includeReviews: true,
                reviewPageLimit: 1,
                reviewStar: 'positive',
            });

            assert.equal(requestedUrls.filter((url) => url.includes('/product-reviews/')).length, 0);
            assert.equal(result.reviews.length, 1);
            assert.equal(result.reviews[0]?.id, 'RTESTREV002');
        } finally {
            scraperHttpModule.scraperHttpService.scrape = originalScrape;
            antiBotModule.antiBotDetectionService.detect = originalDetect;
        }
    });

    it('forces marketplace override host even when input URL points to another amazon domain', async () => {
        const amazonServiceModule = await import('./AmazonService');
        const scraperHttpModule = await import('../scrape/ScraperHttpService');
        const antiBotModule = await import('../scrape/AntiBotDetectionService');

        const originalScrape = scraperHttpModule.scraperHttpService.scrape;
        const originalDetect = antiBotModule.antiBotDetectionService.detect;
        const requestedUrls: string[] = [];

        scraperHttpModule.scraperHttpService.scrape = async (url) => {
            requestedUrls.push(url);
            return {
                requestedUrl: url,
                url,
                html: buildProductHtml(),
                title: 'Demo Product',
                statusCode: 200,
                metadata: {},
            };
        };

        antiBotModule.antiBotDetectionService.detect = () => ({
            provider: 'amazon',
            blocked: false,
            matchedSignals: [],
        });

        try {
            await amazonServiceModule.amazonService.inspect({
                input: 'https://www.amazon.co.uk/dp/B012345678',
                marketplace: 'amazon.com',
                includeReviews: false,
            });

            assert.equal(requestedUrls[0], 'https://amazon.com/dp/B012345678?th=1');
        } finally {
            scraperHttpModule.scraperHttpService.scrape = originalScrape;
            antiBotModule.antiBotDetectionService.detect = originalDetect;
        }
    });
});
