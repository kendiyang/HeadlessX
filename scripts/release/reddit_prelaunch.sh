#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

API_URL="${API_URL:-${HX_API_URL:-${HEADLESSX_API_URL:-http://localhost:38473}}}"
API_KEY="${API_KEY:-${HX_API_KEY:-${HEADLESSX_API_KEY:-${DASHBOARD_INTERNAL_API_KEY:-}}}}"
THREAD_INPUT="${THREAD_INPUT:-https://www.reddit.com/r/AskMarketing/comments/1s0kubi/sick_of_the_backandforth_for_tiktok_spark_ads}"
LISTING_INPUT="${LISTING_INPUT:-https://www.reddit.com/r/AskMarketing/}"
CLI_BIN="${CLI_BIN:-headlessx}"

RUN_TYPECHECK="${RUN_TYPECHECK:-1}"
RUN_UNIT_TESTS="${RUN_UNIT_TESTS:-1}"
RUN_API_CHECKS="${RUN_API_CHECKS:-1}"
RUN_CLI_CHECKS="${RUN_CLI_CHECKS:-1}"

usage() {
  cat <<'EOF'
Usage: scripts/release/reddit_prelaunch.sh [options]

Options:
  --api-url <url>          HeadlessX API URL (default: http://localhost:38473)
  --api-key <key>          API key for protected endpoints
  --thread-input <value>   Reddit thread URL/path/post-id for inspect test
  --listing-input <value>  Reddit listing URL/path for inspect test
  --cli-bin <path>         CLI binary (default: headlessx)
  --skip-typecheck         Skip TypeScript checks
  --skip-unit-tests        Skip Reddit unit tests
  --skip-api-checks        Skip HTTP API checks
  --skip-cli-checks        Skip CLI checks
  -h, --help               Show this help

Env alternatives:
  API_URL / HX_API_URL / HEADLESSX_API_URL
  API_KEY / HX_API_KEY / HEADLESSX_API_KEY / DASHBOARD_INTERNAL_API_KEY
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --api-url)
      API_URL="${2:-}"
      shift 2
      ;;
    --api-key)
      API_KEY="${2:-}"
      shift 2
      ;;
    --thread-input)
      THREAD_INPUT="${2:-}"
      shift 2
      ;;
    --listing-input)
      LISTING_INPUT="${2:-}"
      shift 2
      ;;
    --cli-bin)
      CLI_BIN="${2:-}"
      shift 2
      ;;
    --skip-typecheck)
      RUN_TYPECHECK=0
      shift
      ;;
    --skip-unit-tests)
      RUN_UNIT_TESTS=0
      shift
      ;;
    --skip-api-checks)
      RUN_API_CHECKS=0
      shift
      ;;
    --skip-cli-checks)
      RUN_CLI_CHECKS=0
      shift
      ;;
    --)
      shift
      break
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

cd "${REPO_ROOT}"

for cmd in pnpm curl node; do
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    echo "Missing required command: ${cmd}" >&2
    exit 1
  fi
done

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

STEP_TOTAL=0
STEP_PASS=0

log_step() {
  STEP_TOTAL=$((STEP_TOTAL + 1))
  echo
  echo "==> [${STEP_TOTAL}] $1"
}

pass_step() {
  STEP_PASS=$((STEP_PASS + 1))
  echo "    PASS: $1"
}

assert_http_response() {
  local expected_status="$1"
  local body_file="$2"
  local context="$3"

  node - <<'NODE' "${expected_status}" "${body_file}" "${context}"
const fs = require('node:fs');
const expected = Number(process.argv[2]);
const bodyPath = process.argv[3];
const context = process.argv[4];
const raw = fs.readFileSync(bodyPath, 'utf8');
let payload;
try {
  payload = JSON.parse(raw);
} catch (error) {
  console.error(`[${context}] response is not valid JSON`);
  console.error(raw.slice(0, 400));
  process.exit(1);
}
if (!payload || payload.success !== true) {
  console.error(`[${context}] expected success=true but got:`, payload);
  process.exit(1);
}
NODE
}

if [[ "${RUN_TYPECHECK}" == "1" ]]; then
  log_step "Type checks (api/web/cli)"
  pnpm --filter headlessx-api exec tsc --noEmit
  pnpm --filter headlessx-web exec tsc --noEmit
  pnpm --filter @headlessx-cli/core type-check
  pass_step "Type checks passed"
