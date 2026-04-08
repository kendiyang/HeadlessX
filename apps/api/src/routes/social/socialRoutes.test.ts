import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

process.env.DATABASE_URL ||= 'postgresql://user:pass@localhost:5432/headlessx_test';

interface LayerLike {
    handle?: {
        name?: string;
    };
    name?: string;
    route?: {
        path: string;
        methods: Record<string, boolean>;
    };
}

function listMiddlewareNames(router: { stack?: LayerLike[] }): string[] {
    return (router.stack || [])
        .filter((layer) => !layer.route)
        .map((layer) => layer.handle?.name || layer.name || '');
}

function listRoutes(router: { stack?: LayerLike[] }): Array<{ path: string; methods: string[] }> {
    return (router.stack || [])
        .filter((layer): layer is Required<Pick<LayerLike, 'route'>> => Boolean(layer.route))
        .map((layer) => ({
            path: layer.route.path,
            methods: Object.keys(layer.route.methods).sort(),
        }));
}

describe('social routes wiring', () => {
    it('reddit routes keep framework middleware and endpoint mapping', async () => {
        const module = await import('./redditRoutes');
        const router = module.default as { stack?: LayerLike[] };

        const middlewareNames = listMiddlewareNames(router);
        assert.deepEqual(middlewareNames.slice(0, 2), ['RequestLogger', 'ApiKeyGuard']);

        assert.deepEqual(listRoutes(router), [
            { path: '/inspect', methods: ['post'] },
            { path: '/status', methods: ['get'] },
        ]);
    });
});
