# 路由日志重构设计方案

| 项 | 值 |
|---|---|
| 状态 | 已落地（observability v2，随 0.3.0 发布；旧 routing-log 三出口已统一并下线） |
| 日期 | 2026-06-18 |
| 模块 | `apiProxy` · 路由日志分析（routing-log / observability） |
| 范围 | 全维度（检索 / 实时 / 可观测 / 长期维度 / 性能 / 导出 / UI） |
| 策略 | 较大重构：统一三个数据出口 + 重设计 schema |
| 规模假设 | 中等：1 万 ~ 10 万 请求/日（明细 90 天上限 ≈ 900 万行，单机 SQLite 可承载） |

---

## 1. 背景与现状

### 1.1 当前数据流

```
请求 → ApiProxyService 编排（回填 RequestObservation：attempts/account/token/combo/routePath…）
  → ProxyRequestLog.record()                       ← 内存环形缓冲 cap=500
       ├─ listener     → webContents.send(apiProxy:requestLog)   （main.ts 实时推送）
       ├─ persistSink  → RoutingLogService.enqueue()             （内存缓冲 cap=5000）
       │                    → flush(~15s + 退出前) → SQLite 明细 + 日桶
       └─ counters     → /metrics（Prometheus G10）
```

### 1.2 三个割裂的数据出口（核心问题）

| 出口 | 实现 | 入口 | 特征 |
|---|---|---|---|
| A. 内存历史 | `ProxyRequestLog` 环形缓冲 | `apiProxy:getRequestLog` / `clearRequestLog` | cap 500，进程重启丢失 |
| B. 实时推送 | `ProxyRequestLog.listener` | `apiProxy:requestLog`（事件） | 已推到渲染层，但日志页未订阅 |
| C. 持久化 | `RoutingLogService` + SQLite | `routingLog:*` | 页面实际使用，明细 + 日桶 |

`ProxyRequestRecord`（main）与 `RoutingRecentRow`（domain）与 `ProxyRequestRecord`/`RoutingRecentRowDto`（shared）字段同形、维护多份。

### 1.3 现有存储两层

- 明细表 `routing_request_logs`：每请求一行，保留 90 天。索引 `(tsSec)`、`(tsSec, ok)`。
- 日桶 `routing_daily_rollups`：仅 `(date, platform, comboName)` 维度，保留 365 天。

### 1.4 现有前端

`src/renderer/pages/ApiProxyLogs.tsx`（路由 `/api-service/logs`）：KPI×7 + 趋势面积图 + 维度下钻（platform/combo/model/status/account）+ Top 错误 + 最近请求表。数据来自 `src/renderer/stores/routingLogStore.ts`。

### 1.5 痛点清单

| 编号 | 痛点 | 证据 |
|---|---|---|
| P1 | 「最近请求」不跟随时间窗，固定 200 条、无分页 | `ApiProxyLogs.tsx` 调 `fetchRecent(200, recentFilter)`，未传 window；`routing-log-service.ts#recent(limit, filter)` 无 window 参数 |
| P2 | 检索弱：仅能按 ok/平台/组合过滤；无关键字搜索；无单请求详情抽屉 | `RoutingRecentFilter` 仅 4 字段；`routePath`/错误全文仅在 tooltip |
| P3 | 不实时：页面拉取式，已有 `listener` 实时流未接入该页 | `main.ts#setListener` → `apiProxy:requestLog`，页面无订阅 |
| P4 | 可观测维度浅：流式仅 `durationMs`，无 TTFB/tokens·s⁻¹；无上游 endpoint / 出站 proxyId / 客户端 IP·UA；错误无分类 | `proxy-request-log.ts` 字段 |
| P5 | 长期维度丢失：日桶仅 platform+combo，model/account/status 受明细 90 天保留期约束 | `routing-daily-rollup.entity.ts` 主键 |
| P6 | 规模化性能：`summary` 额外扫 p95 + peakRpm；`rebuildRollupsSince` 每次 flush DELETE+全量重建当天日桶 | `mikro-orm-routing-log.repository.ts` |
| P7 | 三出口割裂、字段同形多份 | 见 1.2 |
| P8 | 无导出（CSV/JSON） | — |

---

## 2. 目标与范围

把「路由日志」从【统计概览页】升级为【可排障的可观测中心】：

