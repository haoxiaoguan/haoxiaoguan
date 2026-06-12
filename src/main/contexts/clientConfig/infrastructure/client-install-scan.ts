import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import type { ClientId } from '../domain/client-profile'
import type { ClientInstallation } from '../domain/client-version'
import { CLI_COMMAND } from '../domain/client-version'
import { searchDirs } from './cli-version-probe'

// 多处安装扫描（对称移植 cc-switch enumerate_tool_installations + is_conflicting）：
// 枚举常见目录里同名 CLI 的所有真实安装，canonicalize 去重软链，逐处跑 `--version`，
// 推断安装来源（nvm/homebrew/...），标出 PATH 默认那处（命令行实际命中、升级作用目标）。
// 用于「多处安装冲突」诊断——同一 CLI 多处版本分歧/运行态混合常导致「升级了但版本没变」。

const execFileAsync = promisify(execFile)
const SCAN_TIMEOUT_MS = 8000
const VERSION_RE = /\d+\.\d+\.\d+(?:-[\w.]+)?/

function extractVersion(raw: string): string | undefined {
  const m = VERSION_RE.exec(raw)
  return m ? m[0] : undefined
}

function defaultShellFlag(shell: string): string {
  const base = shell.split('/').pop() ?? shell
  if (base === 'dash' || base === 'sh') return '-c'
  if (base === 'fish') return '-lc'
  return '-lic'
}

function lastLines(text: string, n: number): string {
  const lines = text.trim().split('\n')
  return lines.slice(Math.max(0, lines.length - n)).join('\n').trim()
}

/** 由路径前缀推断安装来源（顺序敏感：Homebrew 的 Cellar 真身先于通用规则）。 */
function inferSource(path: string): string {
  const s = path.replace(/\\/g, '/').toLowerCase()
  if (s.includes('/.nvm/')) return 'nvm'
  if (s.includes('/homebrew/') || s.includes('/cellar/')) return 'homebrew'
  if (s.includes('/.volta/') || s.includes('/volta/')) return 'volta'
  if (s.includes('fnm_multishells')) return 'fnm'
  if (s.includes('/mise/')) return 'mise'
  if (s.includes('/.bun/')) return 'bun'
  if (s.includes('/pnpm/')) return 'pnpm'
  if (s.includes('/library/python') || s.includes('/site-packages/')) return 'pip'
  if (s.includes('/.npm-global/') || s.includes('/lib/node_modules/')) return 'npm'
  return 'unknown'
}

function canonical(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

/** PATH 默认命中那处的真身路径（经登录 shell `command -v`），无则 undefined。 */
async function pathDefaultReal(cmd: string): Promise<string | undefined> {
  if (process.platform === 'win32') return undefined
  const shell = process.env.SHELL && process.env.SHELL.length > 0 ? process.env.SHELL : '/bin/zsh'
  try {
    const { stdout } = await execFileAsync(shell, [defaultShellFlag(shell), `command -v ${cmd}`], {
      timeout: SCAN_TIMEOUT_MS,
    })
    const p = stdout.trim().split('\n').pop()?.trim()
    return p && p.length > 0 && existsSync(p) ? canonical(p) : undefined
  } catch {
    return undefined
  }
}

/**
 * 登录 shell 的 PATH 目录列表。GUI 应用 process.env.PATH 极简，不含 nvm/fnm/自定义
 * npm prefix —— 必须经用户 shell 拿完整 PATH，否则枚举只覆盖固定目录、漏掉命令行实际
 * 命中那处（表现为「能探到版本却诊断不出任何安装」）。zsh/bash 的 $PATH 为冒号分隔。
 */
async function loginShellPathDirs(): Promise<string[]> {
  if (process.platform === 'win32') return []
  const shell = process.env.SHELL && process.env.SHELL.length > 0 ? process.env.SHELL : '/bin/zsh'
  try {
    const { stdout } = await execFileAsync(shell, [defaultShellFlag(shell), 'printf %s "$PATH"'], {
      timeout: SCAN_TIMEOUT_MS,
    })
    return stdout.trim().split(':').filter((d) => d.length > 0)
  } catch {
    return []
  }
}

async function probeAt(exe: string, dir: string): Promise<{ version?: string; runnable: boolean; error?: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(exe, ['--version'], {
      timeout: SCAN_TIMEOUT_MS,
      env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ''}` },
    })
    const v = extractVersion(stdout.trim() || stderr.trim())
    return { version: v, runnable: true }
  } catch (e) {
    const rec = (e ?? {}) as Record<string, unknown>
    const out = String(rec.stderr ?? '').trim() || String(rec.stdout ?? '').trim()
    const v = extractVersion(out)
    if (v !== undefined) return { version: v, runnable: true } // 个别工具把版本打到 stderr 且非零退出
    return { runnable: false, error: out.length > 0 ? lastLines(out, 4) : undefined }
  }
}

/** 枚举某客户端 CLI 的所有安装（去重软链；PATH 默认那处排最前）。 */
export async function enumerateInstallations(clientId: ClientId): Promise<ClientInstallation[]> {
  const cmd = CLI_COMMAND[clientId]
  const [defaultReal, loginDirs] = await Promise.all([pathDefaultReal(cmd), loginShellPathDirs()])
  const seen = new Set<string>()
  const installs: ClientInstallation[] = []

  // 登录 shell PATH 目录在前（命令行实际命中范围），常见安装目录兜底；去重。
  const dirs = Array.from(new Set([...loginDirs, ...searchDirs(clientId)]))
  for (const dir of dirs) {
    const exe = join(dir, cmd)
    if (!existsSync(exe)) continue
    const real = canonical(exe)
    if (seen.has(real)) continue // 多入口指向同一真身（软链/shim）只算一处
    seen.add(real)
    const { version, runnable, error } = await probeAt(exe, dir)
    installs.push({
      path: exe,
      version,
      runnable,
      error,
      source: inferSource(exe),
      isPathDefault: defaultReal !== undefined && defaultReal === real,
    })
  }

  installs.sort((a, b) => Number(b.isPathDefault) - Number(a.isPathDefault))
  return installs
}

/** ≥2 处且（版本分歧或运行态混合）→ 判定冲突。 */
export function isConflicting(installs: ClientInstallation[]): boolean {
  if (installs.length < 2) return false
  const versions = new Set(installs.map((i) => i.version ?? '<none>'))
  const runnableMixed = installs.some((i) => i.runnable) && installs.some((i) => !i.runnable)
  return versions.size > 1 || runnableMixed
}
