import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

process.env.DATABASE_URL ||= 'postgresql://user:pass@localhost:5432/headlessx_test';

describe('Marketplace service input validation', () => {
    it('amazon rejects non-amazon absolute URLs', async () => {
        const { amazonService, AmazonServiceError } = await import('./AmazonService');

        await assert.rejects(
            () =>
                amazonService.inspect({
                    input: 'https://amazon.evil.com/dp/B012345678',
                    includeReviews: false,
                }),
            (error: unknown) => {
                assert.equal(error instanceof AmazonServiceError, true);
                assert.equal((error as AmazonServiceError).code, 'INVALID_AMAZON_INPUT');
                return true;
            }
        );
    });

    it('amazon rejects invalid marketplace override values', async () => {
        const { amazonService, AmazonServiceError } = await import('./AmazonService');

        await assert.rejects(
            () =>
                amazonService.inspect({
                    input: 'B012345678',
                    marketplace: 'invalid-market',
                    includeReviews: false,
                }),
            (error: unknown) => {
                assert.equal(error instanceof AmazonServiceError, true);
                assert.equal((error as AmazonServiceError).code, 'INVALID_AMAZON_MARKETPLACE');
                return true;
            }
        );
    });

    it('ebay rejects deceptive hosts that only prefix-match ebay', async () => {
        const { ebayService, EbayServiceError } = await import('./EbayService');

        await assert.rejects(
            () =>
                ebayService.inspect({
                    input: 'https://ebay.evil.com/itm/123456789012',
                }),
            (error: unknown) => {
                assert.equal(error instanceof EbayServiceError, true);
                assert.equal((error as EbayServiceError).code, 'INVALID_EBAY_INPUT');
                return true;
            }
        );
    });

    it('walmart rejects deceptive hosts that only prefix-match walmart', async () => {
        const { walmartService, WalmartServiceError } = await import('./WalmartService');

        await assert.rejects(
            () =>
                walmartService.inspect({
                    input: 'https://walmart.evil.com/ip/123456789',
                }),
            (error: unknown) => {
                assert.equal(error instanceof WalmartServiceError, true);
                assert.equal((error as WalmartServiceError).code, 'INVALID_WALMART_INPUT');
                return true;
            }
        );
    });
});
