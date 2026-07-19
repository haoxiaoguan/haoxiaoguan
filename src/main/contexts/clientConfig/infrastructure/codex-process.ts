// Codex 桌面 App 进程控制（macOS + Windows）。
// 安全约束（铁律）：绝不使用宽泛 pkill（不按 'electron'/'node'/'.app/Contents/MacOS' 等模式杀）。
// 检测/退出/拉起统一按**稳定 bundle id** com.openai.codex（AppleScript `application id ...`
// + `open -b`），全部走 execFile（参数数组，无 shell 解析）规避注入。
//
// 改名事实（2026）：OpenAI 把桌面 App 从 "Codex" 改名为 "ChatGPT"，但 bundle id 仍是
// com.openai.codex、user-data-dir 仍是 ~/Library/Application Support/Codex、CLI 仍叫 codex。
//
// 为什么检测必须按 bundle id 而不是 `ps` 命令行匹配（踩过的坑）：Codex→ChatGPT 走 Sparkle
// 更新时会遗留一个从 ~/Library/Caches/com.openai.codex/.../Sparkle/.../Codex.app 启动的旧实例，
// 其 ps 命令行冒充 /Applications/Codex.app/Contents/MacOS/Codex（但磁盘 bundle 已被替换、按
// bundle id 退不掉）。`ps` 字符串匹配会命中它 → 退出 ChatGPT 后仍判「在运行」→ 切换报
// 「无法退出」且不重启。改用 `application id ... is running`（由 LaunchServices 解析，忽略这类
// 失联僵尸，且与 quit/launch 同口径）后，检测与退出一致，不再误判。
//
// Windows —— 无 bundle id 概念，改按精确镜像名 ChatGPT.exe/Codex.exe 走 tasklist/taskkill/spawn
// （复用 cursor-process 已验证模式，详见下方 Windows 小节注释）。
import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'
import { detectAppPath } from '../../../platform/identity/app-paths'

const execFileAsync = promisify(execFile)

// 稳定的 bundle id（Codex/ChatGPT 共用），检测/退出/拉起都用它，穿改名。
const CODEX_BUNDLE_ID = 'com.openai.codex'
const SLEEP_STEP_MS = 300

/** Codex App 进程控制端口（抽象出来便于单测注入假实现）。 */
export interface CodexProcessControl {
  /** Codex 桌面 App 是否正在运行。 */
  isRunning(): Promise<boolean>
  /** 优雅退出 Codex App，轮询直到退出或超时；返回是否已退出。 */
  quit(timeoutMs: number): Promise<boolean>
  /** 启动 Codex App。可传设置中的启动路径覆盖默认 bundle id / /Applications 路径。 */
  launch(appPath?: string): Promise<void>
}

/** macOS 实现：osascript 按 bundle id 检测/退出 + open 启动。 */
class MacCodexProcessControl implements CodexProcessControl {
  async isRunning(): Promise<boolean> {
    // `application id "..." is running` 由 LaunchServices 解析、不向 App 发 Apple Event
    // （无需自动化权限），且忽略磁盘 bundle 已失联的僵尸进程（见文件头 Sparkle 坑）。
    try {
      const { stdout } = await execFileAsync('osascript', [
        '-e',
        `application id "${CODEX_BUNDLE_ID}" is running`,
      ])
      return stdout.trim() === 'true'
    } catch {
      // 查询失败保守认为未运行（避免据此误报「无法退出」阻断切换）。
      return false
    }
  }

  async quit(timeoutMs: number): Promise<boolean> {
    if (!(await this.isRunning())) return true
    try {
      // 按 bundle id 优雅退出（穿改名：application id 解析到当前安装的 Codex/ChatGPT.app）。
      // 忽略 osascript 本身返回码，以运行态是否消失为准。
      await execFileAsync('osascript', ['-e', `tell application id "${CODEX_BUNDLE_ID}" to quit`])
    } catch {
      // 即使发命令失败，也继续轮询（用户可能手动退）。
    }
    const deadline = Date.now() + Math.max(0, timeoutMs)
    // 轮询运行态是否消失。注意：脚本环境禁用 Date.now() 是 workflow 限制，主进程运行时无此限制。
    while (Date.now() < deadline) {
      await delay(SLEEP_STEP_MS)
      if (!(await this.isRunning())) return true
    }
    return !(await this.isRunning())
  }