1. **检索与排障**：关键字搜索 + 全维度过滤 + 单请求详情抽屉 + keyset 分页（P1、P2）。
2. **实时化**：实时滚动 tail + 暂停/继续 + 实时 KPI（P3）。
3. **可观测深化**：TTFB / tokens·s⁻¹、错误分类、上游 endpoint / 出站代理 / 客户端 IP（P4）。
4. **长期维度不丢**：日桶增维 model / account / status（P5）。
5. **规模化性能**：窗口自适应查询 + 增量 rollup + 索引优化（P6）。
6. **导出**：CSV / JSON（P8）。
7. **统一架构**：三出口 → 三职责，单一事实源（P7）。
8. **UI/UX 改版**：信息密度、暗色、布局。

---

## 3. 总体架构（统一三出口 → 三职责）

```
                          ┌─ (实时) listener ──merge 200ms──→ routingLog:event ─→ 前端实时模式
请求 → ApiProxyService ─→ ObservabilityHub.record()
   (回填 RoutingEvent)      ├─ (指标) counters ───────────────→ /metrics (Prometheus)
                          └─ (历史) enqueue → flush(批) ──→ SQLite: routing_events + 4 张日桶
                                                                    ↑ 唯一历史 / 检索 / 聚合源
```

变更要点：

- `ProxyRequestLog` 瘦身为 **ring + counters + listener** 三职责（实时尾巴 + Prometheus 计数），不再作为历史查询源。
- 历史 / 检索 / 聚合一律走持久化层；实时统一为 `routingLog:event`。
- 删除：`API_PROXY_CHANNELS.getRequestLog` / `clearRequestLog`、`API_PROXY_EVENTS.requestLog`。

---

## 4. 领域模型（统一 `RoutingEvent`）

取代 `ProxyRequestRecord` + `RoutingRecentRow` 双份定义。

```ts
// src/main/contexts/apiProxy/domain/observability/routing-event.ts
export type ErrorKind =
  | 'none' | 'timeout' | 'network' | 'auth' | 'quota' | 'ratelimit'
  | 'upstream_4xx' | 'upstream_5xx' | 'parse' | 'canceled' | 'internal'

export interface RoutingEvent {
  seq: number
  tsMs: number
  method: string
  path: string
  format: string                 // openai/anthropic/gemini/openai-responses/unknown
  platform?: string
  action: string
  stream: boolean
  status: number
  ok: boolean
  errorKind: ErrorKind           // 新：错误分类
  errorMessage?: string          // 脱敏

  // —— 时间线 ——
  durationMs: number
  ttfbMs?: number                // 新：流式首字节延迟
  upstreamMs?: number            // 新：选号完成 → 上游首字节

  // —— 路由维度 ——
  attempts: number
  routeHops?: number
  routePath?: string[]
  comboName?: string
  requestedModel?: string
  finalModel?: string
  accountId?: string
  clientKeyId?: string
  upstreamEndpoint?: string      // 新：上游真实 host（脱敏）
  proxyId?: string               // 新：出站代理

  // —— 用量 ——
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reqBytes?: number              // 新（可选）
  respBytes?: number             // 新（可选）

  // —— 隐私（默认不采，受设置开关）——
  clientIp?: string
  userAgent?: string
}

export type RoutingEventInput = Omit<RoutingEvent, 'seq' | 'tsMs'>
```

---

## 5. 存储设计

### 5.1 明细表 `routing_events`（取代 `routing_request_logs`）

现有列 + 新列：`ttfb_ms`、`upstream_ms`、`error_kind`、`upstream_endpoint`、`proxy_id`、`req_bytes`、`resp_bytes`、`client_ip`、`user_agent`（全部 nullable，向后兼容）。

索引（覆盖窗口过滤 + 下钻 + keyset 分页 + 检索）：

```sql
CREATE INDEX idx_re_ts          ON routing_events(ts_sec);
CREATE INDEX idx_re_ts_ok       ON routing_events(ts_sec, ok);
CREATE INDEX idx_re_ts_platform ON routing_events(ts_sec, platform);
CREATE INDEX idx_re_ts_account  ON routing_events(ts_sec, account_id);
CREATE INDEX idx_re_ts_status   ON routing_events(ts_sec, status);
CREATE INDEX idx_re_keyset      ON routing_events(ts_ms DESC, id DESC);  -- 分页
```

### 5.2 日桶拆 4 张窄表（避免维度叉乘爆炸）

| 表 | 主键 | 用途 |
|---|---|---|
| `routing_rollup_daily` | `(date, platform, combo_name)` | 平台 / 组合长期趋势（沿用并增度量列） |
| `routing_rollup_model_daily` | `(date, model)` | 模型维度长期趋势 / 下钻 |
| `routing_rollup_account_daily` | `(date, account_id)` | 账号维度（含 `rate_limited` 计数） |
| `routing_rollup_status_daily` | `(date, status_class)` | 状态类（2xx/4xx/5xx）长期趋势 |

