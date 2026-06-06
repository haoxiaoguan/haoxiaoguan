// 请求级结构化可观测性（G3）——内存环形缓冲 + 累计计数器 + 单订阅推送。
//
// 设计：
//   - 环形缓冲固定容量（默认 500），满则淘汰最旧，供 UI 拉取最近 N 条与实时订阅。
//   - 计数器单调累加（requests/success/failed/input·outputTokens），喂 G10 /metrics。
//     clear() 只清环形缓冲、不重置计数器（Prometheus counter 必须单调）。
//   - errorMessage 写入前过 redactString 脱敏（剥 Bearer/JWT/路径），与 G14 同口径。
//   - 注入 clock 便于单测（默认 Date.now）。纯内存，无 I/O；进程重启重建。
import { redactString } from '../../../../platform/log/redact'

/** 单条请求观测记录（落环 + 推 UI）。 */
export interface ProxyRequestRecord {
  /** 单调自增序号（从 1 起），UI 去重/排序用。 */
  seq: number
  /** 记录时刻（clock 毫秒）。 */
  tsMs: number
  method: string
  path: string
  /** 入站协议（openai/anthropic/gemini/openai-responses；解析失败为 'unknown'）。 */
  format: string
  /** 命中的平台前缀（裸路由为 undefined）。 */
  platform?: string
  action: string
  stream: boolean
  /** 最终 HTTP 状态（成功 200；失败取 ApiProxyHttpError.status 或 500）。 */
  status: number
  ok: boolean
  durationMs: number
  /** 故障转移尝试次数（切号次数 + 1）。 */
  attempts: number
  /** 实际服务该请求的账号（FailoverAdapter 注入；未选到为 undefined）。 */
  accountId?: string
  /** 鉴权命中的客户端 Key id（匿名回环为 undefined）。 */
  clientKeyId?: string
  inputTokens?: number
  outputTokens?: number
  /** 失败时的错误消息（已脱敏）。 */
  errorMessage?: string
}

/** record() 入参：除 seq/tsMs（由本服务生成）外的全部字段。 */
export type ProxyRequestRecordInput = Omit<ProxyRequestRecord, 'seq' | 'tsMs'>

/** 累计计数器快照（喂 /metrics）。 */
export interface ProxyMetricsCounters {
  requestsTotal: number
  successTotal: number
  failedTotal: number
  inputTokensTotal: number
  outputTokensTotal: number
  /** 反代启动时刻（markStarted 设置；未启动为 null），算 uptime 用。 */
  startedAtMs: number | null
}

export interface ProxyRequestLogOpts {
  /** 环形缓冲容量，默认 500，下限 1。 */
  capacity?: number
  /** 注入时钟（测试用），默认 Date.now。 */
  clock?: () => number
}

export class ProxyRequestLog {
  private readonly capacity: number
  private readonly clock: () => number
  private readonly ring: ProxyRequestRecord[] = []
  private seq = 0
  // 单订阅推送（容器把它接到 webContents.send；无注解箭头初始化以避开 bytecode 限制——
  // 这里是 null 字面量初始化，安全）。
  private listener: ((r: ProxyRequestRecord) => void) | null = null
  // 计数器（单调）。
  private requestsTotal = 0
  private successTotal = 0
  private failedTotal = 0
  private inputTokensTotal = 0
  private outputTokensTotal = 0
  private startedAtMs: number | null = null

  constructor(opts: ProxyRequestLogOpts = {}) {
    this.capacity = Math.max(1, opts.capacity ?? 500)
    this.clock = opts.clock ?? Date.now
  }

  /** 反代启动：记录启动时刻（uptime 基准）。 */
  markStarted(): void {
    this.startedAtMs = this.clock()
  }

  /** 反代停止：清空启动时刻（uptime 归零）。 */
  markStopped(): void {
    this.startedAtMs = null
  }

  /** 记录一条请求：生成 seq/ts、脱敏错误消息、落环（满则淘汰最旧）、累计计数、推订阅。 */
  record(input: ProxyRequestRecordInput): ProxyRequestRecord {
    const rec: ProxyRequestRecord = {
      ...input,
      seq: ++this.seq,
      tsMs: this.clock(),
      ...(input.errorMessage !== undefined
        ? { errorMessage: redactString(input.errorMessage) }
        : {}),
    }
    this.ring.push(rec)
    while (this.ring.length > this.capacity) this.ring.shift()

    this.requestsTotal += 1
    if (rec.ok) this.successTotal += 1
    else this.failedTotal += 1
    if (rec.inputTokens) this.inputTokensTotal += rec.inputTokens
    if (rec.outputTokens) this.outputTokensTotal += rec.outputTokens

    if (this.listener !== null) {
      try {
        this.listener(rec)
      } catch {
        // 推送失败不影响主流程
      }
    }
    return rec
  }

  /** 取最近 limit 条（缺省全部，按时间升序）。 */
  listRecent(limit?: number): ProxyRequestRecord[] {
    if (limit === undefined || limit >= this.ring.length) return [...this.ring]
    if (limit <= 0) return []
    return this.ring.slice(this.ring.length - limit)
  }

  /** 清空环形缓冲（计数器保持单调，不重置）。 */
  clear(): void {
    this.ring.length = 0
  }

  /** 设置/清除单订阅（null 取消）。 */
  setListener(fn: ((r: ProxyRequestRecord) => void) | null): void {
    this.listener = fn
  }

  /** 计数器快照（喂 /metrics）。 */
  counters(): ProxyMetricsCounters {
    return {
      requestsTotal: this.requestsTotal,
      successTotal: this.successTotal,
      failedTotal: this.failedTotal,
      inputTokensTotal: this.inputTokensTotal,
      outputTokensTotal: this.outputTokensTotal,
      startedAtMs: this.startedAtMs,
    }
  }
}

/**
 * 单请求链路中被回填的可变观测对象：
 *   - attempts/accountId 由 FailoverAdapter 经 UpstreamCtx.observation 写入；
 *   - inputTokens/outputTokens 由 ApiProxyService 在编排时写入。
 */
export interface RequestObservation {
  attempts: number
  accountId?: string
  inputTokens?: number
  outputTokens?: number
}
