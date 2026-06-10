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

  /** Codex「中转注入」(L2 真共存) 是否开启（默认 false）。供 clientConfig 应用 Codex 档时决定注入形态。 */
  getCodexRelayInjectionEnabled(): boolean {
    return this.file.loadSync().runtime.codexRelayInjectionEnabled
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

  /** 自动更新是否启用（默认 true）。 */
  getAutoUpdateEnabled(): boolean {
    return this.file.loadSync().runtime.autoUpdateEnabled
  }

  /** 更新源地址（generic provider；空串=用打包的 app-update.yml 默认）。 */
  getUpdateFeedUrl(): string {
    return this.file.loadSync().runtime.updateFeedUrl
  }

  /** G5 IP 白名单（CIDR，逗号/换行分隔；空=不限制）。 */
  getApiProxyIpAllowlist(): string {
    return this.file.loadSync().runtime.apiProxyIpAllowlist
  }
  /** G5 IP 黑名单（CIDR，逗号/换行分隔；空=不限制）。 */
  getApiProxyIpDenylist(): string {
    return this.file.loadSync().runtime.apiProxyIpDenylist
  }
  /** G6 请求体大小上限（字节；0=不限制）。 */
  getApiProxyMaxBodyBytes(): number {
    return this.file.loadSync().runtime.apiProxyMaxBodyBytes
  }
  /** G7 是否跟随 OS 系统代理出站（默认 false）。 */
  getApiProxyFollowSystemProxy(): boolean {
    return this.file.loadSync().runtime.apiProxyFollowSystemProxy
  }
}
