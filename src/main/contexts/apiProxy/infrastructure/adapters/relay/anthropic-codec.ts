// Anthropic Messages 协议 codec：RelayOutboundCodec 的 Anthropic 实现。
// 内部复用 anthropic-outbound.ts 的三函数，不重复实现协议逻辑。
// bytecode 安全：无 class-property 箭头初始化，纯方法。
// 禁：Date.now/Math.random/crypto.randomUUID（确定性）；禁动态 import()。
import type { CanonicalRequest, CanonicalResponse } from '../../../domain/canonical'
import type { AnthropicMessage } from '../../inbound/anthropic'
import type { RelayOutboundCodec, RelayStreamParser } from './relay-codec'
import {
  irToAnthropicRequest,
  anthropicResponseToIR,
  createAnthropicSseToEventsParser,
} from './anthropic-outbound'

/**
 * Anthropic Messages 上游协议 codec。
 * protocol = 'anthropic'。
 * 复用 anthropic-outbound.ts 的三函数：irToAnthropicRequest / anthropicResponseToIR / createAnthropicSseToEventsParser。
 */
export class AnthropicCodec implements RelayOutboundCodec {
  readonly protocol = 'anthropic'

  endpointPath(): string {
    return '/messages'
  }

  authHeaders(apiKey: string): Record<string, string> {
    return {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    }
  }

  renderRequest(ir: CanonicalRequest, stream: boolean): unknown {
    return irToAnthropicRequest({ ...ir, stream })
  }

  parseResponse(raw: unknown): CanonicalResponse {
    return anthropicResponseToIR(raw as AnthropicMessage)
  }

  createStreamParser(): RelayStreamParser {
    return createAnthropicSseToEventsParser()
  }
}
