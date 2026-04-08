# HeadlessX Production Deployment Manual

This guide is a production-grade deployment runbook for HeadlessX v2.1.2.
It is designed for single-host Docker deployment first, with optional domain and TLS via Caddy.

Chinese SOP version: `Deploy/README.zh-CN.md`

## 1. Deployment Goals

- Deploy stable `web + api + worker + postgres + redis + yt-engine + html-to-md`
- Enforce dashboard authentication (session/JWT)
- Enforce distributed login rate limiting via Redis
- Keep API keys and encryption secrets managed and rotatable
- Provide a repeatable pre-launch and post-launch verification process

## 2. Reference Architecture

Core services from `infra/docker/docker-compose.yml`:

- `web`: Next.js dashboard
- `api`: Express backend
- `worker`: BullMQ queue worker
- `postgres`: primary database
- `redis`: queue + dashboard login limiter backend
- `yt-engine`: YouTube sidecar
- `html-to-md`: HTML to Markdown sidecar

Optional internet-facing reverse proxy:

- `infra/domain-setup` (Caddy, HTTPS, custom domains)

## 3. Host Prerequisites

Recommended production host:

- OS: Ubuntu 22.04+ or Debian 12
- CPU: 4+ vCPU
- RAM: 8 GB minimum, 16 GB recommended
- Disk: 40 GB SSD recommended

Required software:

- Docker Engine
- Docker Compose v2
- Git
- Node.js 22+ and pnpm 10.32.1+ (for local verification scripts)

## 4. Ports and Network

Default exposed host ports:

- Web: `34872`
- API: `38473`
- Postgres: `35432`
- Redis: `36379`
- HTML-to-Markdown: `38081`
- YT Engine: `38090`

Adjust these in `infra/docker/.env` if needed.

## 5. Prepare Environment

### 5.1 Clone and enter repo

```bash
git clone <your-fork-or-origin-url> HeadlessX
cd HeadlessX
```

### 5.2 Create Docker env file

```bash
cp infra/docker/.env.example infra/docker/.env
```

### 5.3 Generate required secrets

Generate strong random values (examples):

```bash
openssl rand -base64 48
```

Use unique values for:

- `DASHBOARD_INTERNAL_API_KEY`
- `CREDENTIAL_ENCRYPTION_KEY`
- `DASHBOARD_AUTH_SECRET`

### 5.4 Generate dashboard password hash (recommended)

Use `scrypt:<salt>:<hash>` format:

```bash
node -e "const { randomBytes, scryptSync } = require('crypto'); const p='ChangeThisPasswordNow!'; const salt=randomBytes(16); const hash=scryptSync(p, salt, 64, {N:16384,r:8,p:1,maxmem:64*1024*1024}); const b=v=>v.toString('base64url'); console.log('scrypt:'+b(salt)+':'+b(hash));"
```

Set in `infra/docker/.env`:

- `DASHBOARD_AUTH_ENABLED=true`
- `DASHBOARD_AUTH_USERNAME=admin` (or custom)
- `DASHBOARD_AUTH_PASSWORD_HASH=<generated value>`
- Do not rely on `DASHBOARD_AUTH_PASSWORD` in production

### 5.5 Production-safe auth limiter settings

In `infra/docker/.env`, ensure:

- `REDIS_URL=redis://redis:6379`
- `DASHBOARD_AUTH_RATE_LIMIT_FAIL_OPEN=false`
- `DASHBOARD_AUTH_RATE_LIMIT_WINDOW_SECONDS=900`
- `DASHBOARD_AUTH_RATE_LIMIT_MAX_ATTEMPTS=8`

## 6. Start Production Stack

From repo root:

```bash
cd infra/docker
docker compose --profile all up -d --build
```

Check status:

```bash
docker compose ps
```

Check logs if needed:

```bash
docker compose logs -f api
docker compose logs -f worker
docker compose logs -f web
```

## 7. Initial Health Checks

### 7.1 Backend health

```bash
curl -fsS http://localhost:38473/api/health | jq .
```

### 7.2 Dashboard reachability

```bash
curl -I http://localhost:34872
```

### 7.3 Reddit operator status with API key

Use a managed API key (recommended) or a controlled internal key only in trusted ops context:

```bash
curl -fsS -H "x-api-key: <API_KEY>" http://localhost:38473/api/operators/reddit/status | jq .
```

## 8. Dashboard Auth Acceptance

Because login endpoint validates same-origin, include `Origin` in test calls:

```bash
curl -i -sS \
  -H "Origin: http://localhost:34872" \
  -H "Content-Type: application/json" \
  --data '{"username":"admin","password":"<PASSWORD>"}' \
  "http://localhost:34872/api/auth/login"
```

Expected:

- `200` for valid credentials
- `401` for invalid credentials
- `429` after too many failures in limiter window
- `503` if Redis is down and fail-open is disabled

