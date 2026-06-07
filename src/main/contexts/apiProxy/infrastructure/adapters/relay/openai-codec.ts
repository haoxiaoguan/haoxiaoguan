// OpenAI Chat Completions 协议 codec：RelayOutboundCodec 的 OpenAI 实现。
// 内部复用 openai-outbound.ts（R0）的三函数，不重复实现协议逻辑。
// bytecode 安全：无 class-property 箭头初始化，纯方法。
// 禁：Date.now/Math.random/crypto.randomUUID（确定性）；禁动态 import()。
import type { CanonicalRequest, CanonicalResponse, CanonicalStreamEvent } from '../../../domain/canonical'
import type { OpenAIChatCompletion } from '../../inbound/openai'
import type { RelayOutboundCodec, RelayStreamParser } from './relay-codec'
import {
  irToOpenAIChatRequest,
  openAIChatResponseToIR,
  createOpenAiSseToEventsParser,
} from './openai-outbound'

/**
 * OpenAI Chat Completions 上游协议 codec。
 * protocol = 'openai'。
 * 复用 openai-outbound.ts 的三函数：irToOpenAIChatRequest / openAIChatResponseToIR / createOpenAiSseToEventsParser。
 */
export class OpenAiChatCodec implements RelayOutboundCodec {
  readonly protocol = 'openai'

  endpointPath(): string {
    return '/chat/completions'
  }

  authHeaders(apiKey: string): Record<string, string> {
    return {
      Authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    }
  }

  renderRequest(ir: CanonicalRequest, stream: boolean): unknown {
    return irToOpenAIChatRequest({ ...ir, stream })
  }

  parseResponse(raw: unknown): CanonicalResponse {
    return openAIChatResponseToIR(raw as OpenAIChatCompletion)
  }

  createStreamParser(): RelayStreamParser {
    return createOpenAiSseToEventsParser()
  }
}
