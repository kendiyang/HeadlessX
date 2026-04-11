import { requestJson } from '../utils/http';
import { writeStructured } from '../utils/output';

interface AmazonInspectOptions {
  marketplace?: string;
  reviews?: boolean;
  reviewPageLimit?: number;
  reviewSortBy?: 'recent' | 'helpful';
  reviewStar?: 'all' | 'positive' | 'critical';
  reviewerType?: string;
  reviewStopAtId?: string;
  timeout?: number;
  stealth?: boolean;
  waitForSelector?: string;
  json?: boolean;
  output?: string;
  pretty?: boolean;
}

export async function handleAmazonInspectCommand(
  input: string,
  options: AmazonInspectOptions
): Promise<void> {
  const result = await requestJson({
    method: 'POST',
    path: '/api/operators/amazon/inspect',
    body: {
      input,
      ...(options.marketplace ? { marketplace: options.marketplace } : {}),
      ...(options.reviews !== undefined ? { includeReviews: options.reviews } : {}),
      ...(options.reviewPageLimit !== undefined ? { reviewPageLimit: options.reviewPageLimit } : {}),
      ...(options.reviewSortBy ? { reviewSortBy: options.reviewSortBy } : {}),
      ...(options.reviewStar ? { reviewStar: options.reviewStar } : {}),
      ...(options.reviewerType ? { reviewerType: options.reviewerType } : {}),
      ...(options.reviewStopAtId ? { reviewStopAtId: options.reviewStopAtId } : {}),
      ...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
      ...(options.stealth !== undefined ? { stealth: options.stealth } : {}),
      ...(options.waitForSelector ? { waitForSelector: options.waitForSelector } : {}),
    },
  });

  writeStructured(result, {
    json: options.json,
    outputPath: options.output,
    pretty: options.pretty,
    title: 'Amazon Inspect',
  });
}

export async function handleAmazonStatusCommand(options: {
  json?: boolean;
  output?: string;
  pretty?: boolean;
}): Promise<void> {
  const result = await requestJson({
    path: '/api/operators/amazon/status',
  });

  writeStructured(result, {
    json: options.json,
    outputPath: options.output,
    pretty: options.pretty,
    title: 'Amazon Status',
  });
}
