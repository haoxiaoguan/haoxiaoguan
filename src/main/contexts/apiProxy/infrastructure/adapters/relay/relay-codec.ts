// 上游协议编解码器接口：把「协议相关」逻辑从 RelayAdapter 抽出，便于多协议扩展（OpenAI/Anthropic/Gemini）。
// bytecode 安全：纯接口定义，无实现代码。
// 禁：Date.now/Math.random/crypto.randomUUID（确定性）；禁动态 import()。
import type { CanonicalRequest, CanonicalResponse, CanonicalStreamEvent } from '../../../domain/canonical'

/** 上游 SSE 增量解析器：push 喂入文本块（可半帧），返回本次解出的 IR 事件；flush 收尾。 */
export interface RelayStreamParser {
  push(chunk: string): CanonicalStreamEvent[]
  flush(): CanonicalStreamEvent[]
}

/**
 * 上游协议编解码器：封装「IR ↔ 上游线协议」的所有协议相关逻辑。
 * RelayAdapter 通过注入不同 codec 支持多协议（openai / anthropic / gemini …）。
 */
export interface RelayOutboundCodec {
  /** 协议标识（'openai' | 'anthropic' | 'gemini'）。 */
  readonly protocol: string
  /** 上游请求路径（相对 baseUrl），如 '/chat/completions'。 */
  endpointPath(): string
  /** 鉴权及必要请求头（apiKey 注入）。 */
  authHeaders(apiKey: string): Record<string, string>
  /** IR → 上游请求体（stream 决定是否带流式开关）。 */
  renderRequest(ir: CanonicalRequest, stream: boolean): unknown
  /** 上游非流式 JSON → CanonicalResponse。 */
  parseResponse(raw: unknown): CanonicalResponse
  /** 创建「上游流文本块 → IR 事件」的增量解析器。 */
  createStreamParser(): RelayStreamParser
}