fi

if [[ "${RUN_UNIT_TESTS}" == "1" ]]; then
  log_step "Reddit unit tests (api + cli)"
  pnpm --filter headlessx-api exec tsx --test \
    src/services/social/RedditService.test.ts \
    src/controllers/social/RedditController.test.ts \
    src/routes/social/socialRoutes.test.ts
  pnpm --filter @headlessx-cli/core test -- src/commands/reddit.test.ts
  pass_step "Reddit tests passed"
fi

if [[ "${RUN_API_CHECKS}" == "1" ]]; then
  if [[ -z "${API_KEY}" ]]; then
    echo "API checks require --api-key (or API_KEY/HX_API_KEY/HEADLESSX_API_KEY/DASHBOARD_INTERNAL_API_KEY)." >&2
    exit 1
  fi

  log_step "API status check: GET /api/operators/reddit/status"
  STATUS_BODY="${TMP_DIR}/status.json"
  STATUS_CODE="$(curl -sS -o "${STATUS_BODY}" -w '%{http_code}' \
    -H "x-api-key: ${API_KEY}" \
    "${API_URL%/}/api/operators/reddit/status")"
  if [[ "${STATUS_CODE}" != "200" ]]; then
    echo "Expected HTTP 200, got ${STATUS_CODE}" >&2
    cat "${STATUS_BODY}" >&2 || true
    exit 1
  fi
  assert_http_response "200" "${STATUS_BODY}" "reddit-status"
  node - <<'NODE' "${STATUS_BODY}"
const fs = require('node:fs');
const payload = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (payload?.data?.status !== 'online') {
  console.error('Status endpoint did not return online:', payload);
  process.exit(1);
}
NODE
  pass_step "Reddit status endpoint is healthy"

  log_step "API inspect thread check: POST /api/operators/reddit/inspect"
  THREAD_BODY="${TMP_DIR}/thread.json"
  THREAD_CODE="$(curl -sS -o "${THREAD_BODY}" -w '%{http_code}' \
    -H "x-api-key: ${API_KEY}" \
    -H "content-type: application/json" \
    --data "$(cat <<JSON
{"input":"${THREAD_INPUT}","sort":"new","timeframe":"week","limit":80,"depth":4,"timeout":45000}
JSON
)" \
    "${API_URL%/}/api/operators/reddit/inspect")"
  if [[ "${THREAD_CODE}" != "200" ]]; then
    echo "Expected HTTP 200, got ${THREAD_CODE}" >&2
    cat "${THREAD_BODY}" >&2 || true
    exit 1
  fi
  assert_http_response "200" "${THREAD_BODY}" "reddit-thread-inspect"
  node - <<'NODE' "${THREAD_BODY}"
const fs = require('node:fs');
const payload = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (payload?.data?.target?.mode !== 'thread') {
  console.error('Expected thread mode:', payload?.data?.target);
  process.exit(1);
}
if (!Array.isArray(payload?.data?.thread?.comments)) {
  console.error('Expected thread.comments array:', payload?.data?.thread);
  process.exit(1);
}
NODE
  pass_step "Thread inspect returns normalized Reddit thread payload"

  log_step "API inspect listing check: POST /api/operators/reddit/inspect"
  LISTING_BODY="${TMP_DIR}/listing.json"
  LISTING_CODE="$(curl -sS -o "${LISTING_BODY}" -w '%{http_code}' \
    -H "x-api-key: ${API_KEY}" \
    -H "content-type: application/json" \
    --data "$(cat <<JSON
{"input":"${LISTING_INPUT}","sort":"hot","limit":40,"timeout":45000}
JSON
)" \
    "${API_URL%/}/api/operators/reddit/inspect")"
  if [[ "${LISTING_CODE}" != "200" ]]; then
    echo "Expected HTTP 200, got ${LISTING_CODE}" >&2
    cat "${LISTING_BODY}" >&2 || true
    exit 1
  fi
  assert_http_response "200" "${LISTING_BODY}" "reddit-listing-inspect"
  node - <<'NODE' "${LISTING_BODY}"
