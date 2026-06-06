// Prometheus text exposition format 0.0.4 渲染（G10）——纯函数，无副作用。
// 数据源：G3 计数器 + AccountHealthTracker 运行态汇总 + AccountPoolSelector inflight + uptime。
import type { ProxyMetricsCounters } from './proxy-request-log'

/** 账号运行态计数（与 AccountRuntimeHealth.runtimeState 同名）。 */
export interface AccountStateTally {
  available: number
  cooldown: number
  quota_exhausted: number
  suspended: number
}

export interface PrometheusInput {
  counters: ProxyMetricsCounters
  /** 反代已运行秒数（startedAtMs 为 null 时传 0）。 */
  uptimeSeconds: number
  /** 当前在途请求数（所有账号 inflight 之和）。 */
  inflight: number
  accountStates: AccountStateTally
}

const ACCOUNT_STATES: ReadonlyArray<keyof AccountStateTally> = [
  'available',
  'cooldown',
  'quota_exhausted',
  'suspended',
]

function metric(
  lines: string[],
  name: string,
  type: 'counter' | 'gauge',
  help: string,
  value: number,
): void {
  lines.push(`# HELP ${name} ${help}`)
  lines.push(`# TYPE ${name} ${type}`)
  lines.push(`${name} ${value}`)
}

/**
 * 渲染 Prometheus 文本（0.0.4）。每个指标带 HELP/TYPE 注释行，末尾换行。
 * 指标前缀 apiproxy_。账号数按运行态打 state 标签。
 */
export function renderPrometheus(input: PrometheusInput): string {
  const { counters, uptimeSeconds, inflight, accountStates } = input
  const lines: string[] = []

  metric(lines, 'apiproxy_requests_total', 'counter', 'Total proxied requests.', counters.requestsTotal)
  metric(lines, 'apiproxy_requests_success_total', 'counter', 'Total successful proxied requests.', counters.successTotal)
  metric(lines, 'apiproxy_requests_failed_total', 'counter', 'Total failed proxied requests.', counters.failedTotal)
  metric(lines, 'apiproxy_tokens_input_total', 'counter', 'Total estimated input tokens.', counters.inputTokensTotal)
  metric(lines, 'apiproxy_tokens_output_total', 'counter', 'Total output tokens.', counters.outputTokensTotal)

  // 账号数按运行态（gauge，带 state 标签）。
  lines.push('# HELP apiproxy_accounts Number of accounts by runtime state.')
  lines.push('# TYPE apiproxy_accounts gauge')
  for (const state of ACCOUNT_STATES) {
    lines.push(`apiproxy_accounts{state="${state}"} ${accountStates[state]}`)
  }

  metric(lines, 'apiproxy_inflight_requests', 'gauge', 'In-flight proxied requests across all accounts.', inflight)
  metric(lines, 'apiproxy_uptime_seconds', 'gauge', 'Seconds since the proxy server started.', uptimeSeconds)

  return lines.join('\n') + '\n'
}
