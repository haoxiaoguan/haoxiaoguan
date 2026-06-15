// 路由日志分析模块 —— 持久化记录与查询的领域类型（纯类型，无 I/O）。
//
// 数据分两层（仿 usage context）：
//   - 明细表 routing_request_logs：每请求一行，保留 detailRetentionDays（默认 90 天）。
//     供：最近请求列表、小时级趋势、按模型/账号/状态下钻、Top 错误、P95 延迟。
//   - 日桶 routing_daily_rollups：(date, platform, comboName) 日聚合，保留更久（默认 365 天）。
//     供：天级趋势（即便明细已被清理仍可看长期走势）。
//
// 一条明细 = G3 的 ProxyRequestRecord + tsSec（按秒索引窗口）。routePath 以 JSON 文本落库。

/** 查询窗口：epoch 秒闭区间（由渲染层时间选择器给出）。 */
export interface RoutingWindow {
  startSec: number
  endSec: number
}

/** 趋势粒度：hour 走明细秒桶；day 走日桶 rollup。 */
export type RoutingGranularity = 'hour' | 'day'

/** 多维下钻维度。platform/combo 同时落日桶；model/account/status 仅明细（受保留期约束）。 */
export type RoutingBreakdownDim = 'platform' | 'combo' | 'model' | 'status' | 'account'

/** 趋势指标。 */
export type RoutingTrendMetric = 'requests' | 'success' | 'failed' | 'tokens' | 'latency'

/** 汇总卡片（窗口内整体）。 */
export interface RoutingSummary {
  requests: number
  success: number
  failed: number
  /** 成功率 0..1（requests=0 时为 0）。 */
  successRate: number
  /** 失败率 0..1。 */
  errorRate: number
  avgDurationMs: number
  /** P95 延迟（毫秒，明细估算；窗口内无数据为 0）。 */
  p95DurationMs: number
  inputTokens: number
  outputTokens: number
  /** 缓存读 token 合计。 */
  cacheReadTokens: number
  /** 缓存写/创建 token 合计。 */
  cacheWriteTokens: number
  /** 总 token = 输入 + 输出 + 缓存读 + 缓存写。 */
  totalTokens: number
  /** 发生过降级（routeHops>1）的请求数。 */
  fallbackRequests: number
  /** 命中路由组合（comboName 非空）的请求数。 */
  comboRequests: number
  /** 峰值 RPM：窗口内单个自然分钟桶的最高请求数（无数据为 0）。 */
  peakRpm: number
}

/** 趋势单点（按 date 桶；天/小时由粒度决定）。 */
export interface RoutingTrendPoint {
  date: string
  requests: number
  success: number
  failed: number
  avgDurationMs: number
  inputTokens: number
  outputTokens: number
}

/** 维度下钻行。 */
export interface RoutingBreakdownRow {
  /** 维度取值：平台名 / 组合名 / 模型 / 账号 id / 状态类（2xx/4xx/5xx）。空值归一为 '—'。 */
  key: string
  requests: number
  success: number
  failed: number
  /** 成功率 0..1。 */
  successRate: number
  avgDurationMs: number
  inputTokens: number
  outputTokens: number
  /** 占窗口总请求比 0..1。 */
  shareRatio: number
}

/** Top 错误聚合行（按脱敏后的错误消息归并）。 */
export interface RoutingErrorRow {
  message: string
  count: number
  lastStatus: number
  lastTsMs: number
}

/** 按账号聚合的统计（供账号池健康页：请求/成功/失败/429 限流次数等）。 */
export interface RoutingAccountStat {
  accountId: string
  requests: number
  success: number
  failed: number
  /** 命中 429（限流）的次数。 */
  rateLimited: number
  avgDurationMs: number
  /** 峰值 RPM：窗口内该账号单个自然分钟桶的最高请求数（无数据为 0）。 */
  peakRpm: number
  /** 窗口内输入 token 合计。 */
  inputTokens: number
  /** 窗口内输出 token 合计。 */
  outputTokens: number
  /** 窗口内缓存 token 合计（读 + 写）。 */
  cacheTokens: number
  /** 最近一次被请求的时刻（ms）。 */
  lastTsMs: number
}

/** 最近请求过滤（明细）。 */
export interface RoutingRecentFilter {
  /** 仅成功 / 仅失败（二者互斥；都为空=全部）。 */
  okOnly?: boolean
  failedOnly?: boolean
  /** 按平台 / 组合精确过滤。 */
  platform?: string
  comboName?: string
}

/** 最近请求明细行（落库后的 ProxyRequestRecord 投影 + 持久化 tsSec）。 */
export interface RoutingRecentRow {
  seq: number
  tsMs: number
  method: string
  path: string
  format: string
  platform?: string
  action: string
  stream: boolean
  status: number
  ok: boolean
  durationMs: number
  attempts: number
  accountId?: string
  clientKeyId?: string
  comboName?: string
  requestedModel?: string
  finalModel?: string
  routeHops?: number
  routePath?: string[]
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  errorMessage?: string
}
