import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../database/client';
import {
    AmazonServiceError,
    amazonService,
} from '../../services/commerce/AmazonService';

const AmazonInspectSchema = z.object({
    input: z.string().trim().min(1).max(512),
    marketplace: z.string().trim().min(2).max(64).optional(),
    includeReviews: z.boolean().optional().default(true),
    reviewPageLimit: z.number().int().min(1).max(5000).optional().default(1),
    reviewSortBy: z.enum(['recent', 'helpful']).optional().default('recent'),
    reviewStar: z.enum(['all', 'positive', 'critical']).optional(),
    reviewerType: z.string().trim().min(1).max(64).optional(),
    reviewStopAtId: z.string().trim().min(1).max(128).optional(),
    timeout: z.number().int().min(5000).max(180000).optional(),
    stealth: z.boolean().optional(),
    waitForSelector: z.string().trim().min(1).max(256).optional(),
});

function normalizeError(error: unknown): {
    status: number;
    message: string;
    code: string;
} {
    if (error instanceof AmazonServiceError) {
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
            code: 'INVALID_AMAZON_REQUEST',
        };
    }

    return {
        status: 500,
        message: error instanceof Error ? error.message : 'Amazon inspect failed',
        code: 'AMAZON_INSPECT_FAILED',
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

export class AmazonController {
    static async inspect(req: Request, res: Response) {
        const startTime = Date.now();
        const apiKeyId = req.apiKeyId || null;

        try {
            const payload = AmazonInspectSchema.parse(req.body);

            const data = await amazonService.inspect({
                input: payload.input,
                marketplace: payload.marketplace,
                includeReviews: payload.includeReviews,
                reviewPageLimit: payload.reviewPageLimit,
                reviewSortBy: payload.reviewSortBy,
                reviewStar: payload.reviewStar,
                reviewerType: payload.reviewerType,
                reviewStopAtId: payload.reviewStopAtId,
                timeout: payload.timeout,
                stealth: payload.stealth,
                waitForSelector: payload.waitForSelector,
            });

            await logRequest({
                apiKeyId,
                url: `amazon-inspect://${payload.input}`,
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
                url: `amazon-inspect://${req.body?.input || 'unknown'}`,
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
                data: amazonService.getStatus(),
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
