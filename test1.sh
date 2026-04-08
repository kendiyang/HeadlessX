# 2) Redis 故障场景（fail-closed）验证 503
# 先确认 .env 或 apps/web/.env.local 中：
# DASHBOARD_AUTH_RATE_LIMIT_FAIL_OPEN=false
# REDIS_URL=redis://localhost:36379

# 停 Redis（按你实际运行方式二选一）
docker stop $(docker ps --format '{{.ID}} {{.Names}}' | awk '/redis/{print $1; exit}')
# 或者如果你是 compose:
# cd /Users/mg/Workspace/HeadlessX/infra/docker && docker compose --profile all stop redis

# 立刻测登录，应 503
curl -i -sS \
  -H "Origin: http://localhost:34872" \
  -H "Content-Type: application/json" \
  --data "{\"username\":\"admin\",\"password\":\"test12345678\"}" \
  "http://localhost:34872/api/auth/login"

# 恢复 Redis
# docker start <上面停掉的redis容器ID>
# 或 compose:
# cd /Users/mg/Workspace/HeadlessX/infra/docker && docker compose --profile all start redis

