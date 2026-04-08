import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    asRecord,
    asString,
    buildDiagnostics,
    createDom,
    dedupeStrings,
    findFirstBySchemaType,
    parseCurrency,
    parseNumericPrice,
    readJsonLdObjects,
    resolveMarketplaceInputUrl,
} from './CommerceInspectCore';

describe('CommerceInspectCore', () => {
    it('parses and deduplicates diagnostics payload fields', () => {
        const diagnostics = buildDiagnostics({
            blocked: true,
            warnings: [' A ', 'A', 'B'],
            crawledUrls: ['https://a.example', 'https://a.example', 'https://b.example'],
            antiBotSignals: ['url:/captcha', 'url:/captcha', 'html:are you a robot'],
        });

        assert.equal(diagnostics.blocked, true);
        assert.deepEqual(diagnostics.warnings, ['A', 'B']);
        assert.deepEqual(diagnostics.crawledUrls, ['https://a.example', 'https://b.example']);
        assert.deepEqual(diagnostics.antiBotSignals, ['url:/captcha', 'html:are you a robot']);
        assert.ok(typeof diagnostics.generatedAt === 'string' && diagnostics.generatedAt.length > 0);
    });

    it('resolves marketplace URL from direct URL, path, and ID builder', () => {
        const hostPattern =
            /^(?:[a-z0-9-]+\.)*ebay\.(?:com|ca|com\.au|co\.uk|de|fr|it|es|nl|be|at|ch|ie|pl|com\.hk|com\.sg|ph)$/i;
        const resolvedDirect = resolveMarketplaceInputUrl('https://www.ebay.com/itm/123', {
            defaultHost: 'www.ebay.com',
            hostPattern,
        });
        const resolvedPath = resolveMarketplaceInputUrl('/itm/123', {
            defaultHost: 'www.ebay.com',
            hostPattern,
        });
        const resolvedId = resolveMarketplaceInputUrl('123456789012', {
            defaultHost: 'www.ebay.com',
            hostPattern,
            idPathBuilder: (value) => (/^\d+$/.test(value) ? `/itm/${value}` : null),
        });

        assert.equal(resolvedDirect, 'https://www.ebay.com/itm/123');
        assert.equal(resolvedPath, 'https://www.ebay.com/itm/123');
        assert.equal(resolvedId, 'https://www.ebay.com/itm/123456789012');
    });

    it('rejects deceptive marketplace hosts that only prefix-match brand domains', () => {
        const hostPattern = /^(?:[a-z0-9-]+\.)*ebay\.(?:com|co\.uk|de)$/i;
        const resolved = resolveMarketplaceInputUrl('https://ebay.evil.com/itm/123', {
            defaultHost: 'www.ebay.com',
            hostPattern,
        });

        assert.equal(resolved, null);
    });

    it('parses price and currency robustly', () => {
        assert.equal(parseNumericPrice('$1,299.95'), 1299.95);
        assert.equal(parseNumericPrice('EUR 89,50'), 89.5);
        assert.equal(parseNumericPrice('€1.234,56'), 1234.56);
        assert.equal(parseNumericPrice('1.234.567,89'), 1234567.89);
        assert.equal(parseNumericPrice(null), null);

        assert.equal(parseCurrency('USD 1,299.95'), 'USD');
        assert.equal(parseCurrency('GBP 22.00'), 'GBP');
        assert.equal(parseCurrency('€15,00'), 'EUR');
        assert.equal(parseCurrency('CA$49.99'), 'CAD');
        assert.equal(parseCurrency('$49.99'), null);
        assert.equal(parseCurrency('plain-text'), null);
    });

    it('extracts JSON-LD graph objects and finds schema types', () => {
        const document = createDom(
            `
            <html>
              <head>
                <script type="application/ld+json">
                  {
                    "@context":"https://schema.org",
                    "@graph":[
                      {"@type":"Organization","name":"Store"},
                      {"@type":"Product","name":"Demo Product","offers":{"@type":"Offer","price":"19.99","priceCurrency":"USD"}}
                    ]
                  }
                </script>
              </head>
            </html>
            `,
            'https://example.com/p/1'
        );

        const objects = readJsonLdObjects(document);
        const product = findFirstBySchemaType(objects, 'Product');
        const offer = asRecord(product?.offers);

        assert.ok(objects.length >= 2);
        assert.equal(asString(product?.name), 'Demo Product');
        assert.equal(asString(offer?.price), '19.99');
        assert.equal(asString(offer?.priceCurrency), 'USD');
    });

    it('dedupes cleaned strings', () => {
        assert.deepEqual(dedupeStrings([' one ', 'one', '', null, 'two']), ['one', 'two']);
    });
});
