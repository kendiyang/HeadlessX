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
            description: 'Inspect Walmart product metadata, pricing, seller, and availability signals.',
            inputSchema: z.object({
                input: z.string().trim().min(1),
                marketplace: z.string().trim().min(2).max(64).optional(),
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
                const result = await walmartService.inspect({
                    input: args.input,
                    marketplace: args.marketplace,
                    timeout: args.timeout_ms,
                    stealth: args.stealth,
                    waitForSelector: args.wait_for_selector,
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
