import { requestJson } from '../utils/http';
import { writeStructured } from '../utils/output';

interface WalmartInspectOptions {
  marketplace?: string;
  timeout?: number;
  stealth?: boolean;
  waitForSelector?: string;
  json?: boolean;
  output?: string;
  pretty?: boolean;
}

export async function handleWalmartInspectCommand(
  input: string,
  options: WalmartInspectOptions
): Promise<void> {
  const result = await requestJson({
    method: 'POST',
    path: '/api/operators/walmart/inspect',
    body: {
      input,
      ...(options.marketplace ? { marketplace: options.marketplace } : {}),
      ...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
      ...(options.stealth !== undefined ? { stealth: options.stealth } : {}),
      ...(options.waitForSelector ? { waitForSelector: options.waitForSelector } : {}),
    },
  });

  writeStructured(result, {
    json: options.json,
    outputPath: options.output,
    pretty: options.pretty,
    title: 'Walmart Inspect',
  });
}

export async function handleWalmartStatusCommand(options: {
  json?: boolean;
  output?: string;
  pretty?: boolean;
}): Promise<void> {
  const result = await requestJson({
    path: '/api/operators/walmart/status',
  });

  writeStructured(result, {
    json: options.json,
    outputPath: options.output,
    pretty: options.pretty,
    title: 'Walmart Status',
  });
}
