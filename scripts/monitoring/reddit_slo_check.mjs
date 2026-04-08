#!/usr/bin/env node

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
    apiKey:
      process.env.API_KEY ||
      process.env.HX_API_KEY ||
      process.env.HEADLESSX_API_KEY ||
      process.env.DASHBOARD_INTERNAL_API_KEY ||
      '',
    windowMinutes: Number(process.env.WINDOW_MINUTES || 15),
    pageSize: Number(process.env.PAGE_SIZE || 200),
    maxPages: Number(process.env.MAX_PAGES || 20),
    minSamples: Number(process.env.MIN_SAMPLES || 20),
    max4xxRatio: Number(process.env.MAX_4XX_RATIO || 0.2),
    max5xxRatio: Number(process.env.MAX_5XX_RATIO || 0.05),
    max429Ratio: Number(process.env.MAX_429_RATIO || 0.15),
    maxTimeoutRatio: Number(process.env.MAX_TIMEOUT_RATIO || 0.05),
    maxP95Ms: Number(process.env.MAX_P95_MS || 6000),
    webhookUrl: process.env.ALERT_WEBHOOK_URL || '',
    json: false,
    includeStatusCheck: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    switch (arg) {
      case '--api-url':
        options.apiUrl = keepExistingIfEmpty(next, options.apiUrl);
        index += 1;
        break;
      case '--api-key':
        options.apiKey = keepExistingIfEmpty(next, options.apiKey);
        index += 1;
        break;
      case '--window-minutes':
        options.windowMinutes = Number(next);
        index += 1;
        break;
      case '--page-size':
        options.pageSize = Number(next);
        index += 1;
        break;
      case '--max-pages':
        options.maxPages = Number(next);
        index += 1;
        break;
      case '--min-samples':
        options.minSamples = Number(next);
        index += 1;
        break;
      case '--max-4xx-ratio':
        options.max4xxRatio = Number(next);
        index += 1;
        break;
      case '--max-5xx-ratio':
        options.max5xxRatio = Number(next);
        index += 1;
        break;
      case '--max-429-ratio':
        options.max429Ratio = Number(next);
        index += 1;
        break;
      case '--max-timeout-ratio':
        options.maxTimeoutRatio = Number(next);
        index += 1;
        break;
      case '--max-p95-ms':
        options.maxP95Ms = Number(next);
        index += 1;
        break;
      case '--alert-webhook-url':
        options.webhookUrl = next || '';
        index += 1;
        break;
      case '--no-status-check':
        options.includeStatusCheck = false;
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
  console.log(`Usage: node scripts/monitoring/reddit_slo_check.mjs [options]

Options:
  --api-url <url>             HeadlessX API URL (default: http://localhost:38473)
  --api-key <key>             API key for logs/status access
  --window-minutes <n>        Rolling analysis window in minutes (default: 15)
  --page-size <n>             /api/logs page size (default: 200)
  --max-pages <n>             Max pages to scan (default: 20)
  --min-samples <n>           Minimum sample size before enforcing ratio alerts (default: 20)
  --max-4xx-ratio <f>         Alert threshold, 4xx ratio (default: 0.20)
  --max-5xx-ratio <f>         Alert threshold, 5xx ratio (default: 0.05)
  --max-429-ratio <f>         Alert threshold, 429 ratio (default: 0.15)
  --max-timeout-ratio <f>     Alert threshold, timeout ratio (default: 0.05)
  --max-p95-ms <n>            Alert threshold, p95 latency ms (default: 6000)
  --alert-webhook-url <url>   Optional webhook URL for alert payload POST
  --no-status-check           Skip /api/operators/reddit/status heartbeat
  --json                      Print JSON only
  -h, --help                  Show help

Env fallback:
  API_URL / HX_API_URL / HEADLESSX_API_URL
  API_KEY / HX_API_KEY / HEADLESSX_API_KEY / DASHBOARD_INTERNAL_API_KEY`);
}

