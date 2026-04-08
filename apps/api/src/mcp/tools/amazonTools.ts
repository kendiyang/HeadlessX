import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { READ_ONLY_TOOL_ANNOTATIONS } from '../annotations';
import { jsonTitleMarkdown } from '../formatters';
import { createToolError, createToolSuccess } from '../responses';
import { GenericToolResultSchema, ResponseFormatSchema } from '../schemas';
import type { McpToolContext } from '../types';
import { amazonService } from '../../services/commerce/AmazonService';

export function registerAmazonTools(server: McpServer, _context: McpToolContext) {
    server.registerTool(
        'headlessx_amazon_inspect',
        {
            title: 'HeadlessX Amazon Inspect',
            description: 'Inspect Amazon product, pricing, review, and marketplace data for catalog and pricing research.',
            inputSchema: z.object({
                input: z.string().trim().min(1),
                marketplace: z.string().trim().min(2).max(64).optional(),
                include_reviews: z.boolean().optional().default(true),
                review_page_limit: z.number().int().min(1).max(10).optional().default(3),
                review_sort_by: z.enum(['recent', 'helpful']).optional().default('recent'),
                reviewer_type: z.string().trim().min(1).max(64).optional().default('all_reviews'),
                review_stop_at_id: z.string().trim().min(1).max(128).optional(),
                timeout_ms: z.number().int().min(5000).max(180000).optional(),
                stealth: z.boolean().optional(),
                wait_for_selector: z.string().trim().min(1).max(256).optional(),
                response_format: ResponseFormatSchema,
            }),
            outputSchema: GenericToolResultSchema,
            annotations: READ_ONLY_TOOL_ANNOTATIONS,
        },
        async (args) => {
            try {
                const result = await amazonService.inspect({
                    input: args.input,
                    marketplace: args.marketplace,
                    includeReviews: args.include_reviews,
                    reviewPageLimit: args.review_page_limit,
                    reviewSortBy: args.review_sort_by,
                    reviewerType: args.reviewer_type,
                    reviewStopAtId: args.review_stop_at_id,
                    timeout: args.timeout_ms,
                    stealth: args.stealth,
                    waitForSelector: args.wait_for_selector,
                });

                return createToolSuccess(result, args.response_format, jsonTitleMarkdown('Amazon Inspect', result));
            } catch (error) {
                return createToolError(error instanceof Error ? error.message : 'Amazon inspect failed');
            }
        }
    );

    server.registerTool(
        'headlessx_amazon_status',
        {
            title: 'HeadlessX Amazon Status',
            description: 'Return the current Amazon operator status and defaults.',
            inputSchema: z.object({
                response_format: ResponseFormatSchema,
            }),
            outputSchema: GenericToolResultSchema,
            annotations: READ_ONLY_TOOL_ANNOTATIONS,
        },
        async ({ response_format }) => {
            try {
                const result = amazonService.getStatus();
                return createToolSuccess(result, response_format, jsonTitleMarkdown('Amazon Status', result));
            } catch (error) {
                return createToolError(error instanceof Error ? error.message : 'Amazon status lookup failed');
            }
        }
    );
}
