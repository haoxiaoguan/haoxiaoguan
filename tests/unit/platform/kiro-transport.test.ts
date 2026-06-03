import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createKiroTransport, CONSERVATIVE_TLS_CONNECT } from '../../../src/main/platform/net/kiro-transport'

// ---- TLS 选项断言 ----

describe('CONSERVATIVE_TLS_CONNECT', () => {
  it('minVersion 设为 TLSv1.2', () => {
    expect(CONSERVATIVE_TLS_CONNECT.minVersion).toBe('TLSv1.2')
  })

  it('ciphers 字符串非空且包含主流 AES-GCM cipher', () => {
    expect(typeof CONSERVATIVE_TLS_CONNECT.ciphers).toBe('string')
    expect(CONSERVATIVE_TLS_CONNECT.ciphers.length).toBeGreaterThan(0)
    // 必须包含 AWS 后端要求的 AES-GCM 系列
    expect(CONSERVATIVE_TLS_CONNECT.ciphers).toContain('ECDHE-RSA-AES256-GCM-SHA384')
    expect(CONSERVATIVE_TLS_CONNECT.ciphers).toContain('ECDHE-RSA-AES128-GCM-SHA256')
    expect(CONSERVATIVE_TLS_CONNECT.ciphers).toContain('ECDHE-ECDSA-AES256-GCM-SHA384')
    expect(CONSERVATIVE_TLS_CONNECT.ciphers).toContain('ECDHE-ECDSA-AES128-GCM-SHA256')
  })

  it('ciphers 不含已知弱 cipher（3DES/RC4/export）', () => {
    const c = CONSERVATIVE_TLS_CONNECT.ciphers.toUpperCase()
    expect(c).not.toContain('3DES')
    expect(c).not.toContain('RC4')
    expect(c).not.toContain('EXPORT')
    expect(c).not.toContain('DES-')
  })

  it('ciphers 包含 TLS 1.3 条目', () => {
    expect(CONSERVATIVE_TLS_CONNECT.ciphers).toContain('TLS_AES_128_GCM_SHA256')
    expect(CONSERVATIVE_TLS_CONNECT.ciphers).toContain('TLS_AES_256_GCM_SHA384')
    expect(CONSERVATIVE_TLS_CONNECT.ciphers).toContain('TLS_CHACHA20_POLY1305_SHA256')
  })
})

// ---- createKiroTransport 工厂 ----

describe('createKiroTransport — 默认实现', () => {
  it('返回含 fetch 方法的 KiroTransport 对象', () => {
    const transport = createKiroTransport()
    expect(typeof transport.fetch).toBe('function')
  })

  it('无 opts 参数时使用默认实现（不抛异常）', () => {
    expect(() => createKiroTransport()).not.toThrow()
  })
})

describe('createKiroTransport — 自定义实现注入', () => {
  it('注入自定义 impl 后，transport.fetch 调用自定义 impl', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      text: async () => 'mocked',
    } as Response

    const impl = vi.fn().mockResolvedValue(mockResponse)
    const transport = createKiroTransport({ impl })

    const result = await transport.fetch('https://example.com/test', { method: 'GET' })

    expect(impl).toHaveBeenCalledOnce()
    expect(impl).toHaveBeenCalledWith('https://example.com/test', { method: 'GET' })
    expect(result).toBe(mockResponse)
  })

  it('注入 mock 可完整替换底层 undici（mock 友好）', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const impl = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true }),
      } as Response
    })

    const transport = createKiroTransport({ impl })
    await transport.fetch('https://q.us-east-1.amazonaws.com/getUsageLimits', {
      method: 'GET',
      headers: { Authorization: 'Bearer tok' },
    })

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain('q.us-east-1.amazonaws.com')
    expect((calls[0].init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok')
  })

  it('注入异步抛错的 impl，transport.fetch 透传错误', async () => {
    const impl = vi.fn().mockRejectedValue(new Error('network failure'))
    const transport = createKiroTransport({ impl })

    await expect(transport.fetch('https://example.com', { method: 'GET' })).rejects.toThrow('network failure')
  })
})

// ---- sidecar 可插拔验证 ----

describe('createKiroTransport — sidecar 扩展点', () => {
  it('不同 impl 注入产生完全独立的 transport 实例', async () => {
    const implA = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => 'A' } as Response)
    const implB = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => 'B' } as Response)

    const transportA = createKiroTransport({ impl: implA })
    const transportB = createKiroTransport({ impl: implB })

    await transportA.fetch('https://example.com', { method: 'GET' })
    await transportB.fetch('https://example.com', { method: 'GET' })

    expect(implA).toHaveBeenCalledOnce()
    expect(implB).toHaveBeenCalledOnce()
  })
})
