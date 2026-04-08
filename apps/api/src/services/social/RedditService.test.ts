import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

process.env.DATABASE_URL ||= 'postgresql://user:pass@localhost:5432/headlessx_test';

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

describe('RedditService', () => {
    it('normalizes thread URLs to .json endpoint and extracts post + comments', async () => {
        const { redditService } = await import('./RedditService');
        let requestedUrl = '';

        globalThis.fetch = async (input) => {
            requestedUrl = String(input);
            return new Response(
                JSON.stringify([
                    {
                        kind: 'Listing',
                        data: {
                            children: [
                                {
                                    kind: 't3',
                                    data: {
                                        id: '1s0kubi',
                                        name: 't3_1s0kubi',
                                        subreddit: 'AskMarketing',
                                        title: 'Sick of the back-and-forth for TikTok Spark Ads',
                                        author: 'founder_qa',
                                        score: 112,
                                        num_comments: 3,
                                        permalink: '/r/AskMarketing/comments/1s0kubi/sick_of_the_backandforth_for_tiktok_spark_ads/',
                                    },
                                },
                            ],
                        },
                    },
                    {
                        kind: 'Listing',
                        data: {
                            children: [
                                {
                                    kind: 't1',
                                    data: {
                                        id: 'i1',
                                        name: 't1_i1',
                                        parent_id: 't3_1s0kubi',
                                        depth: 0,
                                        author: 'commenter_a',
                                        body: 'This is super useful.',
                                        score: 9,
                                        permalink: '/r/AskMarketing/comments/1s0kubi/-/i1/',
                                        replies: {
                                            kind: 'Listing',
                                            data: {
                                                children: [
                                                    {
                                                        kind: 't1',
                                                        data: {
                                                            id: 'i2',
                                                            name: 't1_i2',
                                                            parent_id: 't1_i1',
                                                            depth: 1,
                                                            author: 'commenter_b',
                                                            body: 'Agreed.',
                                                            score: 4,
                                                            permalink: '/r/AskMarketing/comments/1s0kubi/-/i2/',
                                                        },
                                                    },
                                                ],
                                            },
                                        },
                                    },
                                },
                                {
                                    kind: 'more',
                                    data: {
                                        count: 1,
                                    },
                                },
                            ],
                        },
                    },
                ]),
                {
                    status: 200,
                    headers: {
                        'content-type': 'application/json; charset=utf-8',
                    },
                }
            );
        };

        const result = await redditService.inspect({
            input: 'https://www.reddit.com/r/AskMarketing/comments/1s0kubi/sick_of_the_backandforth_for_tiktok_spark_ads',
            sort: 'new',
            timeframe: 'week',
            limit: 50,
            depth: 4,
            timeout: 30000,
        });

        assert.equal(result.target.mode, 'thread');
        assert.equal(result.target.postId, '1s0kubi');
        assert.equal(result.thread?.post?.id, '1s0kubi');
        assert.equal(result.thread?.comments.length, 2);
        assert.equal(result.thread?.moreComments, 1);
        assert.ok(requestedUrl.includes('/comments/1s0kubi/sick_of_the_backandforth_for_tiktok_spark_ads.json'));
        assert.ok(requestedUrl.includes('raw_json=1'));
        assert.ok(requestedUrl.includes('sort=new'));
        assert.ok(requestedUrl.includes('limit=50'));
        assert.ok(requestedUrl.includes('depth=4'));
    });

    it('extracts subreddit listings from listing payload', async () => {
        const { redditService } = await import('./RedditService');

        globalThis.fetch = async () =>
            new Response(
                JSON.stringify({
                    kind: 'Listing',
                    data: {
                        dist: 2,
                        after: 't3_after',
                        before: null,
                        children: [
                            {
                                kind: 't3',
                                data: {
                                    id: 'abc111',
                                    name: 't3_abc111',
                                    subreddit: 'marketing',
                                    title: 'Post A',
                                    author: 'author_a',
                                    score: 11,
                                    permalink: '/r/marketing/comments/abc111/post_a/',
                                },
                            },
                            {
                                kind: 't3',
                                data: {
                                    id: 'abc222',
                                    name: 't3_abc222',
                                    subreddit: 'marketing',
                                    title: 'Post B',
                                    author: 'author_b',
                                    score: 7,
                                    permalink: '/r/marketing/comments/abc222/post_b/',
                                },
                            },
                        ],
                    },
                }),
                {
                    status: 200,
                    headers: {
                        'content-type': 'application/json',
                    },
                }
            );

        const result = await redditService.inspect({
            input: '/r/marketing',
            limit: 20,
            sort: 'hot',
        });

        assert.equal(result.target.mode, 'listing');
        assert.equal(result.listing?.posts.length, 2);
        assert.equal(result.listing?.dist, 2);
        assert.equal(result.listing?.posts[0]?.title, 'Post A');
    });

    it('rejects non-reddit hosts', async () => {
        const { redditService, RedditServiceError } = await import('./RedditService');

        await assert.rejects(
            () =>
                redditService.inspect({
                    input: 'https://reddit.evil.com/r/AskMarketing/comments/1s0kubi/post',
                }),
            (error: unknown) => {
                assert.equal(error instanceof RedditServiceError, true);
                assert.equal((error as RedditServiceError).code, 'INVALID_REDDIT_INPUT');
                return true;
            }
        );
    });

    it('maps 429 responses to REDDIT_RATE_LIMITED', async () => {
        const { redditService, RedditServiceError } = await import('./RedditService');

        globalThis.fetch = async () =>
            new Response('rate limited', {
                status: 429,
                headers: {
                    'content-type': 'text/plain',
                },
            });

        await assert.rejects(
            () =>
                redditService.inspect({
                    input: 'https://www.reddit.com/r/AskMarketing/comments/1s0kubi/post',
                }),
            (error: unknown) => {
                assert.equal(error instanceof RedditServiceError, true);
                assert.equal((error as RedditServiceError).code, 'REDDIT_RATE_LIMITED');
                assert.equal((error as RedditServiceError).statusCode, 429);
                return true;
            }
        );
    });
});
