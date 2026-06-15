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
  /** 缓存命中读取的 token（prompt cache 读，上游 usage 提供时回填）。 */
  cacheReadTokens?: number
  /** 缓存写入/创建的 token（prompt cache 写，上游 usage 提供时回填）。 */
  cacheWriteTokens?: number
  /** 失败时的错误消息（已脱敏）。 */
  errorMessage?: string
  // ── 路由维度（路由日志分析模块）：组合/降级链相关，直连请求多为 undefined ──
  /** 命中的路由组合名（裸名/直连为 undefined）。 */
  comboName?: string
  /** 客户端请求的原始 model（裸名或组合名；models/health 等无模型为 undefined）。 */
  requestedModel?: string
  /** 实际服务该请求的最终模型（组合命中跳或直连别名解析后；失败时为最后尝试的跳）。 */
  finalModel?: string
  /** 组合降级链尝试的跳数（直连=1；组合按实际尝试到第几跳）。 */
  routeHops?: number
  /** 依次尝试的跳模型（保序；直连=[finalModel]；用于「降级链路径」展示）。 */
  routePath?: string[]
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
  // 持久化 sink（容器把它接到 RoutingLogService.enqueue；与 listener 独立，
  // 一条记录同时推 UI（listener）+ 落库（persistSink），互不影响、各自吞错）。
  private persistSink: ((r: ProxyRequestRecord) => void) | null = null
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
    if (this.persistSink !== null) {
      try {
        this.persistSink(rec)
      } catch {
        // 落库入队失败不影响主流程（最坏丢一条分析样本）
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

  /** 设置/清除持久化 sink（null 取消）。容器注入后每条记录入 RoutingLogService 缓冲。 */
  setPersistSink(fn: ((r: ProxyRequestRecord) => void) | null): void {
    this.persistSink = fn
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
  /** 缓存读 token（上游 usage 回填）。 */
  cacheReadTokens?: number
  /** 缓存写/创建 token（上游 usage 回填）。 */
  cacheWriteTokens?: number
  // ── 路由维度回填（ApiProxyService 编排时写入；组合每跳回填 final*/routeHops/routePath）──
  /** 命中的路由组合名（matchCombo 命中时写入）。 */
  comboName?: string
  /** 客户端请求的原始 model（handleRequest 入口写入）。 */
  requestedModel?: string
  /** 实际服务的最终模型（直连=解析后模型；组合=成功/最后尝试跳的真实模型）。 */
  finalModel?: string
  /** 最终命中平台（组合跳别名解析后回填；直连由 intent.platform 提供）。 */
  finalPlatform?: string
  /** 组合降级链尝试跳数（直连=1）。 */
  routeHops?: number
  /** 依次尝试的跳模型（保序）。 */
  routePath?: string[]
}
