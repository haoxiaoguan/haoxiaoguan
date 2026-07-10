// Cursor 桌面 App 进程控制（macOS）。镜像 clientConfig/infrastructure/codex-process。
// 安全铁律：绝不用宽泛 pkill。检测/退出/拉起统一按**稳定 bundle id**（AppleScript
// `application id ...` + `open -b`），全部走 execFile（参数数组，无 shell 解析）规避注入。
//
// 检测按 bundle id 而非 `ps` 命令行匹配：更新器（Sparkle/todesktop）可能遗留从缓存目录启动、
// 命令行冒充 /Applications/Cursor.app 但按 bundle id 退不掉的僵尸实例；`ps` 匹配会命中它导致
// 退出后仍判「在运行」→ 切换报「无法退出」。`application id ... is running` 由 LaunchServices
// 解析、忽略此类失联僵尸，且与 quit/launch 同口径，检测与退出一致（详见 codex-process 文件头坑）。
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

// Cursor 的 bundle id（todesktop 打包）。
const CURSOR_BUNDLE_ID = 'com.todesktop.230313mzl4w4u92'
const CURSOR_DEFAULT_APP_PATH = '/Applications/Cursor.app'
const SLEEP_STEP_MS = 300

/** Cursor App 进程控制端口（抽象出来便于单测注入假实现）。 */
export interface CursorProcessControl {
  /** Cursor 桌面 App 是否正在运行。 */
  isRunning(): Promise<boolean>
  /** 优雅退出 Cursor App，轮询直到退出或超时；返回是否已退出。 */
  quit(timeoutMs: number): Promise<boolean>
  /** 启动 Cursor App。可传设置中的启动路径覆盖默认 bundle id / /Applications 路径。 */
  launch(appPath?: string): Promise<void>
}

/** macOS 实现：osascript 按 bundle id 检测/退出 + open 启动。 */
class MacCursorProcessControl implements CursorProcessControl {
  async isRunning(): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync('osascript', [
        '-e',
        `application id "${CURSOR_BUNDLE_ID}" is running`,
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
      // 按 bundle id 退出（等价于用户菜单 Quit）。忽略 osascript 返回码，以运行态是否消失为准。
      await execFileAsync('osascript', ['-e', `tell application id "${CURSOR_BUNDLE_ID}" to quit`])
    } catch {
      // 即使发命令失败，也继续轮询（用户可能手动退）。
    }
    const deadline = Date.now() + Math.max(0, timeoutMs)
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
    // 优先按 bundle id 启动（最稳，穿自定义安装位置）；失败回退按默认路径。
    try {
      await execFileAsync('open', ['-b', CURSOR_BUNDLE_ID])
      return
    } catch {
      // 回退路径
    }
    await execFileAsync('open', ['-a', CURSOR_DEFAULT_APP_PATH])
  }
}

/** 非 macOS（或不支持）的空实现：桌面 App 停-写-启不适用，一律 no-op。 */
class NoopCursorProcessControl implements CursorProcessControl {
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
export function createCursorProcessControl(): CursorProcessControl {
  return process.platform === 'darwin'
    ? new MacCursorProcessControl()
    : new NoopCursorProcessControl()
}
