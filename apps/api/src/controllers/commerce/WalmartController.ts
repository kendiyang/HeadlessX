import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../database/client';
import { walmartService, WalmartServiceError } from '../../services/commerce/WalmartService';

const WalmartInspectSchema = z.object({
    input: z.string().trim().min(1).max(512),
    includeReviews: z.boolean().optional(),
    reviewPageLimit: z.number().int().min(1).max(5000).optional(),
    reviewSortBy: z.enum(['recent', 'relevant', 'helpful']).optional(),
    reviewStar: z.enum(['all', 'positive', 'neutral', 'negative', 'critical']).optional(),
    reviewerType: z.string().trim().min(1).max(64).optional(),
    reviewStopAtId: z.string().trim().min(1).max(128).optional(),
    timeout: z.number().int().min(5000).max(180000).optional(),
    stealth: z.boolean().optional(),
});

function normalizeError(error: unknown): {
    status: number;
    message: string;
    code: string;
} {
    if (error instanceof WalmartServiceError) {
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
            code: 'INVALID_WALMART_REQUEST',
        };
    }

    return {
        status: 500,
        message: error instanceof Error ? error.message : 'Walmart inspect failed',
        code: 'WALMART_INSPECT_FAILED',
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

export class WalmartController {
    static async inspect(req: Request, res: Response) {
        const startTime = Date.now();
        const apiKeyId = req.apiKeyId || null;

        try {
            const payload = WalmartInspectSchema.parse(req.body);
            const data = await walmartService.inspect(payload);

            await logRequest({
                apiKeyId,
                url: `walmart-inspect://${payload.input}`,
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
                url: `walmart-inspect://${req.body?.input || 'unknown'}`,
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
                data: walmartService.getStatus(),
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