  async launch(appPath?: string): Promise<void> {
    // 用户在平台设置里配了启动路径就优先用它（非标准安装位置）；失败回退默认。
    const configured = appPath?.trim()
    if (configured !== undefined && configured.length > 0) {
      try {
        await execFileAsync('open', ['-a', configured])
        return
      } catch {
        // 配置路径失效（已移动/删除）→ 回退默认启动方式
      }
    }
    // 优先按 bundle id 启动（最稳，穿改名：com.openai.codex 现解析到 ChatGPT.app）；
    // 失败回退按路径（先新版 ChatGPT.app，再旧版 Codex.app）。绝不强杀，只负责拉起。
    try {
      await execFileAsync('open', ['-b', CODEX_BUNDLE_ID])
      return
    } catch {
      // 回退路径
    }
    try {
      await execFileAsync('open', ['-a', '/Applications/ChatGPT.app'])
      return
    } catch {
      // 回退旧版路径
    }
    await execFileAsync('open', ['-a', '/Applications/Codex.app'])
  }
}

// Windows —— 对齐 cockpit + 复用 cursor-process 已验证模式：tasklist 判存活、taskkill /T 优雅
// (超时 3/4 升级 /F)、spawn 直起 exe。镜像名精确匹配 ChatGPT.exe/Codex.exe(改名双兼容)，
// 全带 windowsHide 防闪黑框。Store(WindowsApps)目录下 CreateProcess 可能被拒 →
// 回退 PowerShell Start-Process(仍按 exe 路径，不走 shell:AppsFolder)。
const CODEX_WIN_IMAGES = ['ChatGPT.exe', 'Codex.exe'] as const
const CODEX_WIN_LAUNCH_HINT =
  '未找到 ChatGPT/Codex 可执行文件，无法自动启动 ChatGPT，请手动打开 ChatGPT 或在平台设置里配置启动路径。'

/**
 * 解析 `tasklist /FO CSV /NH` 输出里指定镜像名的 PID（含同名 helper 子进程）。
 * 镜像名大小写不敏感；无匹配时 tasklist 打印 `INFO: ...`（非 CSV 行）自然被过滤。
 */
export function parseCodexTasklistPids(stdout: string, image: string): number[] {
  const pids: number[] = []
  for (const line of stdout.split('\n')) {
    const m = line.trim().match(/^"([^"]+)","(\d+)"/)
    if (m === null) continue
    if (m[1].toLowerCase() !== image.toLowerCase()) continue
    const pid = Number(m[2])
    if (Number.isInteger(pid) && pid > 0) pids.push(pid)
  }
  return pids
}

/** 解析启动 exe：配置路径存在→用之；否则动态探测；再退回配置值；都无→null。 */
async function resolveCodexWinExe(appPath?: string): Promise<string | null> {
  const configured = appPath?.trim()
  if (configured !== undefined && configured.length > 0 && existsSync(configured)) return configured
  const info = await detectAppPath('codex')
  if (info.detected !== null) return info.detected
  if (configured !== undefined && configured.length > 0) return configured
  return null
}

async function spawnDetachedDefault(exe: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(exe, [], { detached: true, stdio: 'ignore', windowsHide: true })
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
    child.once('error', (e) => reject(e))
  })
}

export interface CodexWinProcessDeps {
  exec?: (
    cmd: string,
    args: string[],
    opts?: { windowsHide?: boolean; env?: NodeJS.ProcessEnv },
  ) => Promise<{ stdout: string }>
  spawnDetached?: (exe: string) => Promise<void>
  resolveExe?: (appPath?: string) => Promise<string | null>
}