## 9. API Key Operational Policy

### 9.1 Create dedicated runtime/automation key

Create in dashboard API keys page or via API key endpoint.
Use managed API keys for automation and external integrations.

### 9.2 Rotate exposed keys immediately

Use built-in rotation script:

```bash
API_URL="http://localhost:38473" \
API_KEY="<current-admin-or-internal-key>" \
pnpm run security:rotate-api-key -- \
  --api-url "$API_URL" \
  --admin-api-key "$API_KEY" \
  --old-key "$API_KEY" \
  --new-name "rotated-$(date +%Y%m%d-%H%M%S)"
```

If old key is static env key (`DASHBOARD_INTERNAL_API_KEY`), update env and restart services.
Managed key revoke alone is not enough in that case.

## 10. Reddit Production Verification

### 10.1 Pre-launch verification script

From repo root:

```bash
API_URL="http://localhost:38473" \
API_KEY="<managed-api-key>" \
pnpm run verify:reddit:prelaunch
```

The script checks:

- Type checks
- Reddit unit tests
- API status and inspect endpoints
- CLI status and inspect behavior

### 10.2 Rolling SLO check

```bash
API_URL="http://localhost:38473" \
API_KEY="<managed-api-key>" \
pnpm run monitor:reddit:slo -- \
  --window-minutes 15 \
  --max-4xx-ratio 0.20 \
  --max-5xx-ratio 0.05 \
  --max-429-ratio 0.15 \
  --max-timeout-ratio 0.05 \
  --max-p95-ms 6000
```

Exit code contract:

- `0`: healthy
- `2`: threshold breached
- `1`: script/runtime error

## 11. Schedule SLO Checks (Cron)

Example every 5 minutes:

```cron
*/5 * * * * cd /opt/headlessx && API_URL="http://localhost:38473" API_KEY="<managed-api-key>" pnpm run monitor:reddit:slo -- --window-minutes 15 --max-4xx-ratio 0.20 --max-5xx-ratio 0.05 --max-429-ratio 0.15 --max-timeout-ratio 0.05 --max-p95-ms 6000
```

If using webhook alerting, add `--alert-webhook-url <URL>`.

## 12. Domain and TLS (Optional but Recommended)

For public domain routing and HTTPS:

- Read `infra/domain-setup/README.md`
- Configure DNS for dashboard and API domains
- Open ports `80/443`
- Start Caddy layer from `infra/domain-setup`

## 13. Upgrade Procedure

1. Backup database
2. Pull target release/tag
3. Rebuild and restart compose services
4. Run health checks and Reddit prelaunch verification
5. Monitor logs and SLO for at least one full limiter window

Example:

```bash
git fetch --tags
git checkout <release-tag-or-commit>
cd infra/docker
docker compose --profile all up -d --build
```

## 14. Rollback Procedure

1. Checkout previous known-good tag/commit
2. Rebuild and redeploy compose stack
3. Re-run smoke checks
4. Keep old/new API key mapping documented for incident traceability

```bash
git checkout <previous-stable-tag>
cd infra/docker
docker compose --profile all up -d --build
```

## 15. Backup and Recovery

### 15.1 Postgres backup

```bash
docker exec -t headlessx-postgres pg_dump -U postgres headlessx > headlessx-$(date +%F-%H%M%S).sql
```

### 15.2 Postgres restore

```bash
cat <backup.sql> | docker exec -i headlessx-postgres psql -U postgres -d headlessx
```

## 16. Production Readiness Checklist

- [ ] `DASHBOARD_INTERNAL_API_KEY` set and rotated policy defined
- [ ] `CREDENTIAL_ENCRYPTION_KEY` set and backed up in secret manager
- [ ] Dashboard auth enabled with scrypt hash
- [ ] Redis reachable and limiter fail-open disabled
- [ ] `api`, `worker`, `web` all healthy in compose
- [ ] `verify:reddit:prelaunch` passes
- [ ] `monitor:reddit:slo` baseline is healthy
- [ ] Backups tested
- [ ] Rollback command tested on staging

## 17. Common Failure Patterns

- `Missing required security environment variables`: check `DASHBOARD_INTERNAL_API_KEY` and `CREDENTIAL_ENCRYPTION_KEY`
- Dashboard login `503` with limiter error: Redis unavailable or timeout
- Worker waiting state: Redis not reachable (`queue worker is waiting for Redis`)
- Login `403` on curl: missing/incorrect same-origin headers (`Origin`/`Referer`)
- Password hash invalid: use `scrypt:<salt>:<hash>` format (avoid dotenv `$` escaping pitfalls)

---

Owner recommendation:

- Keep this file as the source of truth for production changes.
- Update it whenever auth, Redis, operator verification, or release procedure changes.
