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
            description: 'Inspect eBay listing metadata, pricing, seller, and availability signals.',
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
                const result = await ebayService.inspect({
                    input: args.input,
                    marketplace: args.marketplace,
                    timeout: args.timeout_ms,
                    stealth: args.stealth,
                    waitForSelector: args.wait_for_selector,
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
