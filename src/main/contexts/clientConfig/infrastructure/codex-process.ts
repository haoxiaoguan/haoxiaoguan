// Codex 桌面 App 进程控制（macOS）。
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
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

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
