import { describe, it, expect } from 'vitest'
import { generateClientKey } from '../../../src/main/contexts/apiProxy/domain/client-key-gen'

describe('generateClientKey', () => {
  it('前缀 + 32 字符 base62', () => {
    const k = generateClientKey()
    expect(k).toMatch(/^sk-hxg-[0-9A-Za-z]{32}$/)
  })
  it('注入随机源 → 确定性', () => {
    const fixed = (n: number) => Buffer.alloc(n, 0) // 全 0 字节
    expect(generateClientKey(fixed)).toBe(generateClientKey(fixed))
  })
  it('两次默认调用不相等（极高概率）', () => {
    expect(generateClientKey()).not.toBe(generateClientKey())
  })
})
