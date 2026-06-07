// codec 工厂：根据 protocol 字符串实例化对应的 RelayOutboundCodec。
// bytecode 安全：无 class-property 箭头初始化，纯函数。
// 禁：Date.now/Math.random/crypto.randomUUID；禁动态 import()。
import type { RelayOutboundCodec } from './relay-codec'
import { OpenAiChatCodec } from './openai-codec'
import { AnthropicCodec } from './anthropic-codec'

/**
 * 根据协议标识创建对应的 RelayOutboundCodec 实例。
 * 支持: 'openai' | 'anthropic'；'gemini' 后续添加。
 */
export function createRelayCodec(protocol: string): RelayOutboundCodec {
  switch (protocol) {
    case 'openai':
      return new OpenAiChatCodec()
    case 'anthropic':
      return new AnthropicCodec()
    default:
      throw new Error(`暂不支持的中转上游协议: ${protocol}`)
  }
}
