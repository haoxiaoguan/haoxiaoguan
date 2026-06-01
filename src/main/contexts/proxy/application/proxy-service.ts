import { createLimit } from '../../../platform/async/limit'
import {
  proxyDedupeKey,
  redactProxyUrl,
  type Proxy,
  type ProxyCheckResult,
  type AccountProxyBinding,
  type ProxyProtocol,
} from '../domain/proxy'
import { ProxyError } from '../domain/proxy-error'
import { parseProxyLines, type FailedLine } from '../domain/proxy-parser'
import type {
  CreateProxyInput,
  MikroOrmProxyRepository,
  UpdateProxyInput,
} from '../infrastructure/mikro-orm-proxy-repository'

// ProxyService — application layer for the proxy context.
//
// Owns CRUD, the three import flows (manual/paste/file-text), single + batch
// connectivity testing (bounded concurrency via createLimit), binding/group
// management, and delete protection. Every value that leaves this service is a
// DTO with the plaintext password STRIPPED (passwordSet: boolean instead) and a
// redacted displayUrl — the plaintext never crosses the service boundary.

/** A proxy as seen by the renderer — no plaintext password, ever. */
export interface ProxyDto {
  id: string
  label?: string
  protocol: ProxyProtocol
  host: string
  port: number
  username?: string
  passwordSet: boolean
  status: Proxy['status']
  lastEgressIp?: string
  lastLatencyMs?: number
  lastCheckedAt?: string
  lastError?: string
  tags: string[]
  displayUrl: string
  boundAccountCount: number
  createdAt: string
}

export interface AccountBindingDto {
  accountId: string
  proxyId?: string
}

export interface ImportSummary {
  imported: number
  skipped: number
  failed: FailedLine[]
}

export interface ProxyTestResultDto {
  proxyId: string
  status: 'ok' | 'failed'
  egressIp?: string
  latencyMs?: number
  error?: string
  checkedAt: string
}

/** The tester slice ProxyService depends on (real impl = ProxyTester). */
export interface ProxyConnectivityTester {
  test(proxy: Proxy): Promise<ProxyCheckResult>
}

export class ProxyService {
  constructor(
    private readonly repo: MikroOrmProxyRepository,
    private readonly tester: ProxyConnectivityTester,
  ) {}

  // --- CRUD ---

  async createProxy(input: CreateProxyInput): Promise<ProxyDto> {
    this.validateInput(input)
    const proxy = await this.repo.createProxy(input)
    return this.toDto(proxy)
  }

  async getProxy(id: string): Promise<ProxyDto | null> {
    const proxy = await this.repo.getProxy(id)
    return proxy === null ? null : this.toDto(proxy)
  }

  async listProxies(): Promise<ProxyDto[]> {
    const proxies = await this.repo.listProxies()
    return Promise.all(proxies.map((p) => this.toDto(p)))
  }

  async updateProxy(id: string, patch: UpdateProxyInput): Promise<ProxyDto> {
    if (patch.port !== undefined && !isValidPort(patch.port)) {
      throw ProxyError.malformedInput('port')
    }
    const proxy = await this.repo.updateProxy(id, patch)
    return this.toDto(proxy)
  }

  async deleteProxy(id: string): Promise<void> {
    const accountCount = await this.repo.countAccountsForProxy(id)
    if (accountCount > 0) {
      throw ProxyError.inUse(id, accountCount, 0)
    }
    await this.repo.deleteProxy(id)
  }

  // --- import ---

  /** Import from pasted text or a file's contents (same line grammar). */
  async importFromText(text: string): Promise<ImportSummary> {
    const { parsed, failed } = parseProxyLines(text)
    let imported = 0
    let skipped = 0
    for (const line of parsed) {
      const key = proxyDedupeKey(line)
      const existing = await this.repo.findByDedupeKey(key)
      if (existing !== null) {
        skipped++
        continue
      }
      await this.repo.createProxy({
        protocol: line.protocol,
        host: line.host,
        port: line.port,
        username: line.username,
        password: line.password,
        tags: [],
      })
      imported++
    }
    return { imported, skipped, failed }
  }

  // --- connectivity test ---

  async testProxy(id: string): Promise<ProxyTestResultDto> {
    const proxy = await this.repo.getProxy(id)
    if (proxy === null) throw ProxyError.notFound(id)
    const result = await this.tester.test(proxy)
    await this.repo.recordCheck(id, result)
    return {
      proxyId: id,
      status: result.status,
      egressIp: result.egressIp,
      latencyMs: result.latencyMs,
      error: result.error,
      checkedAt: result.checkedAt.toISOString(),
    }
  }

  /** Test many proxies with bounded concurrency. */
  async testProxies(ids: string[], concurrency = 4): Promise<ProxyTestResultDto[]> {
    const limit = createLimit(Math.max(1, concurrency))
    return Promise.all(ids.map((id) => limit(() => this.testProxy(id))))
  }

  // --- bindings ---

  async bindAccountToProxy(accountId: string, proxyId: string): Promise<void> {
    const proxy = await this.repo.getProxy(proxyId)
    if (proxy === null) throw ProxyError.notFound(proxyId)
    await this.repo.bindAccount(accountId, { proxyId })
  }

  async unbindAccount(accountId: string): Promise<void> {
    await this.repo.unbindAccount(accountId)
  }

  async getAccountBinding(accountId: string): Promise<AccountBindingDto | null> {
    const binding = await this.repo.getBinding(accountId)
    return binding === null ? null : this.toBindingDto(binding)
  }

  async listBindings(): Promise<AccountBindingDto[]> {
    const bindings = await this.repo.listBindings()
    return bindings.map((b) => this.toBindingDto(b))
  }

  // --- mapping ---

  private async toDto(proxy: Proxy): Promise<ProxyDto> {
    const boundAccountCount = await this.repo.countAccountsForProxy(proxy.id)
    return {
      id: proxy.id,
      label: proxy.label,
      protocol: proxy.protocol,
      host: proxy.host,
      port: proxy.port,
      username: proxy.username,
      passwordSet: proxy.password !== undefined && proxy.password !== '',
      status: proxy.status,
      lastEgressIp: proxy.lastEgressIp,
      lastLatencyMs: proxy.lastLatencyMs,
      lastCheckedAt: proxy.lastCheckedAt?.toISOString(),
      tags: proxy.tags,
      displayUrl: redactProxyUrl(proxy),
      boundAccountCount,
      createdAt: proxy.createdAt.toISOString(),
    }
  }

  private toBindingDto(b: AccountProxyBinding): AccountBindingDto {
    return { accountId: b.accountId, proxyId: b.proxyId }
  }

  private validateInput(input: CreateProxyInput): void {
    if (input.host.trim() === '') throw ProxyError.malformedInput('host')
    if (!isValidPort(input.port)) throw ProxyError.malformedInput('port')
  }
}

function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535
}
