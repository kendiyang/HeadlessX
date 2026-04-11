import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { READ_ONLY_TOOL_ANNOTATIONS } from '../annotations';
import { jsonTitleMarkdown } from '../formatters';
import { createToolError, createToolSuccess } from '../responses';
import { GenericToolResultSchema, ResponseFormatSchema } from '../schemas';
import type { McpToolContext } from '../types';
import { ebayService } from '../../services/commerce/EbayService';

export function registerEbayTools(server: McpServer, _context: McpToolContext) {
    server.registerTool(
        'headlessx_ebay_inspect',
        {
            title: 'HeadlessX eBay Inspect',
            description: 'Inspect eBay listing metadata, pricing, seller, availability, and review signals.',
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
                const result = await ebayService.inspect({
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

                return createToolSuccess(result, args.response_format, jsonTitleMarkdown('eBay Inspect', result));
            } catch (error) {
                return createToolError(error instanceof Error ? error.message : 'eBay inspect failed');
            }
        }
    );

    server.registerTool(
        'headlessx_ebay_status',
        {
            title: 'HeadlessX eBay Status',
            description: 'Return the current eBay operator status.',
            inputSchema: z.object({
                response_format: ResponseFormatSchema,
            }),
            outputSchema: GenericToolResultSchema,
            annotations: READ_ONLY_TOOL_ANNOTATIONS,
        },
        async ({ response_format }) => {
            try {
                const result = ebayService.getStatus();
                return createToolSuccess(result, response_format, jsonTitleMarkdown('eBay Status', result));
            } catch (error) {
                return createToolError(error instanceof Error ? error.message : 'eBay status lookup failed');
            }
        }
    );
}
