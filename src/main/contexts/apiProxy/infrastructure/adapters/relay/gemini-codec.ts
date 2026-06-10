// Gemini generateContent 协议 codec：RelayOutboundCodec 的 Gemini 实现。
// 内部复用 gemini-outbound.ts 的三函数，不重复实现协议逻辑。
// Gemini 特殊性：model 在 URL 路径（非 body），流式靠 endpoint 区分（:streamGenerateContent?alt=sse）。
// bytecode 安全：无 class-property 箭头初始化，纯方法。
// 禁：Date.now/Math.random/crypto.randomUUID（确定性）；禁动态 import()。
import type { CanonicalRequest, CanonicalResponse } from '../../../domain/canonical'
import type { GeminiGenerateContentResponse } from '../../inbound/gemini'
import type { RelayOutboundCodec, RelayStreamParser } from './relay-codec'
import {
  irToGeminiRequest,
  geminiResponseToIR,
  createGeminiSseToEventsParser,
} from './gemini-outbound'

/**
 * Gemini generateContent 上游协议 codec。
 * protocol = 'gemini'。
 * 复用 gemini-outbound.ts 的三函数：irToGeminiRequest / geminiResponseToIR / createGeminiSseToEventsParser。
 *
 * endpointPath：
 *   非流式 → /models/{model}:generateContent
 *   流式   → /models/{model}:streamGenerateContent?alt=sse
 * baseUrl 通常为 'https://generativelanguage.googleapis.com/v1beta'。
 *
 * 鉴权：x-goog-api-key 头（与 OpenAI Bearer / Anthropic x-api-key 不同）。
 */
export class GeminiCodec implements RelayOutboundCodec {
  readonly protocol = 'gemini'

  endpointPath(ir: CanonicalRequest, stream: boolean): string {
    const model = ir.model
    if (stream) {
      return `/models/${model}:streamGenerateContent?alt=sse`
    }
    return `/models/${model}:generateContent`
  }

  authHeaders(apiKey: string): Record<string, string> {
    return {
      'x-goog-api-key': apiKey,
      'content-type': 'application/json',
    }
  }

  renderRequest(ir: CanonicalRequest, _stream: boolean): unknown {
    // Gemini 流式不靠 body 字段（靠 endpoint 区分），body 不带 stream。
    return irToGeminiRequest(ir)
  }

  parseResponse(raw: unknown): CanonicalResponse {
    return geminiResponseToIR(raw as GeminiGenerateContentResponse)
  }

  createStreamParser(): RelayStreamParser {
    return createGeminiSseToEventsParser()
  }
}