const fs = require('node:fs');
const payload = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (payload?.data?.target?.mode !== 'listing') {
  console.error('Expected listing mode:', payload?.data?.target);
  process.exit(1);
}
if (!Array.isArray(payload?.data?.listing?.posts)) {
  console.error('Expected listing.posts array:', payload?.data?.listing);
  process.exit(1);
}
NODE
  pass_step "Listing inspect returns normalized Reddit listing payload"

  log_step "API negative case check: invalid Reddit host is rejected"
  INVALID_BODY="${TMP_DIR}/invalid.json"
  INVALID_CODE="$(curl -sS -o "${INVALID_BODY}" -w '%{http_code}' \
    -H "x-api-key: ${API_KEY}" \
    -H "content-type: application/json" \
    --data '{"input":"https://reddit.evil.com/r/ask/comments/abc123/test"}' \
    "${API_URL%/}/api/operators/reddit/inspect")"
  if [[ "${INVALID_CODE}" != "400" ]]; then
    echo "Expected HTTP 400 for invalid host, got ${INVALID_CODE}" >&2
    cat "${INVALID_BODY}" >&2 || true
    exit 1
  fi
  node - <<'NODE' "${INVALID_BODY}"
const fs = require('node:fs');
const payload = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (payload?.error?.code !== 'INVALID_REDDIT_INPUT') {
  console.error('Expected INVALID_REDDIT_INPUT:', payload);
  process.exit(1);
}
NODE
  pass_step "Invalid host validation is enforced"
fi

if [[ "${RUN_CLI_CHECKS}" == "1" ]]; then
  CLI_CMD=()

  if [[ -z "${API_KEY}" ]]; then
    echo "CLI checks require --api-key (or API_KEY/HX_API_KEY/HEADLESSX_API_KEY/DASHBOARD_INTERNAL_API_KEY)." >&2
    exit 1
  fi

  if command -v "${CLI_BIN}" >/dev/null 2>&1; then
    CLI_CMD=("${CLI_BIN}")
  elif [[ "${CLI_BIN}" == "headlessx" ]]; then
    LOCAL_CLI_DIST="${REPO_ROOT}/packages/cli/dist/index.js"
    echo "CLI binary 'headlessx' not found globally. Building local @headlessx-cli/core dist..." >&2
    pnpm --filter @headlessx-cli/core build

    if [[ ! -f "${LOCAL_CLI_DIST}" ]]; then
      echo "Local CLI dist is missing: ${LOCAL_CLI_DIST}" >&2
      exit 1
    fi

    CLI_CMD=(node "${LOCAL_CLI_DIST}")
    echo "Using local CLI fallback: node ${LOCAL_CLI_DIST}" >&2
  else
    echo "CLI binary not found: ${CLI_BIN}" >&2
    echo "Tip: install the binary in PATH, or omit --cli-bin to use the local fallback build." >&2
    exit 1
  fi

  log_step "CLI status check: ${CLI_CMD[*]} reddit status --json"
  CLI_STATUS_BODY="${TMP_DIR}/cli-status.json"
  "${CLI_CMD[@]}" --api-url "${API_URL}" --api-key "${API_KEY}" reddit status --json > "${CLI_STATUS_BODY}"
  node - <<'NODE' "${CLI_STATUS_BODY}"
const fs = require('node:fs');
const payload = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (payload?.success !== true) {
  console.error('CLI reddit status failed:', payload);
  process.exit(1);
}
NODE
  pass_step "CLI reddit status is healthy"

  log_step "CLI inspect check: ${CLI_CMD[*]} reddit inspect --json"
  CLI_INSPECT_BODY="${TMP_DIR}/cli-inspect.json"
  "${CLI_CMD[@]}" --api-url "${API_URL}" --api-key "${API_KEY}" \
    reddit inspect "${THREAD_INPUT}" --sort new --limit 60 --depth 3 --json > "${CLI_INSPECT_BODY}"
  node - <<'NODE' "${CLI_INSPECT_BODY}"
const fs = require('node:fs');
const payload = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (payload?.success !== true) {
  console.error('CLI reddit inspect failed:', payload);
  process.exit(1);
}
if (payload?.data?.target?.mode !== 'thread') {
  console.error('CLI reddit inspect did not return thread mode:', payload?.data?.target);
  process.exit(1);
}
NODE
  pass_step "CLI reddit inspect returns expected payload"
fi

echo
echo "Reddit prelaunch checks completed: ${STEP_PASS}/${STEP_TOTAL} steps passed."
echo "GO/NO-GO: GO (all enabled checks passed)"
