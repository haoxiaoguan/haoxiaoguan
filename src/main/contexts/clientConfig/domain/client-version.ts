import type { ClientId } from './client-profile'

// 客户端版本/可升级信息（对称移植 cc-switch ToolVersion 的核心字段）。
// 探测=跑 CLI `--version` 拿已装版本 + 查远程拿最新版 + semver 比对得 upgradable。
export interface ClientVersionInfo {
  clientId: ClientId
  /** 已装版本（CLI `--version` 解析所得；未安装/未探到则 undefined）。 */
  installedVersion?: string | undefined
  /** 远程最新版（npm/PyPI/GitHub；离线或查不到则 undefined）。 */
  latestVersion?: string | undefined
  /** installedVersion < latestVersion。 */
  upgradable: boolean
  /** 升级命令（仅 upgradable 时给出，供 UI tooltip 展示，不自动执行）。 */
  upgradeCommand?: string | undefined
  /** 安装命令（仅未安装时给出，供 UI「复制手动安装命令」）。 */
  installCommand?: string | undefined
  /** 定位到 CLI 但 `--version` 报错退出（装了跑不起来，如 Node 版本不达标）。 */
  installedButBroken: boolean
}

/** 某客户端 CLI 在系统中的一处安装（用于「多处安装冲突」诊断）。 */
export interface ClientInstallation {
  /** 候选入口路径（PATH 里实际看到的那个，未解析软链）。 */
  path: string
  /** `--version` 成功解析出的版本号。 */
  version?: string | undefined
  /** `--version` 是否 exit 0（装了且当前环境能跑）。 */
  runnable: boolean
  /** 跑不起来时的诊断末尾若干行。 */
  error?: string | undefined
  /** 由路径前缀推断的安装来源（nvm/homebrew/volta/pip/...）。 */
  source: string
  /** 是否为 PATH 解析到的那处（命令行默认、也是升级作用的目标）。 */
  isPathDefault: boolean
}

/** 一次安装分布诊断结果。 */
export interface ClientInstallationReport {
  clientId: ClientId
  installs: ClientInstallation[]
  /** ≥2 处且（版本分歧或运行态混合）。 */
  isConflict: boolean
}

/**
 * 升级前规划（对称移植 cc-switch probe_tool_installations 的升级确认路径）。
 * 升级只作用于「命令行默认那处」；≥2 处安装时应弹窗让用户知情后再执行。
 */
export interface ClientUpgradePlan {
  clientId: ClientId
  /** 锚定后将执行的升级命令（仅展示；真正执行时后端重新生成，不信任前端回传）。 */
  command: string
  /** 是否成功锚定到具体安装。false=退回静态命令（无法确定 PATH 默认那处）。 */
  anchored: boolean
  /** 是否需要弹窗确认（≥2 处安装：升级只动一处，应让用户知情）。 */
  needsConfirmation: boolean
  /** 枚举到的所有安装（供确认弹窗展示哪处是默认 / 各处版本）。 */
  installs: ClientInstallation[]
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

export const HERMES_INSTALL_COMMAND =
  'bash -c \'tmp=$(mktemp) && curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh -o "$tmp" && bash "$tmp"; status=$?; rm -f "$tmp"; exit $status\''

export const HERMES_UPDATE_COMMAND = `hermes update || ${HERMES_INSTALL_COMMAND}`

/** 升级命令（仅供 UI tooltip 展示，不自动执行）。 */
export const UPGRADE_COMMAND: Record<ClientId, string> = {
  claude: 'npm i -g @anthropic-ai/claude-code@latest',
  codex: 'npm i -g @openai/codex@latest',
  gemini_cli: 'npm i -g @google/gemini-cli@latest',
  opencode: 'npm i -g opencode-ai@latest',
  openclaw: 'npm i -g openclaw@latest',
  hermes: HERMES_UPDATE_COMMAND,
}

/** 安装命令（未安装时用）：多数客户端走包管理器；Hermes 走官方 installer，避免系统 pip/Python 版本陷阱。
 *  同时作为执行命令（runInstall）与「复制手动安装命令」的展示，单一来源避免漂移。 */
export const INSTALL_COMMAND: Record<ClientId, string> = {
  claude: 'npm i -g @anthropic-ai/claude-code@latest',
  codex: 'npm i -g @openai/codex@latest',
  gemini_cli: 'npm i -g @google/gemini-cli@latest',
  opencode: 'npm i -g opencode-ai@latest',
  openclaw: 'npm i -g openclaw@latest',
  hermes: HERMES_INSTALL_COMMAND,
}
