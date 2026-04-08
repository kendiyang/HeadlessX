import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../database/client';
import { redditService, RedditServiceError } from '../../services/social/RedditService';

const RedditInspectSchema = z.object({
    input: z.string().trim().min(1).max(1024),
    sort: z.string().trim().min(1).max(32).optional(),
    timeframe: z.enum(['hour', 'day', 'week', 'month', 'year', 'all']).optional(),
    limit: z.number().int().min(1).max(500).optional(),
    depth: z.number().int().min(0).max(10).optional(),
    timeout: z.number().int().min(3000).max(120000).optional(),
    includeRaw: z.boolean().optional(),
});

function normalizeError(error: unknown): {
    status: number;
    message: string;
    code: string;
} {
    if (error instanceof RedditServiceError) {
        return {
            status: error.statusCode,
            message: error.message,
            code: error.code,
        };
    }

    if (error instanceof z.ZodError) {
        return {
            status: 400,
            message: error.issues.map((issue) => issue.message).join(', '),
            code: 'INVALID_REDDIT_REQUEST',
        };
    }

    return {
        status: 500,
        message: error instanceof Error ? error.message : 'Reddit inspect failed',
        code: 'REDDIT_INSPECT_FAILED',
    };
}

async function logRequest(input: {
    apiKeyId?: string | null;
    url: string;
    method: string;
    statusCode: number;
    durationMs: number;
    errorMessage?: string | null;
}) {
    return prisma.requestLog.create({
        data: {
            api_key_id: input.apiKeyId || null,
            url: input.url,
            method: input.method,
            status_code: input.statusCode,
            duration_ms: input.durationMs,
            error_message: input.errorMessage || null,
        },
    }).catch((err) => console.error('Log failed:', err));
}

export class RedditController {
    static async inspect(req: Request, res: Response) {
        const startTime = Date.now();
        const apiKeyId = req.apiKeyId || null;

        try {
            const payload = RedditInspectSchema.parse(req.body);
            const data = await redditService.inspect(payload);

            await logRequest({
                apiKeyId,
                url: `reddit-inspect://${payload.input}`,
                method: 'POST',
                statusCode: 200,
                durationMs: Date.now() - startTime,
            });

            res.json({
                success: true,
                data,
            });
        } catch (error) {
            const normalized = normalizeError(error);

            await logRequest({
                apiKeyId,
                url: `reddit-inspect://${req.body?.input || 'unknown'}`,
                method: 'POST',
                statusCode: normalized.status,
                durationMs: Date.now() - startTime,
                errorMessage: normalized.message,
            });

            res.status(normalized.status).json({
                success: false,
                error: {
                    code: normalized.code,
                    message: normalized.message,
                },
            });
        }
    }

    static async status(_req: Request, res: Response) {
        try {
            res.json({
                success: true,
                data: redditService.getStatus(),
            });
        } catch (error) {
            const normalized = normalizeError(error);
            res.status(normalized.status).json({
                success: false,
                error: {
                    code: normalized.code,
                    message: normalized.message,
                },
            });
        }
    }
}
