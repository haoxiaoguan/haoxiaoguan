// Codex 桌面 App 进程控制（macOS）。
// 安全约束（铁律）：绝不使用宽泛 pkill（不按 'electron'/'node'/'.app/Contents/MacOS' 等模式杀），
// 只用 AppleScript 优雅退出指定的 Codex App（`tell application "Codex" to quit`）+ `open` 重启，
// 进程检测用 `ps -ax -o command=` 精确匹配 Codex.app 主进程命令行，绝不误伤用户其它 GUI/进程。
// 全部走 execFile（参数数组，无 shell 解析）规避注入。
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** Codex App 进程控制端口（抽象出来便于单测注入假实现）。 */
export interface CodexProcessControl {
  /** Codex 桌面 App 是否正在运行。 */
  isRunning(): Promise<boolean>
  /** 优雅退出 Codex App，轮询直到退出或超时；返回是否已退出。 */
  quit(timeoutMs: number): Promise<boolean>
  /** 启动 Codex App。可传设置中的启动路径覆盖默认 bundle id / /Applications 路径。 */
  launch(appPath?: string): Promise<void>
}

/** 判断一行 `ps` 命令是否为 Codex 桌面 App 主进程（排除 Helper 子进程与 codex CLI）。 */
function isCodexMainProcessLine(command: string): boolean {
  // 主进程命令行形如 /Applications/Codex.app/Contents/MacOS/Codex。
  // Helper 形如 .../Codex.app/Contents/Frameworks/Codex Helper.app/.../Codex Helper (...)，
  // 含 'Codex Helper'，排除之；codex CLI 命令行不含 'Codex.app/Contents/MacOS/Codex'，天然不匹配。
  return command.includes('Codex.app/Contents/MacOS/Codex') && !command.includes('Codex Helper')
}

const SLEEP_STEP_MS = 300

/** macOS 实现：osascript 优雅退出 + open 启动 + ps 检测。 */
class MacCodexProcessControl implements CodexProcessControl {
  async isRunning(): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync('ps', ['-ax', '-o', 'command='])
      return stdout.split('\n').some((line) => isCodexMainProcessLine(line.trim()))
    } catch {
      // ps 失败时保守认为未运行（避免据此误停）。
      return false
    }
  }

  async quit(timeoutMs: number): Promise<boolean> {
    if (!(await this.isRunning())) return true
    try {
      // 优雅退出：等价于用户菜单里 Quit Codex。忽略 osascript 本身返回码，以进程是否消失为准。
      await execFileAsync('osascript', ['-e', 'tell application "Codex" to quit'])
    } catch {
      // 即使发命令失败，也继续轮询（用户可能手动退）。
    }
    const deadline = Date.now() + Math.max(0, timeoutMs)
    // 轮询进程是否退出。注意：脚本环境禁用 Date.now() 是 workflow 限制，主进程运行时无此限制。
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
    // 优先按 bundle id 启动（最稳）；失败回退按路径。绝不强杀，只负责拉起。
    try {
      await execFileAsync('open', ['-b', 'com.openai.codex'])
      return
    } catch {
      // 回退路径
    }
    await execFileAsync('open', ['-a', '/Applications/Codex.app'])
  }
}

/** 非 macOS（或不支持）的空实现：桌面 App 停-写-启不适用，一律 no-op。 */
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

/** 工厂：macOS 返回真实实现，其它平台返回 no-op。 */
export function createCodexProcessControl(): CodexProcessControl {
  return process.platform === 'darwin' ? new MacCodexProcessControl() : new NoopCodexProcessControl()
}
