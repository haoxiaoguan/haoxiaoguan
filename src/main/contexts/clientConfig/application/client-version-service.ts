import { CLIENT_IDS, type ClientId } from '../domain/client-profile'
import type { ClientVersionInfo, ClientInstallationReport, ClientUpgradePlan } from '../domain/client-version'
import { UPGRADE_COMMAND, INSTALL_COMMAND } from '../domain/client-version'
import { compareSemver } from '../domain/semver'
import { probeInstalledVersion } from '../infrastructure/cli-version-probe'
import { fetchLatestVersion } from '../infrastructure/latest-version-fetcher'
import { runUpgrade, runInstall, type UpgradeResult } from '../infrastructure/cli-upgrade-runner'
import { enumerateInstallations, enumerateInstallationsRaw, isConflicting } from '../infrastructure/client-install-scan'
import { planUpgradeCommand } from '../infrastructure/cli-upgrade-planner'

/** 一键升级结果 + 升级后重新探测到的该客户端版本信息（供 UI 即时刷新徽章）。 */
export interface ClientUpgradeOutcome extends UpgradeResult {
  version: ClientVersionInfo
}

/**
 * 升级后校验：命令自称成功（ok=true）时，用重新探测的版本判断是否「真的升上去了」。
 * 命令本就失败则原样返回（detail 已是命令输出）。
 *  - 升级后探不到版本 / 装了跑不起来 → 失败（如 bun 装阻断 postinstall 致平台二进制缺失）。
 *  - 仍可升级（installed < latest，没到最新）→ 失败：典型为多处安装，升级作用到了别处。
 *  - latest 未知（离线/拉取超时）但升级前后版本毫无变化 → 失败：命令多半「假成功」（exit 0 却没真
 *    升，如 npm 安装的 claude 在非 TTY 下跑 self-update 是 no-op）。此时退出码不可信，靠版本是否
 *    变化兜底，否则会出现「显示升级成功但版本原地不动」。
 *  - 否则视为成功。
 * beforeVersion=升级前已装版本（由 upgrade() 传入，取自缓存/探测），用于「版本是否变化」判定。
 */
export function verifyUpgrade(
  result: UpgradeResult,
  version: ClientVersionInfo,
  beforeVersion?: string,
): UpgradeResult {
  if (!result.ok) return result
  if (version.installedButBroken) {
    return { ok: false, detail: '升级命令已执行，但客户端当前无法运行（可能平台二进制缺失或 Node 版本不满足）。' }
  }
  if (version.installedVersion === undefined) {
    return { ok: false, detail: '升级命令已执行，但升级后探测不到已安装版本。' }
  }
  if (version.latestVersion !== undefined && version.upgradable) {
    return {
      ok: false,
      detail: `升级命令已执行，但 PATH 默认仍是 v${version.installedVersion}（最新 v${version.latestVersion}）。可能存在多处安装，请用「诊断安装冲突」查看。`,
    }
  }
  // latest 已知时走到这里 = 已是最新（!upgradable），版本没变属正常。仅 latest 未知时，用「升级前后
  // 版本是否变化」兜底假成功——这是「显示成功但版本没变」的最后一道防线。
  if (
    version.latestVersion === undefined &&
    beforeVersion !== undefined &&
    version.installedVersion === beforeVersion
  ) {
    return {
      ok: false,
      detail: `升级命令已执行，但版本仍为 v${version.installedVersion}，未发生变化，升级可能未生效。多处安装时升级常作用到别处，请用「诊断安装冲突」查看。`,
    }
  }
  return { ok: true }
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

  /**
   * 升级前规划（对称移植 cc-switch probe_tool_installations 的确认路径）：枚举所有安装、定位
   * PATH 默认那处、生成锚定升级命令，并据「≥2 处安装」给出 needsConfirmation。供 UI 在升级前
   * 弹窗展示「升级只动哪一处 / 各处版本 / 将执行的命令」，让用户知情后确认。只读、无副作用。
   */
  async planUpgrade(clientId: ClientId): Promise<ClientUpgradePlan> {
    const raw = await enumerateInstallationsRaw(clientId)
    const def = raw.find((i) => i.isPathDefault) ?? (raw.length === 1 ? raw[0] : undefined)
    const target =
      def === undefined ? undefined : { path: def.path, real: def.real, source: def.source, runnable: def.runnable }
    const { command, anchored } = planUpgradeCommand(clientId, target)
    const installs = raw.map(({ real: _real, ...rest }) => rest)
    return { clientId, command, anchored, needsConfirmation: raw.length >= 2, installs }
  }

  /**
   * 一键升级某客户端，完成后重新探测其版本并更新缓存对应项，返回结果 + 新版本信息。
   * 关键：升级命令可能「假成功」（exit 0 但 PATH 默认那处版本没变，如官方 self-update 更新了
   * 另一处安装、或平台二进制漏装）。这里据重新探测的版本做校验——版本未真正前进/损坏 → 回报失败，
   * 不再把假成功当成功（即用户报的「显示升级成功但实际不成功」）。
   */
  async upgrade(clientId: ClientId): Promise<ClientUpgradeOutcome> {
    const before = await this.installedVersionFor(clientId)
    const result = await runUpgrade(clientId)
    const version = await this.refreshOne(clientId)
    return { ...verifyUpgrade(result, version, before), version }
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

  /** 升级前已装版本：优先用缓存（即用户在页面看到、点升级前的那个值），无缓存再探测一次。 */
  private async installedVersionFor(clientId: ClientId): Promise<string | undefined> {
    const cached = this.cache?.data.find((v) => v.clientId === clientId)?.installedVersion
    if (cached !== undefined) return cached
    return (await probeInstalledVersion(clientId)).version
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
