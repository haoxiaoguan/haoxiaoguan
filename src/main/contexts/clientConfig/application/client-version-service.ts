import { CLIENT_IDS, type ClientId } from '../domain/client-profile'
import type { ClientVersionInfo, ClientInstallationReport } from '../domain/client-version'
import { UPGRADE_COMMAND, INSTALL_COMMAND } from '../domain/client-version'
import { compareSemver } from '../domain/semver'
import { probeInstalledVersion } from '../infrastructure/cli-version-probe'
import { fetchLatestVersion } from '../infrastructure/latest-version-fetcher'
import { runUpgrade, runInstall, type UpgradeResult } from '../infrastructure/cli-upgrade-runner'
import { enumerateInstallations, isConflicting } from '../infrastructure/client-install-scan'

/** 一键升级结果 + 升级后重新探测到的该客户端版本信息（供 UI 即时刷新徽章）。 */
export interface ClientUpgradeOutcome extends UpgradeResult {
  version: ClientVersionInfo
}

// 客户端版本/可升级编排：跑 CLI `--version` 拿已装版本 + 查远程拿最新版 + semver 比对。
// 探测较慢（6× spawn shell + 6× HTTP），故带 TTL 缓存 + 单飞，避免每次进页面/两个页面
// 重复探测；clients() 列表仍走文件检测保持秒开，版本由前端异步补。

const TTL_MS = 10 * 60 * 1000

export class ClientVersionService {
  private cache: { at: number; data: ClientVersionInfo[] } | null = null
  private inflight: Promise<ClientVersionInfo[]> | null = null

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** 全部客户端的版本信息。force=true 跳过缓存（手动刷新用）。 */
  async getVersions(force = false): Promise<ClientVersionInfo[]> {
    if (!force && this.cache !== null && this.now() - this.cache.at < TTL_MS) {
      return this.cache.data
    }
    if (this.inflight !== null) return this.inflight
    this.inflight = this.probeAll()
      .then((data) => {
        this.cache = { at: this.now(), data }
        return data
      })
      .finally(() => {
        this.inflight = null
      })
    return this.inflight
  }

  /** 一键升级某客户端，完成后重新探测其版本并更新缓存对应项，返回结果 + 新版本信息。 */
  async upgrade(clientId: ClientId): Promise<ClientUpgradeOutcome> {
    const result = await runUpgrade(clientId)
    const version = await this.refreshOne(clientId)
    return { ...result, version }
  }

  /** 一键安装某客户端（未安装时），完成后重新探测其版本并更新缓存对应项。 */
  async install(clientId: ClientId): Promise<ClientUpgradeOutcome> {
    const result = await runInstall(clientId)
    const version = await this.refreshOne(clientId)
    return { ...result, version }
  }

  /** 多处安装冲突诊断：枚举各客户端 CLI 的所有安装并判定冲突（按需触发，不缓存）。 */
  async diagnose(clientIds?: ClientId[]): Promise<ClientInstallationReport[]> {
    const ids = clientIds !== undefined && clientIds.length > 0 ? clientIds : CLIENT_IDS
    return Promise.all(
      ids.map(async (clientId) => {
        const installs = await enumerateInstallations(clientId)
        return { clientId, installs, isConflict: isConflicting(installs) }
      }),
    )
  }

  /** 重新探测单个客户端版本，并就地更新缓存（若缓存存在）。 */
  private async refreshOne(clientId: ClientId): Promise<ClientVersionInfo> {
    const version = await this.probeOne(clientId)
    if (this.cache !== null) {
      this.cache.data = this.cache.data.map((v) => (v.clientId === clientId ? version : v))
    }
    return version
  }

  private async probeAll(): Promise<ClientVersionInfo[]> {
    return Promise.all(CLIENT_IDS.map((id) => this.probeOne(id)))
  }

  private async probeOne(clientId: ClientId): Promise<ClientVersionInfo> {
    const probe = await probeInstalledVersion(clientId)
    const installedVersion = probe.version
    let latestVersion: string | undefined
    try {
      latestVersion = await fetchLatestVersion(clientId, installedVersion)
    } catch {
      latestVersion = undefined
    }
    const upgradable =
      installedVersion !== undefined &&
      latestVersion !== undefined &&
      compareSemver(installedVersion, latestVersion) === -1
    return {
      clientId,
      installedVersion,
      latestVersion,
      upgradable,
      upgradeCommand: upgradable ? UPGRADE_COMMAND[clientId] : undefined,
      // 未安装（探不到版本且非「装了跑不起来」）→ 给手动安装命令。
      installCommand: installedVersion === undefined && !probe.broken ? INSTALL_COMMAND[clientId] : undefined,
      installedButBroken: probe.broken,
    }
  }
}
