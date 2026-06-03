// 平台上游适配器契约（M4 扩展版）。每个上游平台实现一个本接口 + 注册进 PlatformRegistry，
// 主链路（路由 → ApiProxyService.handleRequest → 出站序列化）对所有平台一致，新增平台零改动主链路。
import type {
  CanonicalRequest,
  CanonicalResponse,
  CanonicalStreamEvent,
} from './canonical'
import type { KiroAccountInfo, KiroCredential } from '../infrastructure/adapters/kiro/kiro-ports'
import type { Dispatcher } from 'undici'

/** 上游错误分类（故障转移决策）。M4 错误转移/健康追踪。 */
export type ErrorClass = 'SUSPENDED' | 'AUTH' | 'RATE_LIMIT' | 'SERVER' | 'FATAL'

/** 模型信息（M2b 最小）。M3 可扩 contextWindow / maxOutputTokens / capabilities。 */
export interface ModelInfo {
  id: string
  displayName?: string
}

/**
 * 上游调用上下文（M4 扩展：account/credential/dispatcher 由 FailoverAdapter 注入）。
 * 适配器**禁止**读时钟/随机（Date.now/Math.random/crypto.randomUUID），需要的 id 一律由 requestId 派生，
 * 以保证 chat/chatStream 是可单测的确定性函数。
 */
export interface UpstreamCtx {
  signal?: AbortSignal
  requestId?: string
  /** 会话亲和 hint（extractSessionHint 提取），喂 AccountPoolSelector 粘性逻辑。 */
  sessionHint?: string
  /** 选中账号（由 FailoverAdapter 注入；KiroAdapter 直接消费，不再自选号）。 */
  account?: KiroAccountInfo
  /** 解密凭据（由 FailoverAdapter 注入）。 */
  credential?: KiroCredential
  /** 账号绑定代理 dispatcher（由 FailoverAdapter 注入；undefined = 直连）。 */
  dispatcher?: Dispatcher
}

/**
 * 平台上游适配器接口（M4 版）。
 * classifyError 供 FailoverAdapter 决策：切号/熔断/配额/永久退役。
 */
export interface PlatformUpstreamAdapter {
  /** 平台标识，唯一。用于 /{platform}/v1 锁池与注册表 key。 */
  readonly platform: string
  /** 该平台是否支持某模型名（用于裸路由模型感知选池）。 */
  supportsModel(model: string): boolean
  /** 该平台对外暴露的模型列表（喂 /v1/models 等端点）。 */
  listModels(): ModelInfo[]
  /** 非流式聊天：IR 请求 → IR 响应。 */
  chat(ir: CanonicalRequest, ctx: UpstreamCtx): Promise<CanonicalResponse>
  /** 流式聊天：IR 请求 → IR 事件异步流。 */
  chatStream(ir: CanonicalRequest, ctx: UpstreamCtx): AsyncIterable<CanonicalStreamEvent>
  /** 把上游错误归类，喂故障转移装饰器决策（SUSPENDED/AUTH/RATE_LIMIT/SERVER/FATAL）。 */
  classifyError(err: unknown): ErrorClass
}
