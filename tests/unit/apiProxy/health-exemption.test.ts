import { describe, it, expect } from 'vitest'
import { isHealthExempt } from '../../../src/main/contexts/apiProxy/infrastructure/http/hono-app'

describe('isHealthExempt', () => {
  it('仅豁免裸 /health（平台前缀路由已移除，不再有 /{platform}/health）', () => {
    expect(isHealthExempt('/health')).toBe(true)
    expect(isHealthExempt('/kiro/health')).toBe(false)
  })
  it('不豁免深层/伪造路径', () => {
    expect(isHealthExempt('/a/b/health')).toBe(false)
    expect(isHealthExempt('/healthx')).toBe(false)
    expect(isHealthExempt('/v1/chat/completions')).toBe(false)
  })
})
