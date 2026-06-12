import { CLIENT_IDS, type ClientId } from '../domain/client-profile'
import type { ClientVersionInfo } from '../domain/client-version'
import { UPGRADE_COMMAND } from '../domain/client-version'
import { compareSemver } from '../domain/semver'
import { probeInstalledVersion } from '../infrastructure/cli-version-probe'
import { fetchLatestVersion } from '../infrastructure/latest-version-fetcher'

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
      installedButBroken: probe.broken,
    }
  }
}
