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

describe('RedditController', () => {
    it('inspect forwards validated payload to redditService.inspect', async () => {
        const [{ RedditController }, redditServiceModule, dbModule] = await Promise.all([
            import('./RedditController'),
            import('../../services/social/RedditService'),
            import('../../database/client'),
        ]);

        const restoreRequestLog = stubRequestLogCreate(dbModule.prisma);
        const originalInspect = redditServiceModule.redditService.inspect;
        let forwardedPayload: unknown;

        redditServiceModule.redditService.inspect = async (payload) => {
            forwardedPayload = payload;
            return {
                input: payload.input,
                target: {
                    mode: 'thread',
                    url: 'https://www.reddit.com/r/example/comments/abc123/title',
                    jsonUrl: 'https://www.reddit.com/r/example/comments/abc123/title.json?raw_json=1',
                    subreddit: 'example',
                    postId: 'abc123',
                    sort: 'new',
                    timeframe: 'week',
                },
                thread: {
                    post: null,
                    comments: [],
                    totalComments: 0,
                    moreComments: 0,
                },
                listing: null,
                diagnostics: {
                    blocked: false,
                    warnings: [],
                    crawledUrls: [],
                    antiBotSignals: [],
                    generatedAt: new Date().toISOString(),
                },
            };
        };

        try {
            const request = {
                body: {
                    input: 'https://www.reddit.com/r/example/comments/abc123/title',
                    sort: 'new',
                    timeframe: 'week',
                    limit: 120,
                    depth: 4,
                    timeout: 30000,
                    includeRaw: true,
                },
                apiKeyId: 'api_key_reddit',
            } as unknown as Request;

            const responseHandle = createMockResponse();
            await RedditController.inspect(request, responseHandle.res);

            assert.equal(responseHandle.getStatusCode(), 200);
            assert.deepEqual(forwardedPayload, request.body);

            const body = responseHandle.getBody() as { success?: boolean };
            assert.equal(body.success, true);
        } finally {
            redditServiceModule.redditService.inspect = originalInspect;
            restoreRequestLog();
        }
    });

    it('inspect returns validation error when input is blank', async () => {
        const [{ RedditController }, redditServiceModule, dbModule] = await Promise.all([
            import('./RedditController'),
            import('../../services/social/RedditService'),
            import('../../database/client'),
        ]);

        const restoreRequestLog = stubRequestLogCreate(dbModule.prisma);
        const originalInspect = redditServiceModule.redditService.inspect;
        let inspectCalled = false;
        redditServiceModule.redditService.inspect = async () => {
            inspectCalled = true;
            throw new Error('inspect should not be called for invalid payload');
        };

        try {
            const request = { body: { input: '   ' }, apiKeyId: 'api_key_reddit' } as unknown as Request;
            const responseHandle = createMockResponse();
            await RedditController.inspect(request, responseHandle.res);

            assert.equal(inspectCalled, false);
            assert.equal(responseHandle.getStatusCode(), 400);

            const body = responseHandle.getBody() as {
                success?: boolean;
                error?: { code?: string };
            };
            assert.equal(body.success, false);
            assert.equal(body.error?.code, 'INVALID_REDDIT_REQUEST');
        } finally {
            redditServiceModule.redditService.inspect = originalInspect;
            restoreRequestLog();
        }
    });
});
