import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { READ_ONLY_TOOL_ANNOTATIONS } from '../annotations';
import { jsonTitleMarkdown } from '../formatters';
import { createToolError, createToolSuccess } from '../responses';
import { GenericToolResultSchema, ResponseFormatSchema } from '../schemas';
import type { McpToolContext } from '../types';
import { redditService } from '../../services/social/RedditService';

export function registerRedditTools(server: McpServer, _context: McpToolContext) {
    server.registerTool(
        'headlessx_reddit_inspect',
        {
            title: 'HeadlessX Reddit Inspect',
            description: 'Inspect Reddit thread/listing data using Reddit JSON endpoints (.json).',
            inputSchema: z.object({
                input: z.string().trim().min(1),
                sort: z.string().trim().min(1).max(32).optional(),
                timeframe: z.enum(['hour', 'day', 'week', 'month', 'year', 'all']).optional(),
                limit: z.number().int().min(1).max(500).optional(),
                depth: z.number().int().min(0).max(10).optional(),
                timeout_ms: z.number().int().min(3000).max(120000).optional(),
                include_raw: z.boolean().optional(),
                response_format: ResponseFormatSchema,
            }),
            outputSchema: GenericToolResultSchema,
            annotations: READ_ONLY_TOOL_ANNOTATIONS,
        },
        async (args) => {
            try {
                const result = await redditService.inspect({
                    input: args.input,
                    sort: args.sort,
                    timeframe: args.timeframe,
                    limit: args.limit,
                    depth: args.depth,
                    timeout: args.timeout_ms,
                    includeRaw: args.include_raw,
                });

                return createToolSuccess(result, args.response_format, jsonTitleMarkdown('Reddit Inspect', result));
            } catch (error) {
                return createToolError(error instanceof Error ? error.message : 'Reddit inspect failed');
            }
        }
    );

    server.registerTool(
        'headlessx_reddit_status',
        {
            title: 'HeadlessX Reddit Status',
            description: 'Return the current Reddit operator status.',
            inputSchema: z.object({
                response_format: ResponseFormatSchema,
            }),
            outputSchema: GenericToolResultSchema,
            annotations: READ_ONLY_TOOL_ANNOTATIONS,
        },
        async ({ response_format }) => {
            try {
                const result = redditService.getStatus();
                return createToolSuccess(result, response_format, jsonTitleMarkdown('Reddit Status', result));
            } catch (error) {
                return createToolError(error instanceof Error ? error.message : 'Reddit status lookup failed');
            }
        }
    );
}
