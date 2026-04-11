import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Request, Response } from 'express';

process.env.DATABASE_URL ||= 'postgresql://user:pass@localhost:5432/headlessx_test';

interface MockResponseHandle {
    res: Response;
    getStatusCode: () => number;
    getBody: () => unknown;
}

function createMockResponse(): MockResponseHandle {
    let statusCode = 200;
    let body: unknown;

    const response = {
        status(code: number) {
            statusCode = code;
            return this;
        },
        json(payload: unknown) {
            body = payload;
            return this;
        },
    } as unknown as Response;

    return {
        res: response,
        getStatusCode: () => statusCode,
        getBody: () => body,
    };
}

function stubRequestLogCreate(prisma: {
    requestLog: {
        create: (...args: unknown[]) => Promise<unknown>;
    };
}): () => void {
    const original = prisma.requestLog.create;
    prisma.requestLog.create = async () => ({ id: 'test-log' });
    return () => {
        prisma.requestLog.create = original;
    };
}

describe('AmazonController', () => {
    it('inspect forwards normalized payload to amazonService.inspect', async () => {
        const [{ AmazonController }, amazonServiceModule, dbModule] = await Promise.all([
            import('./AmazonController'),
            import('../../services/commerce/AmazonService'),
            import('../../database/client'),
        ]);

        const restoreRequestLog = stubRequestLogCreate(dbModule.prisma);
        const originalInspect = amazonServiceModule.amazonService.inspect;
        let forwardedPayload: unknown;

        amazonServiceModule.amazonService.inspect = async (payload) => {
            forwardedPayload = payload;
            return {
                input: payload.input,
                title: 'Demo Product',
                url: 'https://www.amazon.com/dp/B012345678?th=1',
                asin: 'B012345678',
                brand: 'Demo',
                price: {
                    value: 145.5,
                    currency: '$',
                },
                reviewsCount: 36704,
                features: ['Feature one'],
                seller: {
                    name: 'Demo Seller',
                    id: 'A210SJF12S88M5',
                    url: 'https://www.amazon.com/gp/help/seller/at-a-glance.html?seller=A210SJF12S88M5',
                },
                reviews: [],
            };
        };

        try {
            const request = {
                body: { input: 'B012345678' },
                apiKeyId: 'api_key_123',
            } as unknown as Request;

            const responseHandle = createMockResponse();
            await AmazonController.inspect(request, responseHandle.res);

            assert.equal(responseHandle.getStatusCode(), 200);
            assert.deepEqual(forwardedPayload, {
                input: 'B012345678',
                marketplace: undefined,
                includeReviews: true,
                reviewPageLimit: 1,
                reviewSortBy: 'recent',
                reviewStar: undefined,
                reviewerType: undefined,
                reviewStopAtId: undefined,
                timeout: undefined,
                stealth: undefined,
                waitForSelector: undefined,
            });

            const body = responseHandle.getBody() as { success?: boolean };
            assert.equal(body.success, true);
        } finally {
            amazonServiceModule.amazonService.inspect = originalInspect;
            restoreRequestLog();
        }
    });

    it('inspect returns validation error when input is blank', async () => {
        const [{ AmazonController }, amazonServiceModule, dbModule] = await Promise.all([
            import('./AmazonController'),
            import('../../services/commerce/AmazonService'),
            import('../../database/client'),
        ]);

        const restoreRequestLog = stubRequestLogCreate(dbModule.prisma);
        const originalInspect = amazonServiceModule.amazonService.inspect;
        let inspectCalled = false;
        amazonServiceModule.amazonService.inspect = async () => {
            inspectCalled = true;
            throw new Error('inspect should not be called for invalid payload');
        };

        try {
            const request = { body: { input: '   ' }, apiKeyId: 'api_key_123' } as unknown as Request;
            const responseHandle = createMockResponse();
            await AmazonController.inspect(request, responseHandle.res);

            assert.equal(inspectCalled, false);
            assert.equal(responseHandle.getStatusCode(), 400);

            const body = responseHandle.getBody() as {
                success?: boolean;
                error?: { code?: string };
            };
            assert.equal(body.success, false);
            assert.equal(body.error?.code, 'INVALID_AMAZON_REQUEST');
        } finally {
            amazonServiceModule.amazonService.inspect = originalInspect;
            restoreRequestLog();
        }
    });
});

