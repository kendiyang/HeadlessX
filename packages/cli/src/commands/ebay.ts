import { requestJson } from '../utils/http';
import { writeStructured } from '../utils/output';

interface EbayInspectOptions {
  marketplace?: string;
  timeout?: number;
  stealth?: boolean;
  waitForSelector?: string;
  json?: boolean;
  output?: string;
  pretty?: boolean;
}

export async function handleEbayInspectCommand(
  input: string,
  options: EbayInspectOptions
): Promise<void> {
  const result = await requestJson({
    method: 'POST',
    path: '/api/operators/ebay/inspect',
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
    title: 'eBay Inspect',
  });
}

export async function handleEbayStatusCommand(options: {
  json?: boolean;
  output?: string;
  pretty?: boolean;
}): Promise<void> {
  const result = await requestJson({
    path: '/api/operators/ebay/status',
  });

  writeStructured(result, {
    json: options.json,
    outputPath: options.output,
    pretty: options.pretty,
    title: 'eBay Status',
  });
}
