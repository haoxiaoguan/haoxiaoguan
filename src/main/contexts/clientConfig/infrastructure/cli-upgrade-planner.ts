import { CLI_COMMAND, HERMES_UPDATE_COMMAND, LATEST_SOURCE, type CliClientId } from '../domain/client-version'

// 升级命令规划（对称移植 cc-switch installs_anchored_command + anchored_command_from_paths）：
// 纯函数，不碰 FS / 不 spawn——真身路径与来源由调用方（cli-upgrade-runner）从枚举结果给出，
// 便于单测覆盖各包管理器分支。
//
// 核心不变量：锚定命令必须用「绝对路径」调用执行体，不依赖 PATH。升级最终在登录 shell 里跑，
// 但 PATH 默认那处可能是 bun/volta/nvm 等用户级目录，裸 `npm`/`brew` 会落到 PATH 第一个而非
// 「命令行实际命中那处」对应的包管理器——表现为「升级了但版本没变」（升级写入 A 处、PATH 用 B 处）。
//
// 与旧逻辑（静态 `claude update || npm i -g`）的关键差异：
//   1. 锚定到 PATH 默认安装的「来源」（bun→bun add / volta→volta install / brew formula→brew upgrade
//      / nvm·mise·homebrew-npm→那处 sibling npm），写回同一处。
//   2. codex 刻意不走「官方 self-update 优先」：`codex update` 在 npm 安装上是裸 reinstall，平台二进制
//      漏装时仍 exit 0 假成功、短路掉 npm 兜底（用户报的 “Missing optional dependency” 即源于此）。
//      codex 一律走 npm 锚定；真正损坏（runnable=false）时改用 uninstall+install 自愈。
//   3. claude 同理不走「官方 self-update 优先」——除非真身是原生安装器。`claude update` 是原生安装器的
//      自更新机制；对 npm/bun 等包管理器装的 claude，在非 TTY（GUI 静默执行）下会 exit 0 但不更新该处
//      的 npm 包（要么 no-op、要么把原生版下到别处），从而短路掉包管理器兜底 → 「升级了但版本没变」。
//      故包管理器装的 claude 一律走包管理器锚定；仅原生安装（~/.local/share/claude/ 或 /claude/versions/）
//      用 `claude update`（见 anchoredCommandFromPaths 顶部）。

/** PATH 默认命中那处安装的最小描述（由 cli-upgrade-runner 从枚举结果提供）。 */
export interface UpgradeTarget {
  /** PATH 命中的入口路径（绝对，未解析软链）。 */
  path: string
  /** canonicalize 后的真身路径。 */
  real: string
  /** 安装来源（inferInstallSource 推断：nvm/homebrew/volta/bun/mise/fnm/pnpm/pip/npm/unknown）。 */
  source: string
  /** `--version` 是否 exit 0（装了且当前环境能跑）。false 触发 codex 自愈分支。 */
  runnable: boolean
}

export interface UpgradePlan {
  /** 最终在 shell 里执行的升级命令。 */
  command: string
  /** 是否锚定到具体安装（false=回退到静态命令，未能定位 PATH 默认那处）。 */
  anchored: boolean
}

/** clientId → npm 包名（hermes 是 PyPI，无 npm 包，返回 undefined）。 */
function npmPackageFor(clientId: CliClientId): string | undefined {
  const src = LATEST_SOURCE[clientId]
  return src.kind === 'npm' ? src.pkg : undefined
}

/** 官方自升级子命令参数；无官方自升级的工具（gemini_cli）返回 undefined。 */
function officialUpdateArgs(clientId: CliClientId): string | undefined {
  switch (clientId) {
    case 'claude':
    case 'codex':
    case 'hermes':
      return 'update'
    case 'openclaw':
      return 'update --yes'
    case 'opencode':
      return 'upgrade'
    default:
      return undefined
  }
}

/**
 * 哪些工具「官方 self-update」优先于包管理器（生成 `<tool> update || <pkg-mgr>`）。
 * codex、claude 刻意不在此列（见文件头说明）；hermes 单独在 anchoredCommandFromPaths 处理。
 * claude 仅在「原生安装器」那一处用 `claude update`（anchoredCommandFromPaths 顶部单独处理），
 * 包管理器装的 claude 一律走包管理器锚定，避免 self-update 在 npm 安装 + 非 TTY 下假成功短路兜底。
 */
function prefersOfficialUpdate(clientId: CliClientId): boolean {
  return clientId === 'opencode' || clientId === 'openclaw'
}

/** 含空格才用 POSIX 单引号包一层，否则保持裸路径（命令展示更干净）。 */
function quotePathIfSpaced(p: string): string {
  return p.includes(' ') ? `'${p.replace(/'/g, "'\\''")}'` : p
}

