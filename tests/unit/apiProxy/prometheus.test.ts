import { describe, it, expect } from 'vitest'
import { renderPrometheus } from '../../../src/main/contexts/apiProxy/domain/observability/prometheus'

const base = {
  counters: {
    requestsTotal: 42,
    successTotal: 40,
    failedTotal: 2,
    inputTokensTotal: 1234,
    outputTokensTotal: 567,
    startedAtMs: 0,
  },
  uptimeSeconds: 3600,
  inflight: 3,
  accountStates: { available: 5, cooldown: 1, quota_exhausted: 2, suspended: 1 },
}

describe('renderPrometheus', () => {
  it('输出 0.0.4 文本，每指标带 HELP/TYPE，末尾换行', () => {
    const out = renderPrometheus(base)
    expect(out.endsWith('\n')).toBe(true)
    expect(out).toContain('# HELP apiproxy_requests_total Total proxied requests.')
    expect(out).toContain('# TYPE apiproxy_requests_total counter')
    expect(out).toContain('apiproxy_requests_total 42')
    expect(out).toContain('apiproxy_requests_success_total 40')
    expect(out).toContain('apiproxy_requests_failed_total 2')
    expect(out).toContain('apiproxy_tokens_input_total 1234')
    expect(out).toContain('apiproxy_tokens_output_total 567')
  })

  it('账号数按运行态打 state 标签（gauge）', () => {
    const out = renderPrometheus(base)
    expect(out).toContain('# TYPE apiproxy_accounts gauge')
    expect(out).toContain('apiproxy_accounts{state="available"} 5')
    expect(out).toContain('apiproxy_accounts{state="cooldown"} 1')
    expect(out).toContain('apiproxy_accounts{state="quota_exhausted"} 2')
    expect(out).toContain('apiproxy_accounts{state="suspended"} 1')
  })

  it('inflight 与 uptime gauge', () => {
    const out = renderPrometheus(base)
    expect(out).toContain('# TYPE apiproxy_inflight_requests gauge')
    expect(out).toContain('apiproxy_inflight_requests 3')
    expect(out).toContain('# TYPE apiproxy_uptime_seconds gauge')
    expect(out).toContain('apiproxy_uptime_seconds 3600')
  })

  it('零值与空账号池也合法输出', () => {
    const out = renderPrometheus({
      counters: { requestsTotal: 0, successTotal: 0, failedTotal: 0, inputTokensTotal: 0, outputTokensTotal: 0, startedAtMs: null },
      uptimeSeconds: 0,
      inflight: 0,
      accountStates: { available: 0, cooldown: 0, quota_exhausted: 0, suspended: 0 },
    })
    expect(out).toContain('apiproxy_requests_total 0')
    expect(out).toContain('apiproxy_accounts{state="available"} 0')
    expect(out).toContain('apiproxy_uptime_seconds 0')
  })
})
