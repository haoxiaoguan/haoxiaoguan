import type { ClientConfigVersionInfo } from '@shared/api-types';

// 客户端状态徽章的展示模型（客户端接入页 + 会话管理页共用，避免两处文案/配色漂移）。
// 短标签：未安装 / 已安装 / 可升级；版本明细与升级命令放 tooltip（title），保持列表简短。

export interface ClientStatusView {
  label: string;
  /** 圆点 tailwind 背景色类。 */
  dotClass: string;
  /** 悬浮提示：当前/最新版本 + 升级命令（无则不显示）。 */
  title?: string;
}

type T = (key: string, opts?: Record<string, unknown>) => string;

export function clientStatus(
  detected: boolean,
  version: ClientConfigVersionInfo | undefined,
  t: T,
): ClientStatusView {
  const installed = version?.installedVersion;

  // 既没检测到配置、也没探到已装版本 → 未安装。
  if (!detected && installed === undefined) {
    return { label: t('clientConfigPage.notDetected'), dotClass: 'bg-zinc-400' };
  }

  // 可升级：有已装版本且落后 latest。
  if (version?.upgradable === true && version.latestVersion !== undefined) {
    const lines = [
      t('clientConfigPage.versionUpgradable', {
        current: installed ?? '?',
        latest: version.latestVersion,
      }),
    ];
    if (version.upgradeCommand !== undefined) {
      lines.push(t('clientConfigPage.versionUpgradeHint', { command: version.upgradeCommand }));
    }
    return { label: t('clientConfigPage.upgradable'), dotClass: 'bg-amber-500', title: lines.join('\n') };
  }

  // 已安装（已是最新 / 最新版未知 / 仅检测到配置）。
  const title =
    installed !== undefined
      ? version?.latestVersion !== undefined
        ? t('clientConfigPage.versionLatest', { version: installed })
        : t('clientConfigPage.versionInstalled', { version: installed })
      : undefined;
  return { label: t('clientConfigPage.detected'), dotClass: 'bg-emerald-500', title };
}

/** ClientConfigVersionInfo[] → 按 clientId 索引，便于按客户端取版本。 */
export function indexVersions(
  list: ClientConfigVersionInfo[] | undefined,
): Record<string, ClientConfigVersionInfo> {
  const out: Record<string, ClientConfigVersionInfo> = {};
  for (const v of list ?? []) out[v.clientId] = v;
  return out;
}
