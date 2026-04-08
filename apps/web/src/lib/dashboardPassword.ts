import { scryptSync, timingSafeEqual } from 'node:crypto';
import {
    DASHBOARD_SCRYPT_KEYLEN,
    parseDashboardPasswordHash,
} from './dashboardPasswordHash';

const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function constantTimeStringMatch(input: string, expected: string): boolean {
    const left = Buffer.from(input, 'utf8');
    const right = Buffer.from(expected, 'utf8');

    if (left.length !== right.length) {
        return false;
    }

    return timingSafeEqual(left, right);
}
export async function verifyDashboardPassword(input: string, options: {
    expectedHash: string | null;
    expectedPlain: string | null;
}): Promise<boolean> {
    if (options.expectedHash) {
        const parsed = parseDashboardPasswordHash(options.expectedHash);
        if (!parsed) {
            return false;
        }

        const salt = Buffer.from(parsed.saltBytes);
        const digest = Buffer.from(parsed.digestBytes);
        const derived = scryptSync(input, salt, DASHBOARD_SCRYPT_KEYLEN, SCRYPT_OPTIONS);
        return timingSafeEqual(derived, digest);
    }

    if (options.expectedPlain) {
        return constantTimeStringMatch(input, options.expectedPlain);
    }

    return false;
}
