import { requestJson } from '../utils/http';
import { writeStructured } from '../utils/output';

interface RedditInspectOptions {
  sort?: string;
  timeframe?: 'hour' | 'day' | 'week' | 'month' | 'year' | 'all';
  limit?: number;
  depth?: number;
  timeout?: number;
  includeRaw?: boolean;
  json?: boolean;
  output?: string;
  pretty?: boolean;
}

export async function handleRedditInspectCommand(
  input: string,
  options: RedditInspectOptions
): Promise<void> {
  const result = await requestJson({
    method: 'POST',
    path: '/api/operators/reddit/inspect',
    body: {
      input,
      ...(options.sort ? { sort: options.sort } : {}),
      ...(options.timeframe ? { timeframe: options.timeframe } : {}),
      ...(options.limit !== undefined ? { limit: options.limit } : {}),
      ...(options.depth !== undefined ? { depth: options.depth } : {}),
      ...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
      ...(options.includeRaw ? { includeRaw: true } : {}),
    },
  });

  writeStructured(result, {
    json: options.json,
    outputPath: options.output,
    pretty: options.pretty,
    title: 'Reddit Inspect',
  });
}

export async function handleRedditStatusCommand(options: {
  json?: boolean;
  output?: string;
  pretty?: boolean;
}): Promise<void> {
  const result = await requestJson({
    path: '/api/operators/reddit/status',
  });

  writeStructured(result, {
    json: options.json,
    outputPath: options.output,
    pretty: options.pretty,
    title: 'Reddit Status',
  });
}