统一度量列：`requests / success / failed / sum_duration_ms / sum_ttfb_ms / input_tokens / output_tokens / cache_read_tokens / cache_write_tokens / updated_at`（账号表另加 `rate_limited`）。

中等规模下每天各表行数为十~千级，保留 400 天仅百万级，可接受。

### 5.3 保留与清理

- 明细 90 天（可配 `detailRetentionDays`）。
- 日桶 400 天（可配 `rollupRetentionDays`）。
- 维持按本地自然日节流的 `maybePurge`（DELETE 走索引）。

### 5.4 迁移机制（项目已具备）

建表走 `SchemaGenerator.updateSchema({ wrap: false })`（幂等，create-if-not-exists）+ `runMigrations()`（补主键重建等 SQLite 限制）。新 entity 需注册进 `src/main/platform/persistence/entities.ts` 的 `ALL_ENTITIES`。

迁移步骤：

1. 新增 entity（`routing_events` + 4 日桶）并注册 → `updateSchema` 自动建表。
2. 一次性把旧 `routing_request_logs` 搬入 `routing_events`（migration `INSERT...SELECT`）。
3. 重建全部日桶。
4. 切流稳定后删除旧表 `routing_request_logs` / `routing_daily_rollups`。

---

## 6. 摄取管道（ingest）

- `record()`：`ring.push`（实时 + 计数）+ `enqueue`（持久化缓冲，cap 5000，超额丢最旧）。
- `flush()`（main.ts 定时 ~15s + 退出前）：
  1. 批量 `INSERT` 明细；
  2. **热日 UPSERT 增量累加**（替代「DELETE + 全量 GROUP BY 重建当天」），把热日成本从 `O(当天总量)` 降到 `O(batch)`；
  3. 按天节流 `purge`。
- 落库失败丢弃该批（不重新入队、不毒化），不影响反代主流程（沿用现策略）。

采集打点新增：

- `ttfbMs`：在 relay / FailoverAdapter 出站读到首字节时记录。
- `errorKind`：随 `ApiProxyHttpError` / `RelayHttpError` 分类时一并产出。
- `upstreamEndpoint` / `proxyId`：由 FailoverAdapter 注入 `RequestObservation`。

---

## 7. 查询服务（窗口自适应）

```ts
interface RoutingQuery {
  summary(w): RoutingSummary            // ≤31d 走明细（精确 p95/peakRpm）；>31d 走日桶（近似，省略 p95）
  trend(w, metric, granularity)         // metric: requests|success|failed|tokens|latency|rpm
  breakdown(w, dim)                     // dim: platform|combo|model|status|account|clientKey
  search(w, filter, cursor, limit)      // keyset 分页（取代 recent，带 window，修 P1）
  detail(id): RoutingEventDetail        // 单请求完整时间线
  export(w, filter): AsyncIterable      // CSV/JSON 流式
  accountStats(w)                       // 账号池健康页复用
}
```

`filter` 扩展：`okOnly / failedOnly / platform / combo / model / account / clientKey / statusClass / errorKind / keyword`（keyword 对 `path / model / error` 做 `LIKE`）。

窗口自适应阈值（默认 31 天）：

- `summary` / `breakdown` / `trend(hour)`：窗口 ≤ 阈值走明细（精确）；> 阈值走日桶（廉价，标注「近似」，省略 p95/peakRpm）。
- `search` / `detail` / `export`：始终走明细（受 90 天保留约束）。

---

## 8. 实时层

- listener 侧 **200ms 批量合并**后 `webContents.send(routingLog:event, batch)`，避免高 QPS 刷爆渲染层（每秒最多 5 次注入）。
- 前端「实时模式」开关：
  - 开：新事件滚动注入表头 + KPI 增量累计。
  - 暂停：停止注入，显示「有 N 条新记录」气泡，恢复时合并。

---

## 9. IPC 契约（重设计）

```ts
// src/shared/ipc-channels.ts
export const ROUTING_LOG_CHANNELS = {
  summary, trend, breakdown, topErrors,
  search,        // 新：取代 recent（window + filter + keyword + cursor）
  detail,        // 新
  export,        // 新
  accountStats,  // 从 api-proxy-handlers 迁入（账号池健康共用）
  clear,
} as const

export const ROUTING_LOG_EVENTS = { event: 'routingLog:event' } as const

// 删除：API_PROXY_CHANNELS.getRequestLog / clearRequestLog、API_PROXY_EVENTS.requestLog
```

DTO（`src/shared/api/routing.ts`）：统一 `RoutingEventDto` + `RoutingEventDetailDto` + `RoutingSearchPageDto { rows, nextCursor }`，删除重复的 `ProxyRequestRecord` / `RoutingRecentRowDto`。

