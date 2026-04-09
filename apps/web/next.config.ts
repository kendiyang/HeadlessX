import createMDX from '@next/mdx';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from "next";

const webRoot = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(webRoot, '../..');

function normalizeAllowedDevOrigin(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  // Keep wildcard domain patterns as-is (for example: *.corp.internal).
  if (trimmed.includes('*')) {
    return trimmed;
  }

  try {
    const parsed = trimmed.includes('://')
      ? new URL(trimmed)
      : new URL(`http://${trimmed}`);
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function parseAllowedDevOrigins(inputs: Array<string | undefined>): string[] {
  const output = new Set<string>();

  for (const input of inputs) {
    if (!input) {
      continue;
    }

    for (const rawEntry of input.split(',')) {
      const entry = rawEntry.trim();
      if (!entry) {
        continue;
      }

      const host = normalizeAllowedDevOrigin(entry);
      if (host) {
        output.add(host);
      }
    }
  }

  return Array.from(output);
}

const allowedDevOrigins = parseAllowedDevOrigins([
  process.env.NEXT_ALLOWED_DEV_ORIGINS,
  process.env.FRONTEND_URL,
  process.env.ORIGIN,
]);

// API URL from environment (defaults to localhost:38473 for local dev)
const nextConfig: NextConfig = {
  /* config options here */

  reactCompiler: true,
  // Disable Next.js dev indicator ("N" button + preferences popup).
  devIndicators: false,
  ...(allowedDevOrigins.length > 0 ? { allowedDevOrigins } : {}),
  turbopack: {
    root: workspaceRoot,
  },
  pageExtensions: ['js', 'jsx', 'md', 'mdx', 'ts', 'tsx'],
  serverExternalPackages: [],
  // Disable response buffering for SSE
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'X-Accel-Buffering', value: 'no' },
          { key: 'Cache-Control', value: 'no-cache, no-transform' },
        ],
      },
    ];
  },
};

const withMDX = createMDX({
  extension: /\.mdx$/,
  options: {
    // Use string-based plugin definition for Turbopack compatibility
    remarkPlugins: [["remark-gfm", { strict: true, throwOnError: true }]],
    rehypePlugins: [],
  },
});

export default withMDX(nextConfig);
