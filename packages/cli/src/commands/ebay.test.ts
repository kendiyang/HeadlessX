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
      marketplace: 'ebay.com',
      timeout: 45000,
      stealth: true,
      waitForSelector: '.x-price-primary',
      json: true,
      pretty: true,
      output: '/tmp/ebay.json',
    });

    expect(requestJson).toHaveBeenCalledWith({
      method: 'POST',
      path: '/api/operators/ebay/inspect',
      body: {
        input: '123456789012',
        marketplace: 'ebay.com',
        timeout: 45000,
        stealth: true,
        waitForSelector: '.x-price-primary',
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
