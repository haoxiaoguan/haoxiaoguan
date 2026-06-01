import { fetch as undiciFetch, type Dispatcher } from 'undici'
import { type Proxy, type ProxyCheckResult, redactProxyUrl } from '../domain/proxy'
import { classifyProxyError } from '../domain/proxy-error'
import type { ProxyDispatcherFactory } from './proxy-dispatcher-factory'

// ProxyTester — probes a proxy's connectivity by fetching an IP-echo endpoint
// THROUGH the proxy's dispatcher, then reads back the egress IP + latency.
//
// Uses undici's own fetch (NOT the global) because the Dispatcher is an undici
// instance; mixing the two undici copies (ours vs Electron's bundled one) fails
// the `instanceof` dispatcher check. The endpoint is a constant, overridable by
// the caller (settings can pass a self-hosted equivalent).

export const DEFAULT_IP_ECHO_URL = 'https://api.ipify.org?format=json'
const TEST_TIMEOUT_MS = 15_000

export interface ProxyTesterOptions {
  ipEchoUrl?: string
  /** Injectable for tests; defaults to undici's fetch. */
  fetchImpl?: typeof undiciFetch
  now?: () => number
}

export class ProxyTester {
  private readonly ipEchoUrl: string
  private readonly fetchImpl: typeof undiciFetch
  private readonly now: () => number

  constructor(
    private readonly dispatcherFactory: ProxyDispatcherFactory,
    options: ProxyTesterOptions = {},
  ) {
    this.ipEchoUrl = options.ipEchoUrl ?? DEFAULT_IP_ECHO_URL
    this.fetchImpl = options.fetchImpl ?? undiciFetch
    this.now = options.now ?? (() => Date.now())
  }

  /** Probe a single proxy. Never throws — always returns a check result. */
  async test(proxy: Proxy): Promise<ProxyCheckResult> {
    const target = redactProxyUrl(proxy)
    const dispatcher = this.dispatcherFactory.dispatcherFor(proxy)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS)
    const started = this.now()
    try {
      const response = await this.fetchImpl(this.ipEchoUrl, {
        dispatcher: dispatcher as Dispatcher,
        signal: controller.signal,
      })
      const latencyMs = this.now() - started
      if (!response.ok) {
        return {
          status: 'failed',
          latencyMs,
          error: `proxy test HTTP ${response.status}`,
          checkedAt: new Date(this.now()),
        }
      }
      const egressIp = await this.extractIp(response)
      return { status: 'ok', egressIp, latencyMs, checkedAt: new Date(this.now()) }
    } catch (err) {
      const classified = classifyProxyError(err, target)
      return {
        status: 'failed',
        latencyMs: this.now() - started,
        error: classified.message,
        checkedAt: new Date(this.now()),
      }
    } finally {
      clearTimeout(timer)
    }
  }

  private async extractIp(response: { json(): Promise<unknown>; text(): Promise<string> }): Promise<
    string | undefined
  > {
    try {
      const body = (await response.json()) as { ip?: unknown; origin?: unknown }
      if (typeof body.ip === 'string') return body.ip
      if (typeof body.origin === 'string') return body.origin
    } catch {
      // not JSON — fall through
    }
    return undefined
  }
}
