// 平台上游适配器契约（M2b 最小版）。每个上游平台实现一个本接口 + 注册进 PlatformRegistry，
// 主链路（路由 → ApiProxyService.handleRequest → 出站序列化）对所有平台一致，新增平台零改动主链路。
// 本里程碑唯一实现是 EchoUpstreamAdapter（Kiro 适配器 M3 的占位）。
import type {
  CanonicalRequest,
  CanonicalResponse,
  CanonicalStreamEvent,
} from './canonical'

/** 模型信息（M2b 最小）。M3 可扩 contextWindow / maxOutputTokens / capabilities。 */
export interface ModelInfo {
  id: string
  displayName?: string
}

/**
 * 上游调用上下文（M2b 最小：只透传中止信号 + 调用方注入的稳定 requestId）。
 * 适配器**禁止**读时钟/随机（Date.now/Math.random/crypto.randomUUID），需要的 id 一律由 requestId 派生，
 * 以保证 chat/chatStream 是可单测的确定性函数。
 *
 * M3/M4 将扩展（本里程碑不放）：account（选中账号）、credential（解密凭据）、
 * dispatcher（按账号代理出站 undici dispatcher）、endpointIndex（多上游端点回退）。
 */
export interface UpstreamCtx {
  signal?: AbortSignal
  requestId?: string
}

/**
 * 平台上游适配器接口（M2b 最小版）。
 * M3/M4 将向本接口追加：toUpstreamRequest(ir, ctx)（IR→平台原生体）、
 * classifyError(err)（错误分类喂故障转移/健康）、endpointCount()（同账号多端点数）。
 * 这些都属于账号池/故障转移/Kiro 线格式范畴，M2b 接线里程碑不引入。
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
}
