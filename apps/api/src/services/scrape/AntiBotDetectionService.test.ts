import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { antiBotDetectionService } from './AntiBotDetectionService';

describe('AntiBotDetectionService', () => {
    it('detects amazon block from URL signal', () => {
        const result = antiBotDetectionService.detect(
            'amazon',
            'https://www.amazon.com/errors/validatecaptcha',
            '<html><body>ok</body></html>'
        );

        assert.equal(result.blocked, true);
        assert.ok(result.matchedSignals.some((signal) => signal === 'url:/errors/validatecaptcha'));
    });

    it('detects amazon block from HTML signal', () => {
        const result = antiBotDetectionService.detect(
            'amazon',
            'https://www.amazon.com/dp/B012345678',
            '<html><body>Sorry, we just need to make sure you\'re not a robot</body></html>'
        );

        assert.equal(result.blocked, true);
        assert.ok(result.matchedSignals.some((signal) => signal.includes('html:sorry, we just need to make sure')));
    });

    it('detects ebay block from HTML signal', () => {
        const result = antiBotDetectionService.detect(
            'ebay',
            'https://www.ebay.com/itm/123456789012',
            '<html><body>Pardon our interruption. Please verify yourself.</body></html>'
        );

        assert.equal(result.blocked, true);
        assert.ok(result.matchedSignals.some((signal) => signal.includes('html:pardon our interruption')));
    });

    it('detects walmart block from URL signal', () => {
        const result = antiBotDetectionService.detect(
            'walmart',
            'https://www.walmart.com/blocked',
            '<html><body>ok</body></html>'
        );

        assert.equal(result.blocked, true);
        assert.ok(result.matchedSignals.some((signal) => signal === 'url:/blocked'));
    });

    it('returns not blocked when no signals matched', () => {
        const result = antiBotDetectionService.detect(
            'amazon',
            'https://www.amazon.com/dp/B012345678',
            '<html><body>normal product page</body></html>'
        );

        assert.equal(result.blocked, false);
        assert.equal(result.matchedSignals.length, 0);
    });
});
