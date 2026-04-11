import { describe, expect, test, vi, beforeEach } from 'vitest';
import { handleAmazonInspectCommand, handleAmazonStatusCommand } from './amazon';
import { requestJson } from '../utils/http';
import { writeStructured } from '../utils/output';

vi.mock('../utils/http', () => ({
  requestJson: vi.fn(),
}));

vi.mock('../utils/output', () => ({
  writeStructured: vi.fn(),
}));

describe('amazon command handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requestJson).mockResolvedValue({ success: true, data: { ok: true } });
  });

  test('handleAmazonInspectCommand calls amazon inspect endpoint with mapped body', async () => {
    await handleAmazonInspectCommand('B012345678', {
      marketplace: 'amazon.com',
      reviews: true,
      reviewPageLimit: 2,
      reviewSortBy: 'helpful',
      reviewStar: 'critical',
      reviewerType: 'all_reviews',
      reviewStopAtId: 'R123',
      timeout: 30000,
      stealth: false,
      waitForSelector: '#productTitle',
      json: true,
      pretty: true,
      output: '/tmp/amazon.json',
    });

    expect(requestJson).toHaveBeenCalledWith({
      method: 'POST',
      path: '/api/operators/amazon/inspect',
      body: {
        input: 'B012345678',
        marketplace: 'amazon.com',
        includeReviews: true,
        reviewPageLimit: 2,
        reviewSortBy: 'helpful',
        reviewStar: 'critical',
        reviewerType: 'all_reviews',
        reviewStopAtId: 'R123',
        timeout: 30000,
        stealth: false,
        waitForSelector: '#productTitle',
      },
    });

    expect(writeStructured).toHaveBeenCalledWith(
      { success: true, data: { ok: true } },
      {
        json: true,
        outputPath: '/tmp/amazon.json',
        pretty: true,
        title: 'Amazon Inspect',
      }
    );
  });

  test('handleAmazonStatusCommand calls status endpoint', async () => {
    await handleAmazonStatusCommand({
      json: true,
      pretty: true,
      output: '/tmp/amazon-status.json',
    });

    expect(requestJson).toHaveBeenCalledWith({
      path: '/api/operators/amazon/status',
    });

    expect(writeStructured).toHaveBeenCalledWith(
      { success: true, data: { ok: true } },
      {
        json: true,
        outputPath: '/tmp/amazon-status.json',
        pretty: true,
        title: 'Amazon Status',
      }
    );
  });
});