describe('EbayController', () => {
    it('inspect forwards validated payload to ebayService.inspect', async () => {
        const [{ EbayController }, ebayServiceModule, dbModule] = await Promise.all([
            import('./EbayController'),
            import('../../services/commerce/EbayService'),
            import('../../database/client'),
        ]);

        const restoreRequestLog = stubRequestLogCreate(dbModule.prisma);
        const originalInspect = ebayServiceModule.ebayService.inspect;
        let forwardedPayload: unknown;

        ebayServiceModule.ebayService.inspect = async (payload) => {
            forwardedPayload = payload;
            return {
                input: payload.input,
                title: 'Demo eBay listing',
                url: 'https://www.ebay.com/itm/123456789012',
                asin: '123456789012',
                brand: null,
                price: {
                    value: 10,
                    currency: '$',
                },
                reviewsCount: 0,
                features: [],
                seller: {
                    name: null,
                    id: null,
                    url: null,
                },
                reviews: [],
            };
        };

        try {
            const request = {
                body: {
                    input: '123456789012',
                    timeout: 45000,
                    stealth: true,
                },
                apiKeyId: 'api_key_ebay',
            } as unknown as Request;

            const responseHandle = createMockResponse();
            await EbayController.inspect(request, responseHandle.res);

            assert.equal(responseHandle.getStatusCode(), 200);
            assert.deepEqual(forwardedPayload, request.body);

            const body = responseHandle.getBody() as { success?: boolean };
            assert.equal(body.success, true);
        } finally {
            ebayServiceModule.ebayService.inspect = originalInspect;
            restoreRequestLog();
        }
    });

    it('inspect returns validation error when input is blank', async () => {
        const [{ EbayController }, ebayServiceModule, dbModule] = await Promise.all([
            import('./EbayController'),
            import('../../services/commerce/EbayService'),
            import('../../database/client'),
        ]);

        const restoreRequestLog = stubRequestLogCreate(dbModule.prisma);
        const originalInspect = ebayServiceModule.ebayService.inspect;
        let inspectCalled = false;
        ebayServiceModule.ebayService.inspect = async () => {
            inspectCalled = true;
            throw new Error('inspect should not be called for invalid payload');
        };

        try {
            const request = { body: { input: '   ' }, apiKeyId: 'api_key_ebay' } as unknown as Request;
            const responseHandle = createMockResponse();
            await EbayController.inspect(request, responseHandle.res);

            assert.equal(inspectCalled, false);
            assert.equal(responseHandle.getStatusCode(), 400);

            const body = responseHandle.getBody() as {
                success?: boolean;
                error?: { code?: string };
            };
            assert.equal(body.success, false);
            assert.equal(body.error?.code, 'INVALID_EBAY_REQUEST');
        } finally {
            ebayServiceModule.ebayService.inspect = originalInspect;
            restoreRequestLog();
        }
    });
});

describe('WalmartController', () => {
    it('inspect forwards validated payload to walmartService.inspect', async () => {
        const [{ WalmartController }, walmartServiceModule, dbModule] = await Promise.all([
            import('./WalmartController'),
            import('../../services/commerce/WalmartService'),
            import('../../database/client'),
        ]);

        const restoreRequestLog = stubRequestLogCreate(dbModule.prisma);
        const originalInspect = walmartServiceModule.walmartService.inspect;
        let forwardedPayload: unknown;

        walmartServiceModule.walmartService.inspect = async (payload) => {
            forwardedPayload = payload;
            return {
                input: payload.input,
                title: 'Demo Walmart listing',
                url: 'https://www.walmart.com/ip/123456789',
                asin: '123456789',
                brand: 'Demo',
                price: {
                    value: 10,
                    currency: '$',
                },
                reviewsCount: 0,
                features: [],
                seller: {
                    name: null,
                    id: null,
                    url: null,
                },
                reviews: [],
            };
        };

        try {
            const request = {
                body: {
                    input: '123456789',
                    includeReviews: true,
                    reviewPageLimit: 5,
                    reviewSortBy: 'recent',
                    reviewStar: 'positive',
                    reviewerType: 'all_reviews',
                    reviewStopAtId: 'REV001',
                    timeout: 30000,
                    stealth: false,
                },
                apiKeyId: 'api_key_walmart',
            } as unknown as Request;

            const responseHandle = createMockResponse();
            await WalmartController.inspect(request, responseHandle.res);

            assert.equal(responseHandle.getStatusCode(), 200);
            assert.deepEqual(forwardedPayload, request.body);

            const body = responseHandle.getBody() as { success?: boolean };
            assert.equal(body.success, true);
        } finally {
            walmartServiceModule.walmartService.inspect = originalInspect;
            restoreRequestLog();
        }
    });

    it('inspect returns validation error when input is blank', async () => {
        const [{ WalmartController }, walmartServiceModule, dbModule] = await Promise.all([
            import('./WalmartController'),
            import('../../services/commerce/WalmartService'),
            import('../../database/client'),
        ]);

        const restoreRequestLog = stubRequestLogCreate(dbModule.prisma);
        const originalInspect = walmartServiceModule.walmartService.inspect;
        let inspectCalled = false;
        walmartServiceModule.walmartService.inspect = async () => {
            inspectCalled = true;
            throw new Error('inspect should not be called for invalid payload');
        };

        try {
            const request = { body: { input: '   ' }, apiKeyId: 'api_key_walmart' } as unknown as Request;
            const responseHandle = createMockResponse();
            await WalmartController.inspect(request, responseHandle.res);

            assert.equal(inspectCalled, false);
            assert.equal(responseHandle.getStatusCode(), 400);

            const body = responseHandle.getBody() as {
                success?: boolean;
                error?: { code?: string };
            };
            assert.equal(body.success, false);
            assert.equal(body.error?.code, 'INVALID_WALMART_REQUEST');
        } finally {
            walmartServiceModule.walmartService.inspect = originalInspect;
            restoreRequestLog();
        }
    });
});
