# HeadlessX 生产部署手册（中文执行版）

版本：`v2.1.2`  
适用日期：`2026-04-08` 起

本手册是值班同学可直接执行的生产 SOP，目标是：

- 稳定上线 `web + api + worker + postgres + redis + yt-engine + html-to-md`
- 对外开放前强制启用 Dashboard 登录鉴权（Session/JWT）
- 使用 Redis 做分布式登录限流
- 支持 Reddit 上线前验收、SLO 巡检、密钥轮换与回滚

---

## 1. 生产拓扑

核心服务来自 `infra/docker/docker-compose.yml`：

- `web`：Next.js Dashboard
- `api`：HeadlessX API
- `worker`：异步队列消费（BullMQ）
- `postgres`：主数据库
- `redis`：队列 + 登录限流
- `yt-engine`：YouTube 侧车
- `html-to-md`：HTML 转 Markdown 侧车

可选公网层：

- `infra/domain-setup`：Caddy + 自定义域名 + HTTPS

---

## 2. 主机与依赖要求

推荐：

- OS：Ubuntu 22.04+/Debian 12
- CPU：4 vCPU 以上
- RAM：8 GB 起，16 GB 推荐
- 磁盘：40 GB SSD 推荐

必需软件：

- Docker Engine
- Docker Compose v2
- Git
- Node.js 22+
- pnpm 10.32.1+

---

## 3. 端口规划（默认）

- Web：`34872`
- API：`38473`
- Postgres：`35432`
- Redis：`36379`
- HTML-to-Markdown：`38081`
- YT Engine：`38090`

如需改端口，修改 `infra/docker/.env`。

---

## 4. 首次部署步骤

### 4.1 拉代码

```bash
git clone <你的仓库地址> HeadlessX
cd HeadlessX
```

### 4.2 准备环境变量

```bash
cp infra/docker/.env.example infra/docker/.env
```

### 4.3 生成强随机密钥

```bash
openssl rand -base64 48
```

至少配置：

- `DASHBOARD_INTERNAL_API_KEY`
- `CREDENTIAL_ENCRYPTION_KEY`
- `DASHBOARD_AUTH_SECRET`

### 4.4 生成 Dashboard 密码哈希（生产必须）

```bash
node -e "const { randomBytes, scryptSync } = require('crypto'); const p='请替换为强密码'; const salt=randomBytes(16); const hash=scryptSync(p, salt, 64, {N:16384,r:8,p:1,maxmem:64*1024*1024}); const b=v=>v.toString('base64url'); console.log('scrypt:'+b(salt)+':'+b(hash));"
```

写入 `infra/docker/.env`：

- `DASHBOARD_AUTH_ENABLED=true`
- `DASHBOARD_AUTH_USERNAME=admin`（或自定义）
- `DASHBOARD_AUTH_PASSWORD_HASH=<上一步输出>`
- 生产不要依赖 `DASHBOARD_AUTH_PASSWORD` 明文

### 4.5 登录限流策略（生产建议）

在 `infra/docker/.env` 确认：

- `REDIS_URL=redis://redis:6379`
- `DASHBOARD_AUTH_RATE_LIMIT_FAIL_OPEN=false`
- `DASHBOARD_AUTH_RATE_LIMIT_WINDOW_SECONDS=900`
- `DASHBOARD_AUTH_RATE_LIMIT_MAX_ATTEMPTS=8`

### 4.6 启动全栈

```bash
cd infra/docker
docker compose --profile all up -d --build
```

---

## 5. 上线前验收（必须）

### 5.1 服务状态

```bash
docker compose ps
```

### 5.2 API 健康检查

```bash
curl -fsS http://localhost:38473/api/health | jq .
```

### 5.3 Dashboard 可访问性

```bash
curl -I http://localhost:34872
```

### 5.4 登录鉴权验收（同源）

```bash
curl -i -sS \
  -H "Origin: http://localhost:34872" \
  -H "Content-Type: application/json" \
  --data '{"username":"admin","password":"<你的密码>"}' \
  "http://localhost:34872/api/auth/login"
```

预期：

- 正确密码：`200`
- 错误密码：`401`
- 连续错误触发：`429`
- Redis 不可用且 fail-open=false：`503`

### 5.5 Reddit 上线前验收脚本

在仓库根目录执行：

```bash
API_URL="http://localhost:38473" \
API_KEY="<可用API_KEY>" \
pnpm run verify:reddit:prelaunch
```

要求：所有步骤 PASS 才允许上线。

---

## 6. 发布日标准流程（SOP）

### 6.1 变更冻结前

- 完成代码评审
- 确认回滚版本（tag/commit）
- 确认数据库备份窗口

### 6.2 发布执行

```bash
git fetch --tags
git checkout <目标发布tag或commit>
cd infra/docker
docker compose --profile all up -d --build
```

### 6.3 发布后 15 分钟观察

- `api`、`worker`、`web` 日志无持续报错
- 登录链路正常
- Reddit inspect 正常
- Redis 无频繁断连/超时

