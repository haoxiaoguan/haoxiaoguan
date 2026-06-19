// 路由日志重构（observability v2）—— 统一的请求事件领域模型。
//
// 取代 ProxyRequestRecord + RoutingRecentRow 的双份定义：record / 落库 / 查询投影共用一型。
// 纯类型 + 纯函数，无 I/O。过渡期（PR1 双写）由 routingEventFromRecord() 从 G3 的
// ProxyRequestRecord 映射而来；采集层接入后（PR2）新字段由来源直接产出。

import type { ProxyRequestRecord } from './proxy-request-log'

/** 错误分类：把失败请求归一到有限枚举，便于聚合、Top 错误与告警。 */
export type ErrorKind =
  | 'none'
  | 'timeout'
  | 'network'
  | 'auth'
  | 'quota'
  | 'ratelimit'
  | 'upstream_4xx'
  | 'upstream_5xx'
  | 'parse'
  | 'canceled'
  | 'internal'

/** HTTP 状态类（日桶 status 维度 + 状态着色用）。 */
export type StatusClass = '2xx' | '3xx' | '4xx' | '5xx' | 'other'

/** 统一请求事件（明细落库 + 查询投影 + 实时推送共用）。 */
export interface RoutingEvent {
  /** 单调自增序号（来自 ProxyRequestLog；不保证跨重启唯一）。 */
  seq: number
  /** 记录时刻（毫秒）。 */
  tsMs: number
  method: string
  path: string
  /** 入站协议（openai/anthropic/gemini/openai-responses/unknown）。 */
  format: string
  /** 命中平台前缀（裸路由为 undefined）。 */
  platform?: string
  action: string
  stream: boolean
  /** 最终 HTTP 状态（成功 200；失败取错误状态或 500；无响应 0）。 */
  status: number
  ok: boolean
  /** 错误分类（成功为 'none'）。 */
  errorKind: ErrorKind
  /** 失败时的错误消息（已脱敏）。 */
  errorMessage?: string

  // ── 时间线 ──
  durationMs: number
  /** 流式首字节延迟（PR2 采集层接入；非流式/未采集为 undefined）。 */
  ttfbMs?: number
  /** 选号完成 → 上游首字节耗时（PR2 采集层接入）。 */
  upstreamMs?: number

  // ── 路由维度 ──
  /** 故障转移尝试次数（切号次数 + 1）。 */
  attempts: number
  /** 组合降级链尝试跳数（直连 = 1）。 */
  routeHops?: number
  /** 依次尝试的跳模型（保序）。 */
  routePath?: string[]
  comboName?: string
  requestedModel?: string
  finalModel?: string
  accountId?: string
  clientKeyId?: string
  /** 上游真实 host（脱敏；PR2 采集层接入）。 */
  upstreamEndpoint?: string
  /** 出站代理 id（PR2 采集层接入）。 */
  proxyId?: string

  // ── 用量 ──
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reqBytes?: number
  respBytes?: number

  // ── 隐私（默认不采集，受设置开关；PR2+）──
  clientIp?: string
  userAgent?: string
}

/** record() 入参：seq/tsMs 由观测层生成。 */
export type RoutingEventInput = Omit<RoutingEvent, 'seq' | 'tsMs'>

/** HTTP 状态 → 状态类。 */
export function statusClassOf(status: number): StatusClass {
  if (status >= 500) return '5xx'
  if (status >= 400) return '4xx'
  if (status >= 300) return '3xx'
  if (status >= 200) return '2xx'
  return 'other'
}

/**
 * 从 HTTP 状态 + 错误消息推导错误分类。
 * 过渡期（PR1）用：采集层尚未直接产出 errorKind 前，从既有 status/ok/message 推导，
 * 使新表 error_kind 立即可用。采集层接入后（PR2）由来源精确覆盖 timeout/parse/canceled。
 */
export function classifyErrorKind(status: number, ok: boolean, message?: string): ErrorKind {
  if (ok) return 'none'
  const msg = (message ?? '').toLowerCase()
  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('etimedout')) {
    return 'timeout'
  }
  if (msg.includes('abort') || msg.includes('cancel')) return 'canceled'
  if (status === 0) return 'network'
  if (status === 401 || status === 403) return 'auth'
  if (status === 402) return 'quota'
  if (status === 429) return 'ratelimit'
  if (status >= 500) return 'upstream_5xx'
  if (status >= 400) return 'upstream_4xx'
  return 'internal'
}

/**
 * 过渡期映射：把 G3 的 ProxyRequestRecord 投影为统一 RoutingEvent。
 * 新字段（ttfb/upstream/endpoint/proxy/bytes/ip/ua）缺省；errorKind 由 status/message 推导。
 * exactOptionalPropertyTypes 下用条件赋值，不写入 undefined。
 */
export function routingEventFromRecord(rec: ProxyRequestRecord): RoutingEvent {
  const ev: RoutingEvent = {
    seq: rec.seq,
    tsMs: rec.tsMs,
    method: rec.method,
    path: rec.path,
    format: rec.format,
    action: rec.action,
    stream: rec.stream,
    status: rec.status,
    ok: rec.ok,
    errorKind: classifyErrorKind(rec.status, rec.ok, rec.errorMessage),
    durationMs: rec.durationMs,
    attempts: rec.attempts,
  }
  if (rec.platform !== undefined) ev.platform = rec.platform
  if (rec.errorMessage !== undefined) ev.errorMessage = rec.errorMessage
  if (rec.routeHops !== undefined) ev.routeHops = rec.routeHops
  if (rec.routePath !== undefined) ev.routePath = rec.routePath
  if (rec.comboName !== undefined) ev.comboName = rec.comboName
  if (rec.requestedModel !== undefined) ev.requestedModel = rec.requestedModel
  if (rec.finalModel !== undefined) ev.finalModel = rec.finalModel
  if (rec.accountId !== undefined) ev.accountId = rec.accountId
  if (rec.clientKeyId !== undefined) ev.clientKeyId = rec.clientKeyId
  if (rec.inputTokens !== undefined) ev.inputTokens = rec.inputTokens
  if (rec.outputTokens !== undefined) ev.outputTokens = rec.outputTokens
  if (rec.cacheReadTokens !== undefined) ev.cacheReadTokens = rec.cacheReadTokens
  if (rec.cacheWriteTokens !== undefined) ev.cacheWriteTokens = rec.cacheWriteTokens
  return ev
}