/** Windows 实现（依赖可注入便于单测；生产默认 execFile/spawn/动态探测）。 */
export class WindowsCodexProcessControl implements CodexProcessControl {
  private readonly exec: NonNullable<CodexWinProcessDeps['exec']>
  private readonly spawnDetached: NonNullable<CodexWinProcessDeps['spawnDetached']>
  private readonly resolveExe: NonNullable<CodexWinProcessDeps['resolveExe']>

  constructor(deps: CodexWinProcessDeps = {}) {
    // opts 兜底空对象：可选 opts 会让 promisify 重载解析到 Buffer 版返回类型。
    this.exec = deps.exec ?? (async (cmd, args, opts) => execFileAsync(cmd, args, opts ?? {}))
    this.spawnDetached = deps.spawnDetached ?? spawnDetachedDefault
    this.resolveExe = deps.resolveExe ?? resolveCodexWinExe
  }

  private async listPids(): Promise<number[]> {
    const pids: number[] = []
    for (const image of CODEX_WIN_IMAGES) {
      try {
        const { stdout } = await this.exec(
          'tasklist',
          ['/FI', `IMAGENAME eq ${image}`, '/FO', 'CSV', '/NH'],
          { windowsHide: true },
        )
        pids.push(...parseCodexTasklistPids(stdout, image))
      } catch {
        // tasklist 失败保守认为该镜像未运行（避免误报「无法退出」阻断切换）。
      }
    }
    return pids
  }

  /** taskkill /IM <image> /T[ /F]：/T 连 Electron 子进程树，force 时 /F 强杀。 */
  private async taskkill(force: boolean): Promise<void> {
    for (const image of CODEX_WIN_IMAGES) {
      const args = force ? ['/F', '/IM', image, '/T'] : ['/IM', image, '/T']
      await this.exec('taskkill', args, { windowsHide: true }).catch(() => undefined)
    }
  }

  async isRunning(): Promise<boolean> {
    return (await this.listPids()).length > 0
  }

  async quit(timeoutMs: number): Promise<boolean> {
    if ((await this.listPids()).length === 0) return true
    await this.taskkill(false)
    const deadline = Date.now() + Math.max(0, timeoutMs)
    const escalateAt = Date.now() + Math.max(0, Math.floor(timeoutMs * 0.75))
    let escalated = false
    while (Date.now() < deadline) {
      await delay(SLEEP_STEP_MS)
      if ((await this.listPids()).length === 0) return true
      if (!escalated && Date.now() >= escalateAt) {
        escalated = true
        await this.taskkill(true)
      }
    }
    return (await this.listPids()).length === 0
  }

  async launch(appPath?: string): Promise<void> {
    const exe = await this.resolveExe(appPath)
    if (exe === null) throw new Error(CODEX_WIN_LAUNCH_HINT)
    try {
      await this.spawnDetached(exe)
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      const inWindowsApps = exe.toLowerCase().includes('\\windowsapps\\')
      if ((code === 'EPERM' || code === 'EACCES') && inWindowsApps) {
        // Store 目录下 CreateProcess 被系统拒绝 → PowerShell Start-Process 兜底。
        // exe 路径经环境变量传入，规避引号/注入问题。
        await this.exec(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', 'Start-Process -FilePath ([string]$env:HXG_CODEX_EXE)'],
          { windowsHide: true, env: { ...process.env, HXG_CODEX_EXE: exe } },
        )
        return
      }
      throw e
    }
  }
}

/** 非 macOS/Windows（或不支持）的空实现：桌面 App 停-写-启不适用，一律 no-op。 */
class NoopCodexProcessControl implements CodexProcessControl {
  async isRunning(): Promise<boolean> {
    return false
  }
  async quit(_timeoutMs: number): Promise<boolean> {
    return true
  }
  async launch(): Promise<void> {
    // no-op
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 工厂：macOS / Windows 返回真实实现，其它平台（Linux 无 ChatGPT 桌面 App、*BSD 等）返回 no-op。 */
export function createCodexProcessControl(): CodexProcessControl {
  if (process.platform === 'darwin') return new MacCodexProcessControl()
  if (process.platform === 'win32') return new WindowsCodexProcessControl()
  return new NoopCodexProcessControl()
}