/** `<bin_path 同目录>/<exe>` 绝对路径；bin_path 不含目录分隔符时返回 undefined。 */
function siblingBin(binPath: string, exe: string): string | undefined {
  const i = binPath.lastIndexOf('/')
  if (i <= 0) return undefined
  return `${binPath.slice(0, i)}/${exe}`
}

/** `<path 父目录>`；无父目录返回 undefined。 */
function parentDir(path: string): string | undefined {
  const i = path.lastIndexOf('/')
  return i <= 0 ? undefined : path.slice(0, i)
}

/** Node 安装 prefix：`<node-prefix>/bin/<tool>` → `<node-prefix>`。 */
function nodePrefixFromBinPath(binPath: string): string | undefined {
  const binDir = parentDir(binPath)
  return binDir === undefined ? undefined : parentDir(binDir)
}

/** npm 全局包真身路径：`<node-prefix>/lib/node_modules/<pkg>/...` → `<node-prefix>`。 */
function nodePrefixFromPackageRealPath(real: string): string | undefined {
  const needle = '/lib/node_modules/'
  const i = real.indexOf(needle)
  return i > 0 ? real.slice(0, i) : undefined
}

function isShimLikeBinPath(binPath: string): boolean {
  const lower = binPath.toLowerCase()
  return lower.includes('/mise/shims/') || lower.includes('/fnm_multishells/')
}

function npmAnchorFromPaths(binPath: string, real: string): { npm: string; prefix: string } | undefined {
  if (isShimLikeBinPath(binPath)) {
    const realPrefix = nodePrefixFromPackageRealPath(real)
    return realPrefix === undefined ? undefined : { npm: `${realPrefix}/bin/npm`, prefix: realPrefix }
  }
  const npm = siblingBin(binPath, 'npm')
  const prefix = nodePrefixFromBinPath(binPath)
  return npm === undefined || prefix === undefined ? undefined : { npm, prefix }
}

/**
 * 从 canonicalize 后的真身路径提取 Homebrew formula 名：
 * `/opt/homebrew/Cellar/gemini-cli/0.13.0/...` → `gemini-cli`。
 * 非 Cellar 路径（如 Homebrew node 装的 npm 全局包，落在 `lib/node_modules`）返回 undefined。
 */
export function brewFormulaFromPath(real: string): string | undefined {
  const segs = real.split('/')
  for (let i = 0; i < segs.length - 1; i++) {
    if (segs[i].toLowerCase() === 'cellar') {
      const formula = segs[i + 1]
      return formula.length > 0 ? formula : undefined
    }
  }
  return undefined
}

/** `<bin_path 绝对> <update args>`；无官方自升级返回 undefined。 */
function anchoredOfficialUpdate(clientId: CliClientId, binPath: string): string | undefined {
  const args = officialUpdateArgs(clientId)
  return args === undefined ? undefined : `${quotePathIfSpaced(binPath)} ${args}`
}

/**
 * 按 PATH 默认那处的「来源」锚定到对应包管理器的升级命令（绝对路径调用）。
 * brew formula → 同目录 brew upgrade <formula>；volta/bun → 同目录 volta install / bun add -g；
 * nvm/fnm/mise/homebrew(非 formula)/npm → 同目录 npm i -g。其余（pip/pnpm/unknown）→ undefined。
 */
function packageManagerAnchored(
  clientId: CliClientId,
  binPath: string,
  real: string,
  source: string,
): string | undefined {
  const formula = brewFormulaFromPath(real)
  if (formula !== undefined) {
    const brew = siblingBin(binPath, 'brew')
    return brew === undefined ? undefined : `${quotePathIfSpaced(brew)} upgrade ${formula}`
  }
  const pkg = npmPackageFor(clientId)
  if (pkg === undefined) return undefined

  if (source === 'volta') {
    const volta = siblingBin(binPath, 'volta')
    return volta === undefined ? undefined : `${quotePathIfSpaced(volta)} install ${pkg}`
  }
  if (source === 'bun') {
    const bun = siblingBin(binPath, 'bun')
    return bun === undefined ? undefined : `${quotePathIfSpaced(bun)} add -g ${pkg}@latest`
  }
  // 自带同级 npm 的来源（含 haoxiaoguan inferInstallSource 的 'npm'：node_modules 路径）。
  if (source === 'nvm' || source === 'fnm' || source === 'mise' || source === 'homebrew' || source === 'npm') {
    const anchor = npmAnchorFromPaths(binPath, real)
    return anchor === undefined
      ? undefined
      : `${quotePathIfSpaced(anchor.npm)} i -g --prefix ${quotePathIfSpaced(anchor.prefix)} ${pkg}@latest`
  }
  // pip / pnpm / unknown：无可靠 sibling npm，交回静态兜底。
  return undefined
}

