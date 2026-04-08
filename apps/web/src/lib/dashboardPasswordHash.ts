export const DASHBOARD_SCRYPT_KEYLEN = 64;
const DASHBOARD_SCRYPT_MIN_SALT_BYTES = 16;
const DASHBOARD_SCRYPT_SCHEME = 'scrypt';
const DASHBOARD_SCRYPT_SEPARATORS = ['$', ':'] as const;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

export interface ParsedDashboardPasswordHash {
    scheme: 'scrypt';
    separator: '$' | ':';
    saltPart: string;
    digestPart: string;
    saltBytes: Uint8Array;
    digestBytes: Uint8Array;
}

function fromBase64(value: string): Uint8Array {
    if (typeof Buffer !== 'undefined') {
        return new Uint8Array(Buffer.from(value, 'base64'));
    }

    const binary = atob(value);
    const output = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        output[index] = binary.charCodeAt(index);
    }
    return output;
}

function fromBase64Url(value: string): Uint8Array {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
    return fromBase64(padded);
}

function normalizeHashValue(hashValue: string): string {
    return hashValue.trim().replace(/\\\$/g, '$');
}

export function parseDashboardPasswordHash(hashValue: string): ParsedDashboardPasswordHash | null {
    const normalized = normalizeHashValue(hashValue);

    for (const separator of DASHBOARD_SCRYPT_SEPARATORS) {
        const parts = normalized.split(separator);
        if (parts.length !== 3) {
            continue;
        }

        const [scheme, saltPart, digestPart] = parts;
        if (scheme !== DASHBOARD_SCRYPT_SCHEME || !saltPart || !digestPart) {
            continue;
        }

        if (!BASE64URL_PATTERN.test(saltPart) || !BASE64URL_PATTERN.test(digestPart)) {
            continue;
        }

        try {
            const saltBytes = fromBase64Url(saltPart);
            const digestBytes = fromBase64Url(digestPart);

            if (
                saltBytes.length < DASHBOARD_SCRYPT_MIN_SALT_BYTES ||
                digestBytes.length !== DASHBOARD_SCRYPT_KEYLEN
            ) {
                continue;
            }

            return {
                scheme: 'scrypt',
                separator,
                saltPart,
                digestPart,
                saltBytes,
                digestBytes,
            };
        } catch {
            // Keep trying supported separators.
        }
    }

    return null;
}

export function isSupportedDashboardPasswordHash(hashValue: string | null): boolean {
    if (!hashValue) {
        return false;
    }

    return parseDashboardPasswordHash(hashValue) !== null;
}
