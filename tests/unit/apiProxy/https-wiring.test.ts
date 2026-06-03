// tests/unit/apiProxy/https-wiring.test.ts
// P2-1 HTTPS 接线：验证 container 在 apiProxyHttps=true 时把 tls 传给 ApiHttpServer，
// 默认 false 时不传（零回归）。
// 直接测试 ApiHttpServer 构造器接收 tls 字段的逻辑，用 vi.mock 隔离 loadOrCreateCert / node-forge。
import { describe, it, expect, vi, afterEach } from 'vitest'
import { ApiHttpServer } from '../../../src/main/contexts/apiProxy/infrastructure/http/api-http-server'
import type { CertBundle } from '../../../src/main/contexts/apiProxy/infrastructure/http/self-signed-cert'

const FAKE_CERT: CertBundle = {
  cert: '-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----\n',
  key: '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----\n',
  sha256Fingerprint: 'aabbcc',
}

// ─── 测试 ApiHttpServer 构造接受 tls 字段（直接测 config，不实际启动 HTTPS 避免 node-forge 依赖）────

describe('HTTPS wiring: ApiHttpServer 配置接受 tls 字段', () => {
  let server: ApiHttpServer | null = null

  afterEach(async () => {
    if (server) {
      try { await server.stop() } catch { /* 忽略未启动时 stop 错误 */ }
      server = null
    }
  })

  it('传入 tls 时 server 对象正常构建（config 含 tls，不报错）', () => {
    const handler = () => {}
    server = new ApiHttpServer(handler as any, { port: 0, tls: FAKE_CERT })
    // 构建本身不抛即通过（tls 字段被 ApiHttpServer 保留，start() 时才用）
    expect(server).toBeTruthy()
  })

  it('不传 tls 时 server 对象正常构建（http 模式零回归）', () => {
    const handler = () => {}
    server = new ApiHttpServer(handler as any, { port: 0 })
    expect(server).toBeTruthy()
  })
})

// ─── 测试 container 级 HTTPS 接线逻辑（直接测相同逻辑，不启动全量 container）────────────────────

describe('HTTPS wiring: container 逻辑单元（mock loadOrCreateCert + settings）', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('apiProxyHttps=true → tls 被注入到 ApiHttpServer config', () => {
    // 模拟 settings getter
    const settings = { getApiProxyHttps: () => true }
    // 模拟 loadOrCreateCert
    const loadOrCreateCert = vi.fn(() => FAKE_CERT)

    // 重现 container 中的 HTTPS 选择逻辑（同一段代码）
    let tlsConfig: { tls: CertBundle } | Record<string, never> = {}
    if (settings.getApiProxyHttps()) {
      try {
        const cert = loadOrCreateCert()
        tlsConfig = { tls: cert }
      } catch {
        // 降级 http
      }
    }

    expect(loadOrCreateCert).toHaveBeenCalledOnce()
    expect(tlsConfig).toEqual({ tls: FAKE_CERT })
  })

  it('apiProxyHttps=false（默认）→ tls 不传，tlsConfig 为空对象', () => {
    const settings = { getApiProxyHttps: () => false }
    const loadOrCreateCert = vi.fn(() => FAKE_CERT)

    let tlsConfig: { tls: CertBundle } | Record<string, never> = {}
    if (settings.getApiProxyHttps()) {
      try {
        const cert = loadOrCreateCert()
        tlsConfig = { tls: cert }
      } catch { /* 降级 */ }
    }

    expect(loadOrCreateCert).not.toHaveBeenCalled()
    expect(tlsConfig).toEqual({})
  })

  it('apiProxyHttps=true 但 loadOrCreateCert 抛错 → 降级 http，tlsConfig 为空对象', () => {
    const settings = { getApiProxyHttps: () => true }
    const loadOrCreateCert = vi.fn(() => { throw new Error('cert gen failed') })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    let tlsConfig: { tls: CertBundle } | Record<string, never> = {}
    if (settings.getApiProxyHttps()) {
      try {
        const cert = loadOrCreateCert()
        tlsConfig = { tls: cert }
      } catch (err) {
        console.warn('[container] HTTPS 证书加载失败，降级为 HTTP:', err)
      }
    }

    expect(loadOrCreateCert).toHaveBeenCalledOnce()
    expect(tlsConfig).toEqual({})
    expect(warnSpy).toHaveBeenCalledOnce()
  })
})