async function requestJson({ url, apiKey }) {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'x-api-key': apiKey,
      accept: 'application/json',
    },
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
    throw new Error(`Request failed (${url}): ${message}`);
  }

  return payload;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function percentile(values, q) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const position = Math.max(0, Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1));
  return sorted[position];
}

function isTimeoutLog(log) {
  const status = Number(log?.status_code || 0);
  if (status === 504) {
    return true;
  }

  const message = typeof log?.error_message === 'string' ? log.error_message.toLowerCase() : '';
  return /(timeout|timed out|etimedout|aborterror|aborted)/i.test(message);
}

async function postWebhook(webhookUrl, payload) {
  if (!webhookUrl) {
    return;
  }

  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.apiKey.trim()) {
    throw new Error('Missing API key. Use --api-key or API_KEY/HX_API_KEY env.');
  }

  const baseUrl = options.apiUrl.replace(/\/$/, '');
  const cutoffMs = Date.now() - options.windowMinutes * 60 * 1000;
  const cutoffIso = new Date(cutoffMs).toISOString();

  let statusCheck = {
    ok: true,
    status: 'unknown',
    message: '',
  };

  if (options.includeStatusCheck) {
    try {
      const statusPayload = await requestJson({
        url: `${baseUrl}/api/operators/reddit/status`,
        apiKey: options.apiKey,
      });
      const online = statusPayload?.success === true && statusPayload?.data?.status === 'online';
      statusCheck = {
        ok: online,
        status: statusPayload?.data?.status || 'unknown',
        message: online ? 'online' : 'status endpoint returned non-online',
      };
    } catch (error) {
      statusCheck = {
        ok: false,
        status: 'unreachable',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const redditLogs = [];
  let scannedPages = 0;
  let scannedRows = 0;

  for (let page = 1; page <= options.maxPages; page += 1) {
    const payload = await requestJson({
      url: `${baseUrl}/api/logs?page=${page}&limit=${options.pageSize}`,
      apiKey: options.apiKey,
    });

    const rows = Array.isArray(payload?.logs) ? payload.logs : [];
    if (rows.length === 0) {
      break;
    }

    scannedPages += 1;
    scannedRows += rows.length;

    for (const row of rows) {
      const createdAt = Date.parse(row?.created_at || '');
      if (!Number.isFinite(createdAt) || createdAt < cutoffMs) {
        continue;
      }

      const url = String(row?.url || '');
      if (url.startsWith('reddit-inspect://') || url.includes('/api/operators/reddit/inspect')) {
        redditLogs.push(row);
      }
    }

    const oldestCreatedAt = Date.parse(rows[rows.length - 1]?.created_at || '');
    if (Number.isFinite(oldestCreatedAt) && oldestCreatedAt < cutoffMs) {
      break;
    }
  }

  const total = redditLogs.length;
  const statusCounts = {
    ok2xx: 0,
    error4xx: 0,
    error5xx: 0,
    tooMany429: 0,
    timeout: 0,
  };

  const durations = [];
  for (const log of redditLogs) {
    const status = Number(log?.status_code || 0);
    if (status >= 200 && status < 300) {
      statusCounts.ok2xx += 1;
    } else if (status >= 400 && status < 500) {
      statusCounts.error4xx += 1;
      if (status === 429) {
        statusCounts.tooMany429 += 1;
      }
    } else if (status >= 500 && status < 600) {
      statusCounts.error5xx += 1;
    }

    if (isTimeoutLog(log)) {
      statusCounts.timeout += 1;
    }

    const duration = Number(log?.duration_ms);
    if (isFiniteNumber(duration)) {
      durations.push(duration);
    }
  }

  const safeDivide = (numerator, denominator) => (denominator > 0 ? numerator / denominator : 0);
  const metrics = {
    totalRequests: total,
    windowMinutes: options.windowMinutes,
    windowStart: cutoffIso,
    scannedPages,
    scannedRows,
    status: statusCounts,
    ratios: {
      error4xx: safeDivide(statusCounts.error4xx, total),
      error5xx: safeDivide(statusCounts.error5xx, total),
      tooMany429: safeDivide(statusCounts.tooMany429, total),
      timeout: safeDivide(statusCounts.timeout, total),
    },
    latencyMs: {
      p50: percentile(durations, 0.5),
      p95: percentile(durations, 0.95),
      max: durations.length > 0 ? Math.max(...durations) : null,
    },
    statusCheck,
  };

  const breaches = [];
  if (options.includeStatusCheck && !statusCheck.ok) {
    breaches.push({
      metric: 'status_check',
      actual: statusCheck.status,
      threshold: 'online',
      reason: statusCheck.message,
    });
  }

  if (total >= options.minSamples) {
    if (metrics.ratios.error4xx > options.max4xxRatio) {
      breaches.push({
        metric: '4xx_ratio',
        actual: metrics.ratios.error4xx,
        threshold: options.max4xxRatio,
      });
    }
    if (metrics.ratios.error5xx > options.max5xxRatio) {
      breaches.push({
        metric: '5xx_ratio',
        actual: metrics.ratios.error5xx,
        threshold: options.max5xxRatio,
      });
    }
    if (metrics.ratios.tooMany429 > options.max429Ratio) {
      breaches.push({
        metric: '429_ratio',
        actual: metrics.ratios.tooMany429,
        threshold: options.max429Ratio,
      });
    }
    if (metrics.ratios.timeout > options.maxTimeoutRatio) {
      breaches.push({
        metric: 'timeout_ratio',
        actual: metrics.ratios.timeout,
        threshold: options.maxTimeoutRatio,
      });
    }
    if (isFiniteNumber(metrics.latencyMs.p95) && metrics.latencyMs.p95 > options.maxP95Ms) {
      breaches.push({
        metric: 'p95_ms',
        actual: metrics.latencyMs.p95,
        threshold: options.maxP95Ms,
      });
    }
  }

  const summary = {
    success: breaches.length === 0,
    severity: breaches.length === 0 ? 'ok' : 'critical',
    evaluatedAt: new Date().toISOString(),
    thresholds: {
      minSamples: options.minSamples,
      max4xxRatio: options.max4xxRatio,
      max5xxRatio: options.max5xxRatio,
      max429Ratio: options.max429Ratio,
      maxTimeoutRatio: options.maxTimeoutRatio,
      maxP95Ms: options.maxP95Ms,
    },
    metrics,
    breaches,
  };

  if (options.webhookUrl && breaches.length > 0) {
    await postWebhook(options.webhookUrl, summary);
  }

  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`Reddit SLO check (${summary.evaluatedAt})`);
    console.log(`- Window: last ${options.windowMinutes}m`);
    console.log(`- Samples: ${metrics.totalRequests}`);
    console.log(`- Status check: ${statusCheck.ok ? 'online' : `failed (${statusCheck.message})`}`);
    console.log(`- 4xx ratio: ${metrics.ratios.error4xx.toFixed(3)} (threshold ${options.max4xxRatio})`);
    console.log(`- 5xx ratio: ${metrics.ratios.error5xx.toFixed(3)} (threshold ${options.max5xxRatio})`);
    console.log(`- 429 ratio: ${metrics.ratios.tooMany429.toFixed(3)} (threshold ${options.max429Ratio})`);
    console.log(`- timeout ratio: ${metrics.ratios.timeout.toFixed(3)} (threshold ${options.maxTimeoutRatio})`);
    console.log(`- p95 latency: ${metrics.latencyMs.p95 ?? 'n/a'}ms (threshold ${options.maxP95Ms}ms)`);
    if (metrics.totalRequests < options.minSamples) {
      console.log(`- Note: samples below min-samples (${options.minSamples}), ratio thresholds were not enforced.`);
    }
    if (breaches.length > 0) {
      console.log('- Breaches:');
      for (const breach of breaches) {
        console.log(`  • ${breach.metric}: actual=${breach.actual} threshold=${breach.threshold}`);
      }
    } else {
      console.log('- Result: OK');
    }
  }

  process.exit(breaches.length === 0 ? 0 : 2);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
