// Windows 上的 ChatGPT/Codex 桌面 App 探测（Codex→ChatGPT 改名适配）。
// 官方只有 Microsoft Store(Appx) 一种安装形态，无 %LOCALAPPDATA%\Programs 之类候选。
// 通道1：直接扫 WindowsApps 目录（快路径，零子进程；普通用户常无列目录权限 → 静默落空）。
// 通道2：PowerShell Get-AppxPackage（用户级查询，无需管理员）。
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** 设置面板占位提示（Store 安装路径的形状示例，非真实路径）。 */
export const CODEX_WIN_SUGGESTION = String.raw`C:\Program Files\WindowsApps\OpenAI.ChatGPT_<version>\app\ChatGPT.exe`

// 包目录名前缀 → 优先级：ChatGPT 系(新名) > Codex(旧名)。
const STORE_PREFIXES = [
  { prefix: 'openai.chatgpt_', priority: 2 },
  { prefix: 'openai.chatgpt-desktop_', priority: 2 },
  { prefix: 'openai.codex_', priority: 1 },
] as const

export interface CodexStoreDirInfo {
  priority: number
  version: number[]
}

/** 解析 Store 包目录名（如 OpenAI.ChatGPT_2.0.0.0_x64__8wekyb3d8bbwe）；非官方包/坏版本 → null。 */
export function parseCodexStoreDirName(dirName: string): CodexStoreDirInfo | null {
  const lower = dirName.toLowerCase()
  for (const { prefix, priority } of STORE_PREFIXES) {
    if (!lower.startsWith(prefix)) continue
    const versionText = lower.slice(prefix.length).split('_')[0] ?? ''
    if (versionText.length === 0) return null
    const version = versionText.split('.').map((s) => Number(s))
    if (version.some((n) => !Number.isInteger(n) || n < 0)) return null
    return { priority, version }
  }
  return null
}

/** 逐段数值比较版本号，长度不齐按 0 补。>0 表示 a 新于 b。 */
export function compareVersionArrays(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/** 包内主 exe：先新名 ChatGPT.exe 再旧名 Codex.exe。 */
export function findCodexWindowsAppMainExe(
  appDir: string,
  exists: (p: string) => boolean = existsSync,
): string | null {
  for (const exe of ['ChatGPT.exe', 'Codex.exe']) {
    const candidate = join(appDir, exe)
    if (exists(candidate)) return candidate
  }
  return null
}

/** 各固定盘的 WindowsApps 根：系统盘在 Program Files 下，其它盘在盘根（对照 cockpit）。 */
export function windowsAppsRoots(exists: (p: string) => boolean = existsSync): string[] {
  // 系统盘符从 SystemDrive 环境变量推导（如 'D:'），缺失时回退 C。
  const systemLetter = (process.env.SystemDrive ?? 'C').charAt(0).toUpperCase() || 'C'
  const roots: string[] = []
  for (let code = 65; code <= 90; code++) {
    const letter = String.fromCharCode(code)
    const root =
      letter === systemLetter ? `${letter}:\\Program Files\\WindowsApps` : `${letter}:\\WindowsApps`
    if (exists(root)) roots.push(root)
  }
  return roots
}

// ChatGPT 系优先、同优先级版本降序取第一，输出 InstallLocation（可能为空）。
const GET_APPX_SCRIPT = [
  "$names = @('OpenAI.ChatGPT', 'OpenAI.ChatGPT-Desktop', 'OpenAI.Codex')",
  '$pkg = $names |',
  '  ForEach-Object { Get-AppxPackage -Name $_ -ErrorAction SilentlyContinue } |',
  "  Sort-Object @{ Expression = { if ($_.Name -like 'OpenAI.ChatGPT*') { 0 } else { 1 } } }, @{ Expression = { [version]$_.Version }; Descending = $true } |",
  '  Select-Object -First 1',
  'if ($pkg) { Write-Output $pkg.InstallLocation }',
].join('\n')

export interface CodexWinDetectDeps {
  exists?: (p: string) => boolean
  readDir?: (p: string) => string[]
  runPowershell?: (script: string) => Promise<string>
}

async function defaultRunPowershell(script: string): Promise<string> {
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { windowsHide: true },
  )
  return stdout
}

/** 探测 Windows 上的 ChatGPT/Codex 主 exe；任何失败静默返回 null，绝不抛错。 */
export async function detectCodexAppOnWindows(deps: CodexWinDetectDeps = {}): Promise<string | null> {
  const exists = deps.exists ?? existsSync
  const readDir = deps.readDir ?? ((p: string) => readdirSync(p))
  const runPowershell = deps.runPowershell ?? defaultRunPowershell

  // 通道1：WindowsApps 目录扫描。ACL 拒绝读目录 → 跳过该根。
  let best: { info: CodexStoreDirInfo; exe: string } | null = null
  for (const root of windowsAppsRoots(exists)) {
    let entries: string[]
    try {
      entries = readDir(root)
    } catch {
      continue
    }
    for (const name of entries) {
      const info = parseCodexStoreDirName(name)
      if (info === null) continue
      // exe 缺失的包不参与比较（对照 cockpit：先取到 exe 才算候选）。
      const exe = findCodexWindowsAppMainExe(join(root, name, 'app'), exists)
      if (exe === null) continue
      const better =
        best === null ||
        info.priority > best.info.priority ||
        (info.priority === best.info.priority && compareVersionArrays(info.version, best.info.version) > 0)
      if (better) best = { info, exe }
    }
  }
  if (best !== null) return best.exe

  // 通道2：Get-AppxPackage 回退。
  try {
    const stdout = await runPowershell(GET_APPX_SCRIPT)
    const installLocation = (stdout.split(/\r?\n/)[0] ?? '').trim()
    if (installLocation.length === 0) return null
    return findCodexWindowsAppMainExe(join(installLocation, 'app'), exists)
  } catch {
    return null
  }
}