---

## 10. 前端 UI/UX 重构

目录收敛到 `src/renderer/features/routing-log/`（page + components + hooks + store）。

| 组件 | 职责 |
|---|---|
| `Toolbar` | 时间窗 · 实时开关 · 搜索框 · 过滤 chips（多维）· 刷新 · 导出 · 清空 |
| `KpiStrip` | 请求 / RPM / 成功率 / 延迟(avg·P95) / Token / 降级 / 组合 + 实时增量 |
| `TrendChart` | 指标切换（请求/成功率/延迟/Token/RPM），hour↔day 自适应 |
| `BreakdownPanel` | 维度增 `clientKey`；行点击 → 作为过滤注入检索 |
| `ErrorPanel` | 按 `errorKind` 分组 + 展开 top 消息（修错误碎片化） |
| `RequestTable` | 虚拟滚动 + keyset 无限下拉；行点击 → 详情抽屉 |
| `DetailDrawer` | 时间线（收到→选号→每跳→首字节→完成）+ 降级链 + token 明细 + 上游/代理/key/错误全文 |
| `ExportButton` | 导出当前窗口 + 过滤结果（CSV/JSON） |

---

## 11. 性能预算（中等规模 10 万/日上限）

- 明细 900 万行；所有窗口查询命中 `(ts_sec, …)` 复合索引；分页用 keyset 避免大 OFFSET。
- `summary` / `breakdown`：≤ 31 天走明细（≤ 310 万行带索引聚合，百 ms ~ 秒级）；> 31 天走日桶（千 ~ 万行，毫秒级）。
- `flush` 热日 UPSERT：单批 `O(batch)`，与当天累计量无关。
- 实时 200ms 合并：渲染层每秒最多 5 次注入。

---

## 12. 分阶段落地（重构但按 PR 切，降风险）

| PR | 内容 | 关键改动面 |
|---|---|---|
| PR1 | 领域模型 + 新表/索引 + entity 注册 + 摄取管道（新旧表**双写**过渡） | domain / infrastructure / entities.ts |
| PR2 | 查询服务 + 新 IPC（`search/detail/export` + 窗口自适应） | application / ipc / shared |
| PR3 | 实时统一（`routingLog:event` + 200ms 合并；下线 `apiProxy:requestLog`/`getRequestLog`） | main.ts / preload / container.ts |
| PR4 | 前端 `features/routing-log/` 重构（检索/详情/实时/导出/UI） | renderer |
| PR5 | 数据迁移（旧明细搬新表）+ 删旧表/旧 IPC/旧组件 + i18n 清理 | migrations / cleanup |

---

## 13. 风险与回滚

- 双写过渡期可随时切回旧 IPC；新表异常不影响反代主流程（落库失败丢批不毒化）。
- 隐私字段（IP / UA / body）默认关、受设置开关；脱敏沿用 `redactString`。
- DB 体积：保留期可配 + 监控；必要时收紧明细保留天数。
- 维度日桶爆炸：拆窄表 + 主键归一空值（`''`），中等规模下行数可控。

---

## 14. 待确认细节（不阻塞，可后续定）

1. 详情抽屉是否需要存**请求/响应体片段**（涉及隐私与体积，默认不存）。
2. 导出是否要支持**大批量后台导出**（> 10 万行）还是仅当前窗口结果。
3. `errorKind` 分类枚举口径是否按本文（或沿用现有约定）。

---

## 附录 A：涉及的现状文件

| 层 | 文件 |
|---|---|
| 领域 | `src/main/contexts/apiProxy/domain/observability/proxy-request-log.ts`、`routing-log-record.ts` |
| 应用 | `src/main/contexts/apiProxy/application/routing-log-service.ts` |
| 基础设施 | `src/main/contexts/apiProxy/infrastructure/routing-log/{mikro-orm-routing-log.repository,routing-request-log.entity,routing-daily-rollup.entity}.ts` |
| IPC | `src/main/contexts/apiProxy/ipc/routing-log-handlers.ts`、`src/shared/ipc-channels.ts` |
| 装配 | `src/main/container.ts`（~590）、`src/main/main.ts`（~306 setListener / flush 定时） |
| 持久化 | `src/main/platform/persistence/{database,entities}.ts` |
| 前端 | `src/renderer/pages/ApiProxyLogs.tsx`、`src/renderer/stores/routingLogStore.ts`、`src/preload/index.ts`（~248） |
| 共享类型 | `src/shared/api/routing.ts`、`src/shared/api-types.ts` |
