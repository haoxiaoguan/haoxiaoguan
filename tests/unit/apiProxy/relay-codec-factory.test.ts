// codec 工厂单测（TDD）。
// 验证：
//   ① openai 返回 OpenAiChatCodec（protocol = 'openai'）
//   ② anthropic 返回 AnthropicCodec（protocol = 'anthropic'）
//   ③ 未知协议抛出含协议名的错误
import { describe, it, expect } from 'vitest'
import { createRelayCodec } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/relay/codec-factory'
import { OpenAiChatCodec } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/relay/openai-codec'
import { AnthropicCodec } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/relay/anthropic-codec'

describe('createRelayCodec', () => {
  it('openai → OpenAiChatCodec，protocol = "openai"', () => {
    const codec = createRelayCodec('openai')
    expect(codec).toBeInstanceOf(OpenAiChatCodec)
    expect(codec.protocol).toBe('openai')
  })

  it('anthropic → AnthropicCodec，protocol = "anthropic"', () => {
    const codec = createRelayCodec('anthropic')
    expect(codec).toBeInstanceOf(AnthropicCodec)
    expect(codec.protocol).toBe('anthropic')
  })

  it('未知协议抛出含协议名的错误', () => {
    expect(() => createRelayCodec('gemini')).toThrow('暂不支持的中转上游协议: gemini')
    expect(() => createRelayCodec('unknown-proto')).toThrow('暂不支持的中转上游协议: unknown-proto')
    expect(() => createRelayCodec('')).toThrow('暂不支持的中转上游协议: ')
  })
})
