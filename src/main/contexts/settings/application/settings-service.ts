import type { SettingsFileService } from '../infrastructure/settings-file-service'

export interface AppDirs {
  dataDir: string
  configDir: string
  logDir: string
}

export class SettingsApplicationService {
  constructor(private readonly file: SettingsFileService) {}

  getAllSettings(): Record<string, string> {
    return this.file.loadSync().toFlatKv()
  }

  async updateSettings(kv: Record<string, string>): Promise<void> {
    await this.file.mutate((s) => s.applyFlatKv(kv))
  }

  getCloseBehavior(): string {
    return this.file.loadSync().ui.closeBehavior
  }

  getSilentStart(): boolean {
    return this.file.loadSync().runtime.silentStart
  }

  getWsPort(): number {
    return this.file.loadSync().runtime.wsPort
  }

  /** 反代服务是否随应用就绪自启（默认 false）。 */
  getApiProxyEnabled(): boolean {
    return this.file.loadSync().runtime.apiProxyEnabled
  }

  /** 反代服务监听端口（默认 8788）。 */
  getApiProxyPort(): number {
    return this.file.loadSync().runtime.apiProxyPort
  }

  /** 客户端 API Key 列表（明文，M2b 简单版；默认 []）。 */
  getApiProxyClientKeys(): string[] {
    return this.file.loadSync().runtime.apiProxyClientKeys
  }

  /** 本机回环是否免鉴权（默认 true）。 */
  getApiProxyAllowAnonymousLoopback(): boolean {
    return this.file.loadSync().runtime.apiProxyAllowAnonymousLoopback
  }

  getAllowStaleKiroImport(): boolean {
    return this.file.loadSync().runtime.allowStaleKiroImport
  }

  /** Active-account refresh intervals (minutes) keyed by platform. */
  getActiveRefreshIntervals(): Record<string, number> {
    return this.file.loadSync().runtime.refreshIntervals
  }

  /** Whole-platform batch refresh intervals (minutes; 0 = disabled) by platform. */
  getPlatformRefreshIntervals(): Record<string, number> {
    return this.file.loadSync().runtime.platformRefreshIntervals
  }

  /** Max accounts refreshed in parallel during a batch sweep (global, 1–10). */
  getQuotaRefreshConcurrency(): number {
    return this.file.loadSync().runtime.quotaRefreshConcurrency
  }

  /** Configured app/IDE launch path for a platform, or undefined. */
  getIdePath(platform: string): string | undefined {
    return this.file.loadSync().runtime.idePaths[platform]
  }

  // ---- apiProxy 账号池 / 健康跟踪标量（M4）----
  getApiProxySelectionStrategy(): 'sticky-lru' | 'round-robin' {
    return this.file.loadSync().runtime.apiProxySelectionStrategy
  }
  getApiProxyAffinityTtlMs(): number {
    return this.file.loadSync().runtime.apiProxyAffinityTtlMs
  }
  getApiProxyPerAccountConcurrency(): number {
    return this.file.loadSync().runtime.apiProxyPerAccountConcurrency
  }
  getApiProxyMaxRetries(): number {
    return this.file.loadSync().runtime.apiProxyMaxRetries
  }
  getApiProxyRetryDelayMs(): number {
    return this.file.loadSync().runtime.apiProxyRetryDelayMs
  }
  getApiProxyBaseCooldownMs(): number {
    return this.file.loadSync().runtime.apiProxyBaseCooldownMs
  }
  getApiProxyMaxBackoffMultiplier(): number {
    return this.file.loadSync().runtime.apiProxyMaxBackoffMultiplier
  }
  getApiProxyQuotaResetMs(): number {
    return this.file.loadSync().runtime.apiProxyQuotaResetMs
  }
  getApiProxyProbabilisticRetryChance(): number {
    return this.file.loadSync().runtime.apiProxyProbabilisticRetryChance
  }
  getApiProxyHttps(): boolean {
    return this.file.loadSync().runtime.apiProxyHttps
  }

  /** 会话恢复用的终端启动命令模板（空串=未配置）。 */
  getTerminalLaunchTemplate(): string {
    return this.file.loadSync().runtime.terminalLaunchTemplate
  }
}
