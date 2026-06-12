import type { ClientId } from './client-profile'

// 客户端版本/可升级信息（对称移植 cc-switch ToolVersion 的核心字段）。
// 探测=跑 CLI `--version` 拿已装版本 + 查远程拿最新版 + semver 比对得 upgradable。
export interface ClientVersionInfo {
  clientId: ClientId
  /** 已装版本（CLI `--version` 解析所得；未安装/未探到则 undefined）。 */
  installedVersion?: string
  /** 远程最新版（npm/PyPI/GitHub；离线或查不到则 undefined）。 */
  latestVersion?: string
  /** installedVersion < latestVersion。 */
  upgradable: boolean
  /** 升级命令（仅 upgradable 时给出，供 UI tooltip 展示，不自动执行）。 */
  upgradeCommand?: string
  /** 定位到 CLI 但 `--version` 报错退出（装了跑不起来，如 Node 版本不达标）。 */
  installedButBroken: boolean
}

/** clientId → 实际 CLI 命令名（注意 gemini_cli 的命令是 `gemini`）。 */
export const CLI_COMMAND: Record<ClientId, string> = {
  claude: 'claude',
  codex: 'codex',
  gemini_cli: 'gemini',
  opencode: 'opencode',
  openclaw: 'openclaw',
  hermes: 'hermes',
}

/** 最新版来源（与 cc-switch get_single_tool_version_impl 一致）。 */
export type LatestSource =
  | { kind: 'npm'; pkg: string; prereleaseTags?: readonly string[]; githubFallback?: string }
  | { kind: 'pypi'; pkg: string }

export const LATEST_SOURCE: Record<ClientId, LatestSource> = {
  // Claude Code 在本地领先 latest 时补查 `next` 预发布通道（其余工具的预发布 tag 命名
  // 不统一/含脏值，cc-switch 仅为 claude 启用，这里对齐）。
  claude: { kind: 'npm', pkg: '@anthropic-ai/claude-code', prereleaseTags: ['next'] },
  codex: { kind: 'npm', pkg: '@openai/codex' },
  gemini_cli: { kind: 'npm', pkg: '@google/gemini-cli' },
  opencode: { kind: 'npm', pkg: 'opencode-ai', githubFallback: 'anomalyco/opencode' },
  openclaw: { kind: 'npm', pkg: 'openclaw' },
  hermes: { kind: 'pypi', pkg: 'hermes-agent' },
}

/** 升级命令（仅供 UI tooltip 展示，不自动执行）。 */
export const UPGRADE_COMMAND: Record<ClientId, string> = {
  claude: 'npm i -g @anthropic-ai/claude-code@latest',
  codex: 'npm i -g @openai/codex@latest',
  gemini_cli: 'npm i -g @google/gemini-cli@latest',
  opencode: 'npm i -g opencode-ai@latest',
  openclaw: 'npm i -g openclaw@latest',
  hermes: 'pip install -U hermes-agent',
}
