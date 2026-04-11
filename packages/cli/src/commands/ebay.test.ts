import { describe, expect, test, vi, beforeEach } from 'vitest';
import { handleEbayInspectCommand, handleEbayStatusCommand } from './ebay';
import { requestJson } from '../utils/http';
import { writeStructured } from '../utils/output';

vi.mock('../utils/http', () => ({
  requestJson: vi.fn(),
}));

vi.mock('../utils/output', () => ({
  writeStructured: vi.fn(),
}));

describe('ebay command handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requestJson).mockResolvedValue({ success: true, data: { ok: true } });
  });

  test('handleEbayInspectCommand calls eBay inspect endpoint with mapped body', async () => {
    await handleEbayInspectCommand('123456789012', {
      timeout: 45000,
      stealth: true,
      json: true,
      pretty: true,
      output: '/tmp/ebay.json',
    });

    expect(requestJson).toHaveBeenCalledWith({
      method: 'POST',
      path: '/api/operators/ebay/inspect',
      body: {
        input: '123456789012',
        timeout: 45000,
        stealth: true,
      },
    });

    expect(writeStructured).toHaveBeenCalledWith(
      { success: true, data: { ok: true } },
      {
        json: true,
        outputPath: '/tmp/ebay.json',
        pretty: true,
        title: 'eBay Inspect',
      }
    );
  });

  test('handleEbayInspectCommand maps review options', async () => {
    await handleEbayInspectCommand('123456789012', {
      reviews: false,
      reviewPageLimit: 25,
      reviewSortBy: 'relevant',
      reviewStar: 'negative',
      reviewerType: 'all_reviews',
      reviewStopAtId: 'REV002',
    });

    expect(requestJson).toHaveBeenCalledWith({
      method: 'POST',
      path: '/api/operators/ebay/inspect',
      body: {
        input: '123456789012',
        includeReviews: false,
        reviewPageLimit: 25,
        reviewSortBy: 'relevant',
        reviewStar: 'negative',
        reviewerType: 'all_reviews',
        reviewStopAtId: 'REV002',
      },
    });
  });

  test('handleEbayStatusCommand calls status endpoint', async () => {
    await handleEbayStatusCommand({
      json: true,
      pretty: true,
      output: '/tmp/ebay-status.json',
    });

    expect(requestJson).toHaveBeenCalledWith({
      path: '/api/operators/ebay/status',
    });

    expect(writeStructured).toHaveBeenCalledWith(
      { success: true, data: { ok: true } },
      {
        json: true,
        outputPath: '/tmp/ebay-status.json',
        pretty: true,
        title: 'eBay Status',
      }
    );
  });
});
