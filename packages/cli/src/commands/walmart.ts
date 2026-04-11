import { requestJson } from '../utils/http';
import { writeStructured } from '../utils/output';

interface WalmartInspectOptions {
  reviews?: boolean;
  reviewPageLimit?: number;
  reviewSortBy?: 'recent' | 'relevant' | 'helpful';
  reviewStar?: 'all' | 'positive' | 'neutral' | 'negative' | 'critical';
  reviewerType?: string;
  reviewStopAtId?: string;
  timeout?: number;
  stealth?: boolean;
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
      ...(options.reviews !== undefined ? { includeReviews: options.reviews } : {}),
      ...(options.reviewPageLimit !== undefined ? { reviewPageLimit: options.reviewPageLimit } : {}),
      ...(options.reviewSortBy ? { reviewSortBy: options.reviewSortBy } : {}),
      ...(options.reviewStar ? { reviewStar: options.reviewStar } : {}),
      ...(options.reviewerType ? { reviewerType: options.reviewerType } : {}),
      ...(options.reviewStopAtId ? { reviewStopAtId: options.reviewStopAtId } : {}),
      ...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
      ...(options.stealth !== undefined ? { stealth: options.stealth } : {}),
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
