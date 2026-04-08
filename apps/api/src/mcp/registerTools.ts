import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpToolContext } from './types';
import { registerAmazonTools } from './tools/amazonTools';
import { registerEbayTools } from './tools/ebayTools';
import { registerExaTools } from './tools/exaTools';
import { registerGoogleSerpTools } from './tools/googleSerpTools';
import { registerJobTools } from './tools/jobTools';
import { registerRedditTools } from './tools/redditTools';
import { registerTavilyTools } from './tools/tavilyTools';
import { registerWebsiteTools } from './tools/websiteTools';
import { registerWalmartTools } from './tools/walmartTools';
import { registerYoutubeTools } from './tools/youtubeTools';

export function registerHeadlessXTools(server: McpServer, context: McpToolContext) {
    registerWebsiteTools(server, context);
    registerGoogleSerpTools(server, context);
    registerTavilyTools(server, context);
    registerExaTools(server, context);
    registerYoutubeTools(server, context);
    registerAmazonTools(server, context);
    registerEbayTools(server, context);
    registerWalmartTools(server, context);
    registerRedditTools(server, context);
    registerJobTools(server, context);
}
