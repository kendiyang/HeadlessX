import { describe, expect, test, vi, beforeEach } from 'vitest';
import { handleWalmartInspectCommand, handleWalmartStatusCommand } from './walmart';
import { requestJson } from '../utils/http';
import { writeStructured } from '../utils/output';

vi.mock('../utils/http', () => ({
  requestJson: vi.fn(),
}));

vi.mock('../utils/output', () => ({
  writeStructured: vi.fn(),
}));

describe('walmart command handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requestJson).mockResolvedValue({ success: true, data: { ok: true } });
  });

  test('handleWalmartInspectCommand calls walmart inspect endpoint with mapped body', async () => {
    await handleWalmartInspectCommand('123456789', {
      marketplace: 'walmart.com',
      timeout: 30000,
      stealth: false,
      waitForSelector: '[data-testid="price-wrap"]',
      json: true,
      pretty: true,
      output: '/tmp/walmart.json',
    });

    expect(requestJson).toHaveBeenCalledWith({
      method: 'POST',
      path: '/api/operators/walmart/inspect',
      body: {
        input: '123456789',
        marketplace: 'walmart.com',
        timeout: 30000,
        stealth: false,
        waitForSelector: '[data-testid="price-wrap"]',
      },
    });

    expect(writeStructured).toHaveBeenCalledWith(
      { success: true, data: { ok: true } },
      {
        json: true,
        outputPath: '/tmp/walmart.json',
        pretty: true,
        title: 'Walmart Inspect',
      }
    );
  });

  test('handleWalmartStatusCommand calls status endpoint', async () => {
    await handleWalmartStatusCommand({
      json: true,
      pretty: true,
      output: '/tmp/walmart-status.json',
    });

    expect(requestJson).toHaveBeenCalledWith({
      path: '/api/operators/walmart/status',
    });

    expect(writeStructured).toHaveBeenCalledWith(
      { success: true, data: { ok: true } },
      {
        json: true,
        outputPath: '/tmp/walmart-status.json',
        pretty: true,
        title: 'Walmart Status',
      }
    );
  });
});
