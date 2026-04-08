#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

function keepExistingIfEmpty(nextValue, existingValue) {
  if (typeof nextValue !== 'string') {
    return existingValue;
  }
  const trimmed = nextValue.trim();
  return trimmed.length > 0 ? trimmed : existingValue;
}

function parseArgs(argv) {
  const options = {
    apiUrl: process.env.API_URL || process.env.HX_API_URL || process.env.HEADLESSX_API_URL || 'http://localhost:38473',
    adminApiKey:
      process.env.ADMIN_API_KEY ||
      process.env.API_KEY ||
      process.env.HX_API_KEY ||
      process.env.HEADLESSX_API_KEY ||
      process.env.DASHBOARD_INTERNAL_API_KEY ||
      '',
    newName: `rotated-${new Date().toISOString()}`,
    oldKey: process.env.OLD_API_KEY || '',
    oldKeyId: process.env.OLD_API_KEY_ID || '',
    revokePrefix: process.env.OLD_API_KEY_PREFIX || '',
    noRevoke: false,
    envFile: '',
    envVar: 'HX_API_KEY',
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    switch (arg) {
      case '--api-url':
        options.apiUrl = keepExistingIfEmpty(next, options.apiUrl);
        index += 1;
        break;
      case '--admin-api-key':
      case '--api-key':
        options.adminApiKey = keepExistingIfEmpty(next, options.adminApiKey);
        index += 1;
        break;
      case '--new-name':
        options.newName = keepExistingIfEmpty(next, options.newName);
        index += 1;
        break;
      case '--old-key':
        options.oldKey = keepExistingIfEmpty(next, options.oldKey);
        index += 1;
        break;
      case '--old-key-id':
        options.oldKeyId = keepExistingIfEmpty(next, options.oldKeyId);
        index += 1;
        break;
      case '--revoke-prefix':
        options.revokePrefix = keepExistingIfEmpty(next, options.revokePrefix);
        index += 1;
        break;
      case '--no-revoke':
        options.noRevoke = true;
        break;
      case '--env-file':
        options.envFile = keepExistingIfEmpty(next, options.envFile);
        index += 1;
        break;
      case '--env-var':
        options.envVar = keepExistingIfEmpty(next, options.envVar);
        index += 1;
        break;
      case '--json':
        options.json = true;
        break;
      case '--':
        break;
      case '-h':
      case '--help':
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/security/rotate_api_key.mjs [options]

Options:
  --api-url <url>            HeadlessX API URL (default: http://localhost:38473)
  --admin-api-key <key>      Current admin API key used for /api/keys access
  --new-name <name>          Name for the newly created key
  --old-key <rawKey>         Raw old key (uses first 7 chars as prefix revoke target)
  --old-key-id <id>          Revoke a specific key id
  --revoke-prefix <prefix>   Revoke active keys matching this prefix (except new key)
  --no-revoke                Only create a new key, do not revoke old keys
  --env-file <path>          Write new key into env file
  --env-var <name>           Env variable name when writing to env file (default: HX_API_KEY)
  --json                     Print machine-readable JSON output
  -h, --help                 Show help

Env fallback:
  API_URL / HX_API_URL / HEADLESSX_API_URL
  ADMIN_API_KEY / API_KEY / HX_API_KEY / HEADLESSX_API_KEY / DASHBOARD_INTERNAL_API_KEY
  OLD_API_KEY / OLD_API_KEY_ID / OLD_API_KEY_PREFIX`);
}

async function requestJson({ url, method = 'GET', apiKey, body }) {
  const response = await fetch(url, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    const message =
      payload?.error?.message ||
      payload?.error ||
      `HTTP ${response.status} ${response.statusText}`;
    throw new Error(`Request failed (${method} ${url}): ${message}`);
  }

  return payload;
}

function keyPrefix(rawKey) {
  const normalized = (rawKey || '').trim();
  return normalized.length >= 7 ? normalized.slice(0, 7) : '';
}

function normalizeKeys(payload) {
  if (!payload || payload.success !== true || !Array.isArray(payload.keys)) {
    throw new Error('Unexpected /api/keys response shape');
  }
  return payload.keys;
}

function resolveEnvPath(filePath) {
  if (!filePath) {
    return '';
  }
  return path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
}

function upsertEnv(filePath, envVar, value) {
  const resolved = resolveEnvPath(filePath);
  const existing = fs.existsSync(resolved) ? fs.readFileSync(resolved, 'utf8') : '';
  const lines = existing.length > 0 ? existing.split(/\r?\n/) : [];
  const targetPrefix = `${envVar}=`;
  let replaced = false;

  const nextLines = lines.map((line) => {
    if (line.startsWith(targetPrefix)) {
      replaced = true;
      return `${targetPrefix}${value}`;
    }
    return line;
  });

  if (!replaced) {
    nextLines.push(`${targetPrefix}${value}`);
  }

  const output = nextLines.filter((line, index, arr) => !(index === arr.length - 1 && line === '')).join('\n') + '\n';
  fs.writeFileSync(resolved, output, 'utf8');
  return resolved;
}

function sortByCreatedDesc(keys) {
  return [...keys].sort((left, right) => {
    const lt = Date.parse(left.created_at || 0);
    const rt = Date.parse(right.created_at || 0);
    return rt - lt;
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.adminApiKey.trim()) {
    throw new Error('Missing admin API key. Use --admin-api-key or API_KEY/HX_API_KEY env.');
  }

  const baseUrl = options.apiUrl.replace(/\/$/, '');
  const keysUrl = `${baseUrl}/api/keys`;
  const revokeTargetPrefix = options.revokePrefix || keyPrefix(options.oldKey);

  const beforePayload = await requestJson({
    url: keysUrl,
    method: 'GET',
    apiKey: options.adminApiKey,
  });
  const beforeKeys = normalizeKeys(beforePayload);
  const beforeIds = new Set(beforeKeys.map((item) => item.id));

  const createPayload = await requestJson({
    url: keysUrl,
    method: 'POST',
    apiKey: options.adminApiKey,
    body: { name: options.newName || `rotated-${new Date().toISOString()}` },
  });

  const newKeyRaw = typeof createPayload?.key === 'string' ? createPayload.key : '';
  if (!newKeyRaw) {
    throw new Error('Create API key succeeded but no raw key was returned.');
  }
  const newKeyPrefix = keyPrefix(newKeyRaw);

  const afterPayload = await requestJson({
    url: keysUrl,
    method: 'GET',
    apiKey: options.adminApiKey,
  });
  const afterKeys = normalizeKeys(afterPayload);

  const newKeyRecordCandidates = sortByCreatedDesc(
    afterKeys.filter((item) => !beforeIds.has(item.id) && item.prefix === newKeyPrefix)
  );
  const newKeyRecord = newKeyRecordCandidates[0] || null;

  const revokedIds = [];
  const warnings = [];
  if (!options.noRevoke) {
    let targets = [];
    if (options.oldKeyId) {
      targets = afterKeys.filter((item) => item.id === options.oldKeyId && item.is_active);
    } else if (revokeTargetPrefix) {
      targets = afterKeys.filter(
        (item) =>
          item.is_active &&
          item.prefix === revokeTargetPrefix &&
          (!newKeyRecord || item.id !== newKeyRecord.id)
      );
    }

    if ((options.oldKeyId || revokeTargetPrefix) && targets.length === 0) {
      warnings.push(
        'No active managed API key matched the revoke selector. If the old key is configured via DASHBOARD_INTERNAL_API_KEY (env static key), rotate/remove that env value and restart services.'
      );
    }

    for (const target of targets) {
      await requestJson({
        url: `${keysUrl}/${target.id}/revoke`,
        method: 'PATCH',
        apiKey: options.adminApiKey,
      });
      revokedIds.push(target.id);
    }
  }

  let envWritePath = '';
  if (options.envFile) {
    envWritePath = upsertEnv(options.envFile, options.envVar || 'HX_API_KEY', newKeyRaw);
  }

  const output = {
    success: true,
    apiUrl: baseUrl,
    newKey: {
      raw: newKeyRaw,
      prefix: newKeyPrefix,
      id: newKeyRecord?.id || null,
      name: options.newName || null,
    },
    revokedKeyIds: revokedIds,
    revokeSelection: {
      oldKeyId: options.oldKeyId || null,
      revokePrefix: revokeTargetPrefix || null,
      noRevoke: options.noRevoke,
    },
    warnings,
    envWritePath: envWritePath || null,
    exportCommand: `export ${options.envVar || 'HX_API_KEY'}="${newKeyRaw}"`,
  };

  if (options.json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log('API key rotation completed.');
  console.log(`- API URL: ${output.apiUrl}`);
  console.log(`- New key prefix: ${output.newKey.prefix}`);
  console.log(`- New key id: ${output.newKey.id || 'unresolved'}`);
  console.log(`- Revoked keys: ${revokedIds.length > 0 ? revokedIds.join(', ') : 'none'}`);
  if (warnings.length > 0) {
    console.log('- Warnings:');
    for (const warning of warnings) {
      console.log(`  • ${warning}`);
    }
  }
  if (envWritePath) {
    console.log(`- Updated env file: ${envWritePath} (${options.envVar})`);
  }
  console.log('- New key (shown once):');
  console.log(newKeyRaw);
  console.log('- Export command:');
  console.log(output.exportCommand);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
