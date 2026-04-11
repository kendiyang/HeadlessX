import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { READ_ONLY_TOOL_ANNOTATIONS } from '../annotations';
import { jsonTitleMarkdown } from '../formatters';
import { createToolError, createToolSuccess } from '../responses';
import { GenericToolResultSchema, ResponseFormatSchema } from '../schemas';
import type { McpToolContext } from '../types';
import { walmartService } from '../../services/commerce/WalmartService';

export function registerWalmartTools(server: McpServer, _context: McpToolContext) {
    server.registerTool(
        'headlessx_walmart_inspect',
        {
            title: 'HeadlessX Walmart Inspect',
            description: 'Inspect Walmart product metadata, pricing, seller, and review signals.',
            inputSchema: z.object({
                input: z.string().trim().min(1),
                include_reviews: z.boolean().optional(),
                review_page_limit: z.number().int().min(1).max(5000).optional(),
                review_sort_by: z.enum(['recent', 'relevant', 'helpful']).optional(),
                review_star: z.enum(['all', 'positive', 'neutral', 'negative', 'critical']).optional(),
                reviewer_type: z.string().trim().min(1).max(64).optional(),
                review_stop_at_id: z.string().trim().min(1).max(128).optional(),
                timeout_ms: z.number().int().min(5000).max(180000).optional(),
                stealth: z.boolean().optional(),
                response_format: ResponseFormatSchema,
            }),
            outputSchema: GenericToolResultSchema,
            annotations: READ_ONLY_TOOL_ANNOTATIONS,
        },
        async (args) => {
            try {
                const result = await walmartService.inspect({
                    input: args.input,
                    includeReviews: args.include_reviews,
                    reviewPageLimit: args.review_page_limit,
                    reviewSortBy: args.review_sort_by,
                    reviewStar: args.review_star,
                    reviewerType: args.reviewer_type,
                    reviewStopAtId: args.review_stop_at_id,
                    timeout: args.timeout_ms,
                    stealth: args.stealth,
                });

                return createToolSuccess(result, args.response_format, jsonTitleMarkdown('Walmart Inspect', result));
            } catch (error) {
                return createToolError(error instanceof Error ? error.message : 'Walmart inspect failed');
            }
        }
    );

    server.registerTool(
        'headlessx_walmart_status',
        {
            title: 'HeadlessX Walmart Status',
            description: 'Return the current Walmart operator status.',
            inputSchema: z.object({
                response_format: ResponseFormatSchema,
            }),
            outputSchema: GenericToolResultSchema,
            annotations: READ_ONLY_TOOL_ANNOTATIONS,
        },
        async ({ response_format }) => {
            try {
                const result = walmartService.getStatus();
                return createToolSuccess(result, response_format, jsonTitleMarkdown('Walmart Status', result));
            } catch (error) {
                return createToolError(error instanceof Error ? error.message : 'Walmart status lookup failed');
            }
        }
    );
}
