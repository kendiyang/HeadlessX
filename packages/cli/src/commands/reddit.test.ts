import { describe, expect, test, vi, beforeEach } from 'vitest';
import { handleRedditInspectCommand, handleRedditStatusCommand } from './reddit';
import { requestJson } from '../utils/http';
import { writeStructured } from '../utils/output';

vi.mock('../utils/http', () => ({
  requestJson: vi.fn(),
}));

vi.mock('../utils/output', () => ({
  writeStructured: vi.fn(),
}));

describe('reddit command handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requestJson).mockResolvedValue({ success: true, data: { ok: true } });
  });

  test('handleRedditInspectCommand calls Reddit inspect endpoint with mapped body', async () => {
    await handleRedditInspectCommand('https://www.reddit.com/r/AskMarketing/comments/1s0kubi/post', {
      sort: 'new',
      timeframe: 'week',
      limit: 120,
      depth: 4,
      timeout: 30000,
      includeRaw: true,
      json: true,
      pretty: true,
      output: '/tmp/reddit.json',
    });

    expect(requestJson).toHaveBeenCalledWith({
      method: 'POST',
      path: '/api/operators/reddit/inspect',
      body: {
        input: 'https://www.reddit.com/r/AskMarketing/comments/1s0kubi/post',
        sort: 'new',
        timeframe: 'week',
        limit: 120,
        depth: 4,
        timeout: 30000,
        includeRaw: true,
      },
    });

    expect(writeStructured).toHaveBeenCalledWith(
      { success: true, data: { ok: true } },
      {
        json: true,
        outputPath: '/tmp/reddit.json',
        pretty: true,
        title: 'Reddit Inspect',
      }
    );
  });

  test('handleRedditStatusCommand calls status endpoint', async () => {
    await handleRedditStatusCommand({
      json: true,
      pretty: true,
      output: '/tmp/reddit-status.json',
    });

    expect(requestJson).toHaveBeenCalledWith({
      path: '/api/operators/reddit/status',
    });

    expect(writeStructured).toHaveBeenCalledWith(
      { success: true, data: { ok: true } },
      {
        json: true,
        outputPath: '/tmp/reddit-status.json',
        pretty: true,
        title: 'Reddit Status',
      }
    );
  });
});
