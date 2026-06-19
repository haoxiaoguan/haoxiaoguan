// 路由日志重构（observability v2）· 查询领域类型（纯类型，无 I/O）。
//
// 查询窗口为 epoch 秒闭区间（RoutingWindow），由渲染层时间选择器给出：
//   - summary / breakdown / topErrors / accountStats / search / trend(hour) 走明细表 routing_events；
//   - trend(day) 走日桶 routing_rollup_daily（明细被清理后仍可看长期趋势）。
// 注：summary/breakdown 大窗口走日桶的自适应留待性能优化阶段；当前中等规模（≤90 天明细）直接走明细。

import type { RoutingEvent } from './routing-event'

/** 查询窗口：epoch 秒闭区间。 */
export interface RoutingWindow {
  startSec: number
  endSec: number
}

/** 趋势粒度：hour 走明细秒桶；day 走日桶 rollup。 */
export type RoutingGranularity = 'hour' | 'day'

/** 多维下钻维度（相比旧版新增 clientKey）。 */
export type RoutingBreakdownDim = 'platform' | 'combo' | 'model' | 'status' | 'account' | 'clientKey'

/** 趋势指标（前端切换；trend 返回全字段，由前端取用）。 */
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
  /** 平均首字节延迟（毫秒，仅统计有 ttfb 的请求；无则 0）。 */
  avgTtfbMs: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
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
  /** 维度取值：平台名 / 组合名 / 模型 / 账号 id / 客户端 Key / 状态类（2xx/4xx/5xx）。空值归一为 '—'。 */
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

/** Top 错误聚合行（按 errorKind + 脱敏后的错误消息归并）。 */
export interface RoutingErrorRow {
  errorKind: string
  message: string
  count: number
  lastStatus: number
  lastTsMs: number
}

/** 按账号聚合的统计（供账号池健康页）。 */
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
  inputTokens: number
  outputTokens: number
  /** 窗口内缓存 token 合计（读 + 写）。 */
  cacheTokens: number
  /** 最近一次被请求的时刻（ms）。 */
  lastTsMs: number
}

/** 状态类（与 statusClassOf 一致）。 */
export type RoutingStatusClass = '2xx' | '3xx' | '4xx' | '5xx' | 'other'

/** 明细检索过滤（取代旧 recent 的 4 字段过滤；全维度 + 关键字）。 */
export interface RoutingSearchFilter {
  /** 仅成功 / 仅失败（二者互斥；都为空=全部）。 */
  okOnly?: boolean
  failedOnly?: boolean
  platform?: string
  comboName?: string
  model?: string
  accountId?: string
  clientKeyId?: string
  statusClass?: RoutingStatusClass
  errorKind?: string
  /** 关键字（对 path / final_model / requested_model / error_message 做 LIKE）。 */
  keyword?: string
}

/** keyset 分页游标（按 (ts_ms, id) 降序）。 */
export interface RoutingCursor {
  tsMs: number
  id: number
}

/** 明细行（落库后的 RoutingEvent 投影 + 主键 id，供分页/详情）。 */
export interface RoutingEventRow extends RoutingEvent {
  id: number
}

/** 检索分页结果：本页行 + 下一页游标（无更多则缺省）。 */
export interface RoutingSearchPage {
  rows: RoutingEventRow[]
  nextCursor?: RoutingCursor
}
