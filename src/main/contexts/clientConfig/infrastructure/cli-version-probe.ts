import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { ClientId } from '../domain/client-profile'
import { CLI_COMMAND } from '../domain/client-version'

// 客户端 CLI 版本探测（对称移植 cc-switch try_get_version + scan_cli_version）。
// macOS/Linux：用登录交互 shell 跑 `<cmd> --version` —— GUI 应用 PATH 极简，必须经用户
// shell 载入真实 PATH（nvm/homebrew/…）。PATH 没命中再扫常见安装目录兜底。
// 绝不宽泛杀进程：只 spawn 我们自己起的子进程，超时由 Node 精确杀该子进程。
// Windows：execFile 直跑命令（best-effort），失败即视作未探到，不崩。

const execFileAsync = promisify(execFile)
const VERSION_RE = /\d+\.\d+\.\d+(?:-[\w.]+)?/
const PROBE_TIMEOUT_MS = 8000

export interface VersionProbe {
  /** 解析到的版本号；未安装/未探到为 undefined。 */
  version?: string
  /** 定位到可执行但 `--version` 非零退出（装了跑不起来）。 */
  broken: boolean
}

type Probe =
  | { kind: 'found'; version: string }
  | { kind: 'broken' }
  | { kind: 'notfound' }

function extractVersion(raw: string): string | undefined {
  const m = VERSION_RE.exec(raw)
  return m ? m[0] : undefined
}

function defaultShellFlag(shell: string): string {
  const base = shell.split('/').pop() ?? shell
  if (base === 'dash' || base === 'sh') return '-c'
  if (base === 'fish') return '-lc'
  return '-lic' // zsh/bash：登录+交互，载入 .zprofile/.zshrc，最大化命中 PATH
}

function errField(e: unknown, key: 'code' | 'stdout' | 'stderr'): string | number | undefined {
  if (e !== null && typeof e === 'object' && key in e) {
    return (e as Record<string, unknown>)[key] as string | number | undefined
  }
  return undefined
}

/** 经用户登录 shell 探测。null = 未判定（交给目录扫描兜底）。 */
async function probeViaShell(cmd: string): Promise<Probe> {
  if (process.platform === 'win32') {
    try {
      const { stdout, stderr } = await execFileAsync(cmd, ['--version'], { timeout: PROBE_TIMEOUT_MS, windowsHide: true })
      const v = extractVersion(stdout.trim() || stderr.trim())
      return v ? { kind: 'found', version: v } : { kind: 'notfound' }
    } catch {
      return { kind: 'notfound' }
    }
  }
  const shell = process.env.SHELL && process.env.SHELL.length > 0 ? process.env.SHELL : '/bin/zsh'
  try {
    const { stdout, stderr } = await execFileAsync(shell, [defaultShellFlag(shell), `${cmd} --version`], {
      timeout: PROBE_TIMEOUT_MS,
    })
    const v = extractVersion(stdout.trim() || stderr.trim())
    return v ? { kind: 'found', version: v } : { kind: 'notfound' }
  } catch (e) {
    const code = errField(e, 'code')
    const out = String(errField(e, 'stderr') ?? '').trim() || String(errField(e, 'stdout') ?? '').trim()
    // exit 127 = shell 找不到命令；空输出/超时 → 交给目录扫描兜底。
    if (code === 127 || out === '') return { kind: 'notfound' }
    // 命令存在但 --version 报错退出 → 装了跑不起来。
    const v = extractVersion(out)
    return v ? { kind: 'found', version: v } : { kind: 'broken' }
  }
}

/** 常见安装目录（macOS/Linux），含 bun/mise/nvm 各 node 版本与 hermes 的 PyPI bin。 */
export function searchDirs(clientId: ClientId, home = homedir()): string[] {
  const dirs: string[] = []
  const push = (d: string) => { if (d && !dirs.includes(d) && existsSync(d)) dirs.push(d) }

  push(join(home, '.local/bin'))
  push(join(home, '.npm-global/bin'))
  push(join(home, 'n/bin'))
  push(join(home, '.volta/bin'))
  push(join(home, '.bun/bin'))
  push(join(home, '.local/share/mise/shims'))
  const miseNode = join(home, '.local/share/mise/installs/node')
  if (existsSync(miseNode)) {
    try {
      for (const entry of readdirSync(miseNode)) push(join(miseNode, entry, 'bin'))
    } catch { /* 读不到忽略 */ }
  }
  // nvm：~/.nvm/versions/node/*/bin
  const nvm = join(home, '.nvm/versions/node')
  if (existsSync(nvm)) {
    try {
      for (const entry of readdirSync(nvm)) push(join(nvm, entry, 'bin'))
    } catch { /* 读不到忽略 */ }
  }
  if (process.platform === 'darwin') {
    push('/opt/homebrew/bin')
    push('/usr/local/bin')
    if (clientId === 'hermes') {
      const pyBase = join(home, 'Library', 'Python')
      if (existsSync(pyBase)) {
        try {
          for (const entry of readdirSync(pyBase)) push(join(pyBase, entry, 'bin'))
        } catch { /* 忽略 */ }
      }
    }
  } else if (process.platform === 'linux') {
    push('/usr/local/bin')
    push('/usr/bin')
    if (clientId === 'hermes') push(join(home, '.local/bin'))
  }
  return dirs
}

/** PATH 未命中时，扫常见目录里的真实可执行文件并跑 `--version`。 */
async function scanCommonDirs(clientId: ClientId, cmd: string): Promise<Probe> {
  let broken = false
  for (const dir of searchDirs(clientId)) {
    const exe = join(dir, cmd)
    if (!existsSync(exe)) continue
    try {
      const { stdout, stderr } = await execFileAsync(exe, ['--version'], {
        timeout: PROBE_TIMEOUT_MS,
        env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ''}` },
      })
      const v = extractVersion(stdout.trim() || stderr.trim())
      if (v) return { kind: 'found', version: v }
    } catch (e) {
      const out = String(errField(e, 'stderr') ?? '').trim() || String(errField(e, 'stdout') ?? '').trim()
      const v = extractVersion(out)
      if (v) return { kind: 'found', version: v } // 个别工具把版本打到 stderr 且非零退出
      broken = true // 可执行存在但跑不起来
    }
  }
  return broken ? { kind: 'broken' } : { kind: 'notfound' }
}

/** 探测某客户端 CLI 的已装版本。 */
export async function probeInstalledVersion(clientId: ClientId): Promise<VersionProbe> {
  const cmd = CLI_COMMAND[clientId]
  const viaShell = await probeViaShell(cmd)
  if (viaShell.kind === 'found') return { version: viaShell.version, broken: false }
  if (viaShell.kind === 'broken') return { broken: true }
  // notfound → 目录扫描兜底
  const scanned = await scanCommonDirs(clientId, cmd)
  if (scanned.kind === 'found') return { version: scanned.version, broken: false }
  return { broken: scanned.kind === 'broken' }
}
