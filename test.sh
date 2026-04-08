#!/usr/bin/env bash
set -euo pipefail

# 1) 立刻轮换并吊销旧 key（请通过环境变量传入当前 admin key）
API_URL="${API_URL:-http://localhost:38473}"
API_KEY="${API_KEY:-}"

if [[ -z "${API_KEY}" ]]; then
  echo "Missing API_KEY. Example:" >&2
  echo "  API_KEY='your_admin_key' /bin/bash test.sh" >&2
  exit 1
fi

pnpm run security:rotate-api-key -- \
  --api-url "${API_URL}" \
  --admin-api-key "${API_KEY}" \
  --old-key "${API_KEY}" \
  --new-name "rotated-$(date +%Y%m%d-%H%M%S)"
