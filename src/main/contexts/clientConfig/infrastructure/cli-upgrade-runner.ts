import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ClientId } from '../domain/client-profile'
import { INSTALL_COMMAND } from '../domain/client-version'

// 客户端 CLI 一键安装/升级（对称移植 cc-switch run_tool_lifecycle_silently）：
// 经用户登录 shell 静默跑命令（与版本探测同一 PATH 解析路径，确保 npm/node 在 PATH），
// 阻塞到命令结束，无可见终端。升级优先官方自更新子命令、`||` 回退 npm/pip 全局安装
// （官方子命令能正确处理「非 npm 装」的情形，如 claude 的原生安装器）；安装用纯包管理器。
// 失败回传 stderr/stdout 末尾若干行供 toast，绝不宽泛杀进程（只 spawn 我们起的子进程）。

const execFileAsync = promisify(execFile)
const LIFECYCLE_TIMEOUT_MS = 180_000 // 全局安装可能拉包数十秒~数分钟

/** 各客户端升级 shell 命令（POSIX；官方 update 子命令 `||` 包管理器兜底）。 */
const UPGRADE_SHELL_COMMAND: Record<ClientId, string> = {
  claude: 'claude update || npm i -g @anthropic-ai/claude-code@latest',
  codex: 'codex update || npm i -g @openai/codex@latest',
  gemini_cli: 'npm i -g @google/gemini-cli@latest',
  opencode: 'opencode upgrade || npm i -g opencode-ai@latest',
  openclaw: 'openclaw update --yes || npm i -g openclaw@latest',
  hermes: 'hermes update || pip install -U hermes-agent',
}

export interface UpgradeResult {
  ok: boolean
  /** 失败时的诊断（stderr/stdout 末尾若干行）。 */
  detail?: string
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

function errOutput(e: unknown): string {
  if (e !== null && typeof e === 'object') {
    const rec = e as Record<string, unknown>
    const stderr = typeof rec.stderr === 'string' ? rec.stderr : ''
    const stdout = typeof rec.stdout === 'string' ? rec.stdout : ''
    const raw = stderr.trim() || stdout.trim()
    if (raw.length > 0) return lastLines(raw, 8)
    if (typeof rec.message === 'string') return rec.message
  }
  return String(e)
}

/** 经登录 shell 静默跑命令（安装/升级共用）。Windows 暂不支持（best-effort：直接报错）。 */
async function runShellLifecycle(command: string, action: '安装' | '升级'): Promise<UpgradeResult> {
  if (process.platform === 'win32') {
    return { ok: false, detail: `Windows 暂不支持一键${action}，请手动执行${action}命令` }
  }
  const shell = process.env.SHELL && process.env.SHELL.length > 0 ? process.env.SHELL : '/bin/zsh'
  try {
    await execFileAsync(shell, [defaultShellFlag(shell), command], { timeout: LIFECYCLE_TIMEOUT_MS })
    return { ok: true }
  } catch (e) {
    return { ok: false, detail: errOutput(e) }
  }
}

/** 升级某客户端 CLI。 */
export async function runUpgrade(clientId: ClientId): Promise<UpgradeResult> {
  return runShellLifecycle(UPGRADE_SHELL_COMMAND[clientId], '升级')
}

/** 安装某客户端 CLI（未安装时；纯包管理器，命令与「复制手动安装命令」同源）。 */
export async function runInstall(clientId: ClientId): Promise<UpgradeResult> {
  return runShellLifecycle(INSTALL_COMMAND[clientId], '安装')
}