可用日志命令：

```bash
docker compose logs -f api
docker compose logs -f worker
docker compose logs -f web
```

---

## 7. 密钥管理与轮换

### 7.1 轮换暴露 API Key

```bash
API_URL="http://localhost:38473" \
API_KEY="<当前可用管理key>" \
pnpm run security:rotate-api-key -- \
  --api-url "$API_URL" \
  --admin-api-key "$API_KEY" \
  --old-key "$API_KEY" \
  --new-name "rotated-$(date +%Y%m%d-%H%M%S)"
```

### 7.2 关键注意

- 若旧 key 是 `DASHBOARD_INTERNAL_API_KEY`（环境静态 key），仅 revoke 管理 key 不够。
- 必须更新 `.env`/密钥平台里的 `DASHBOARD_INTERNAL_API_KEY`，并重启服务。

### 7.3 轮换后验证

```bash
curl -i -sS -H "x-api-key: <旧key>" "http://localhost:38473/api/operators/reddit/status"
curl -i -sS -H "x-api-key: <新key>" "http://localhost:38473/api/operators/reddit/status"
```

预期：旧 key `403`，新 key `200`。

---

## 8. Reddit 生产监控

### 8.1 手动 SLO 巡检

```bash
API_URL="http://localhost:38473" \
API_KEY="<可用API_KEY>" \
pnpm run monitor:reddit:slo -- \
  --window-minutes 15 \
  --max-4xx-ratio 0.20 \
  --max-5xx-ratio 0.05 \
  --max-429-ratio 0.15 \
  --max-timeout-ratio 0.05 \
  --max-p95-ms 6000
```

退出码：

- `0`：健康
- `2`：阈值超标
- `1`：脚本或运行错误

### 8.2 定时任务（cron 示例）

```cron
*/5 * * * * cd /opt/headlessx && API_URL="http://localhost:38473" API_KEY="<可用API_KEY>" pnpm run monitor:reddit:slo -- --window-minutes 15 --max-4xx-ratio 0.20 --max-5xx-ratio 0.05 --max-429-ratio 0.15 --max-timeout-ratio 0.05 --max-p95-ms 6000
```

如需告警通道，追加：`--alert-webhook-url <webhook地址>`。

---

## 9. 回滚流程（必须可演练）

### 9.1 触发条件

- 核心 API 连续异常
- 登录/鉴权链路不可用
- 队列堆积且恢复无进展
- Reddit 关键指标明显劣化且不可快速修复

### 9.2 执行步骤

```bash
git checkout <上一个稳定tag>
cd infra/docker
docker compose --profile all up -d --build
```

### 9.3 回滚后验收

- `api/worker/web` 状态正常
- 登录与 API key 调用恢复
- Reddit 预检核心接口恢复

---

## 10. 备份与恢复

### 10.1 备份 Postgres

```bash
docker exec -t headlessx-postgres pg_dump -U postgres headlessx > headlessx-$(date +%F-%H%M%S).sql
```

### 10.2 恢复 Postgres

```bash
cat <backup.sql> | docker exec -i headlessx-postgres psql -U postgres -d headlessx
```

---

## 11. 常见故障速查

### 11.1 启动报缺少安全变量

现象：

- `Missing required security environment variables`

处理：

- 检查 `DASHBOARD_INTERNAL_API_KEY`
- 检查 `CREDENTIAL_ENCRYPTION_KEY`

### 11.2 登录返回 503（限流相关）

现象：

- 登录接口报 Redis unavailable / timeout

处理：

- 检查 Redis 服务是否健康
- fail-open=false 时，Redis 故障会阻断登录（预期）

### 11.3 Worker 处于 waiting

现象：

- `Queue Worker is waiting for Redis`

处理：

- 修复 Redis 连通性
- 恢复后 worker 自动或重启恢复

### 11.4 登录 403（curl 调试）

现象：

- 鉴权接口 403

处理：

- 补 `Origin`/`Referer` 同源请求头

### 11.5 密码哈希格式错误

现象：

- `DASHBOARD_AUTH_PASSWORD_HASH format is invalid`

处理：

- 使用 `scrypt:<salt>:<hash>` 格式
- 避免 dotenv 中 `$` 转义陷阱

---

## 12. 生产上线检查清单

- [ ] 必填安全变量已配置并保存在密钥管理系统
- [ ] Dashboard 鉴权启用，使用哈希密码
- [ ] Redis 可用，且登录限流 fail-open=false
- [ ] `docker compose ps` 全部核心服务健康
- [ ] `verify:reddit:prelaunch` 全 PASS
- [ ] `monitor:reddit:slo` 基线健康
- [ ] 备份与回滚步骤已验证
- [ ] 密钥轮换流程已演练

---

## 13. 关联文档

- 英文版：`Deploy/README.md`
- 域名与 HTTPS：`infra/domain-setup/README.md`
- 环境变量参考：`infra/docker/.env.example`
- 自托管细节：`docs/setup-guide.md`