/**
 * Codex 平台分发包损坏自愈：主包在但平台二进制 optional 依赖缺失时 codex 跑不起来
 * （runnable=false），此时 `npm i -g @latest` 是 no-op 修不好——改用 uninstall+install
 * 重装补回平台二进制。仅对会锚定到 sibling npm 的 node 管理器来源生效。
 */
function codexRepairCommand(binPath: string, real: string, source: string): string | undefined {
  if (brewFormulaFromPath(real) !== undefined) return undefined
  if (source !== 'nvm' && source !== 'fnm' && source !== 'mise' && source !== 'homebrew' && source !== 'npm') {
    return undefined
  }
  const anchor = npmAnchorFromPaths(binPath, real)
  if (anchor === undefined) return undefined
  const q = quotePathIfSpaced(anchor.npm)
  const qp = quotePathIfSpaced(anchor.prefix)
  const pkg = '@openai/codex'
  return `${q} uninstall -g --prefix ${qp} ${pkg} || true; ${q} i -g --prefix ${qp} ${pkg}@latest`
}

/**
 * 给定工具与 PATH 默认那处的路径/真身/来源，推断「写回同一处」的锚定升级命令。
 * 判定顺序（命中即返回）：
 *  ① hermes → `<bin> update`（Hermes CLI 自己处理安装环境，避免猜 python3/python 撞版本）。
 *  ② claude 原生安装器（真身在 ~/.local/share/claude/ 或 /claude/versions/）→ `<bin> update`。
 *  ③ brew formula → `<同目录 brew> upgrade <formula>`。
 *  ④ 支持官方自升级的工具（opencode/openclaw）→ `<bin> update || <包管理器锚定命令>`。
 *  ⑤ 其余（gemini_cli/codex/包管理器装的 claude）→ 纯包管理器锚定命令。
 */
function anchoredCommandFromPaths(
  clientId: CliClientId,
  binPath: string,
  real: string,
  source: string,
): string | undefined {
  const realLower = real.toLowerCase()

  if (clientId === 'hermes') {
    return anchoredOfficialUpdate(clientId, binPath)
  }
  if (
    clientId === 'claude' &&
    (realLower.includes('/.local/share/claude/') || realLower.includes('/claude/versions/'))
  ) {
    return anchoredOfficialUpdate(clientId, binPath)
  }

  const packageCommand = packageManagerAnchored(clientId, binPath, real, source)
  if (brewFormulaFromPath(real) !== undefined) {
    return packageCommand
  }
  if (prefersOfficialUpdate(clientId)) {
    const update = anchoredOfficialUpdate(clientId, binPath)
    if (update === undefined) return packageCommand
    return packageCommand === undefined ? update : `${update} || ${packageCommand}`
  }
  return packageCommand
}

/**
 * 静态升级命令（锚定探不到 PATH 默认那处时回退）：等同旧 `<tool> update || npm i -g` 行为。
 * Hermes 例外，按 cc-switch 走 `hermes update || 官方 installer`，不回退系统 pip。
 * codex 不走官方自升级优先（见文件头），故为裸 `npm i -g @openai/codex@latest`。
 */
export function staticUpgradeFallback(clientId: CliClientId): string {
  if (clientId === 'hermes') return HERMES_UPDATE_COMMAND
  const pkg = npmPackageFor(clientId)
  if (pkg === undefined) return `${CLI_COMMAND[clientId]} ${officialUpdateArgs(clientId) ?? 'update'}`
  const npm = `npm i -g ${pkg}@latest`
  if (prefersOfficialUpdate(clientId)) {
    return `${CLI_COMMAND[clientId]} ${officialUpdateArgs(clientId)} || ${npm}`
  }
  return npm
}

/**
 * 规划升级命令。target=PATH 默认那处的安装（undefined=未能定位→静态兜底）。
 * codex 且 runnable=false → 先尝试平台分发包自愈命令。
 */
export function planUpgradeCommand(clientId: CliClientId, target?: UpgradeTarget): UpgradePlan {
  if (target === undefined) {
    return { command: staticUpgradeFallback(clientId), anchored: false }
  }
  if (clientId === 'codex' && !target.runnable) {
    const repair = codexRepairCommand(target.path, target.real, target.source)
    if (repair !== undefined) return { command: repair, anchored: true }
  }
  const anchored = anchoredCommandFromPaths(clientId, target.path, target.real, target.source)
  if (anchored === undefined) {
    return { command: staticUpgradeFallback(clientId), anchored: false }
  }
  return { command: anchored, anchored: true }
}
