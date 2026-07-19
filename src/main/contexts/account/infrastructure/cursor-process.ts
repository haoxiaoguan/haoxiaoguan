// Cursor 桌面 App 进程控制（macOS + Windows）。
// 安全铁律：绝不用宽泛 pkill（不按 'electron'/'node'/'.app/Contents/MacOS' 等模式杀）。
// 只精确匹配 Cursor 主进程 → 拿到确切 PID / 精确按镜像名 Cursor.exe → 发信号/taskkill 关闭
// （对齐 cockpit-tools 的 close_pid/close_cursor）。全走 execFile（数组参数，无 shell 解析）规避注入。
//
// macOS —— 为什么用 PID 信号而非 AppleScript：Cursor 是 todesktop/Electron 打包，`application id
// ... is running`/`get name` 能用（LaunchServices 查询，无需 App 响应），但 `tell application id
// ... to quit` 需要 App 处理 Apple Event，Cursor 不一定响应 → 退不掉 → 切号失败。cockpit 用
// PID + kill 信号，可靠且与 helper 一并收敛（`kill -15` SIGTERM，必要时 `-9` 兜底）。
//
// Windows —— 对齐 cockpit 的 process.rs/send_close_signal：`tasklist` 判存活、`taskkill /T` 连
// Electron 子进程树一并关（先优雅、超时升级 `/F` 强杀）、`spawn` 直起 Cursor.exe（非 cmd/start）。
// 全部带 windowsHide 防闪黑框。按精确镜像名 Cursor.exe 目标化（只命中 Cursor，不误杀其它 Electron
// 应用），符合安全铁律。state.vscdb 在 %APPDATA%\Cursor（Roaming），exe 在 %LOCALAPPDATA%\Programs\Cursor。
import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'
import { detectAppPath } from '../../../platform/identity/app-paths'

const execFileAsync = promisify(execFile)

const CURSOR_BUNDLE_ID = 'com.todesktop.230313mzl4w4u92'
const CURSOR_MAIN_EXEC = 'Cursor.app/Contents/MacOS/Cursor'
const CURSOR_DEFAULT_APP_PATH = '/Applications/Cursor.app'
// 标准 NSIS 安装的 Cursor 主进程即 Cursor.exe。dev/未打包构建主进程名为 electron.exe（cockpit 靠
// exe 路径含 \cursor\ 二次确认识别，需 WMI 拿完整路径），此处不覆盖——正式用户不受影响。
const CURSOR_WIN_IMAGE = 'Cursor.exe'
const SLEEP_STEP_MS = 300

/** Cursor App 进程控制端口（抽象出来便于单测注入假实现）。 */
export interface CursorProcessControl {
  /** Cursor 桌面 App 是否正在运行。 */
  isRunning(): Promise<boolean>
  /** 关闭 Cursor App（SIGTERM，必要时 SIGKILL），轮询直到退出或超时；返回是否已退出。 */
  quit(timeoutMs: number): Promise<boolean>
  /** 启动 Cursor App。可传设置中的启动路径覆盖默认 bundle id / /Applications 路径。 */
  launch(appPath?: string): Promise<void>
}

/**
 * 判断一行 `ps` 命令是否为 Cursor 桌面 App 主进程（排除 Helper/GPU/渲染子进程）。
 * 主进程形如 /Applications/Cursor.app/Contents/MacOS/Cursor；Helper 形如
 * .../Cursor.app/Contents/Frameworks/Cursor Helper (Renderer).app/.../Cursor Helper (Renderer)，
 * 其命令行不含 'Cursor.app/Contents/MacOS/Cursor'，再额外排除 'Cursor Helper' 双保险。
 */
export function isCursorMainProcessLine(command: string): boolean {
  return command.includes(CURSOR_MAIN_EXEC) && !command.includes('Cursor Helper')
}

/**
 * 解析 `tasklist /FO CSV /NH` 输出里所有 Cursor.exe 的 PID（含主进程与 helper 子进程——
 * Windows 上它们同名 Cursor.exe）。镜像名大小写不敏感比较。无匹配时 tasklist 会打印
 * `INFO: No tasks ...`（非 CSV 行），自然被行正则过滤掉。
 */
export function parseTasklistCsvPids(stdout: string): number[] {
  const pids: number[] = []
  for (const line of stdout.split('\n')) {
    // CSV 行形如 "Cursor.exe","12345","Console","1","123,456 K"
    const m = line.trim().match(/^"([^"]+)","(\d+)"/)
    if (m === null) continue
    if (m[1].toLowerCase() !== CURSOR_WIN_IMAGE.toLowerCase()) continue
    const pid = Number(m[2])
    if (Number.isInteger(pid) && pid > 0) pids.push(pid)
  }
  return pids
}

/** ps + kill 的共享机制（macOS/Linux 通用）：子类给出主进程行判定 matches() 与平台化 launch()。 */
abstract class PsKillCursorProcessControl implements CursorProcessControl {
  /** 判定一行 ps 命令是否为 Cursor 桌面 App 主进程（排除 helper/子进程）。 */
  protected abstract matches(command: string): boolean
  abstract launch(appPath?: string): Promise<void>

  protected async listPids(): Promise<number[]> {
    try {
      const { stdout } = await execFileAsync('ps', ['-ax', '-o', 'pid=,command='])
      const pids: number[] = []
      for (const line of stdout.split('\n')) {
        const m = line.trim().match(/^(\d+)\s+(.*)$/)
        if (m === null) continue
        if (this.matches(m[2])) {
          const pid = Number(m[1])
          if (Number.isInteger(pid) && pid > 0) pids.push(pid)
        }
      }
      return pids
    } catch {
      // ps 失败时保守认为未运行（避免据此误停/误报「无法退出」阻断切换）。
      return []
    }
  }

  private async signal(pids: number[], sig: '-15' | '-9'): Promise<void> {
    await Promise.all(
      pids.map((pid) => execFileAsync('kill', [sig, String(pid)]).catch(() => undefined)),
    )
  }

  async isRunning(): Promise<boolean> {
    return (await this.listPids()).length > 0
  }

  async quit(timeoutMs: number): Promise<boolean> {
    let pids = await this.listPids()
    if (pids.length === 0) return true
    // 先 SIGTERM 优雅关闭（Electron 会收到并干净退出，释放 state.vscdb 锁）。
    await this.signal(pids, '-15')
    const deadline = Date.now() + Math.max(0, timeoutMs)
    // 超时 3/4 仍未退出 → SIGKILL 兜底（SQLite 崩溃安全，注入本就发生在其退出后）。
    const escalateAt = Date.now() + Math.max(0, Math.floor(timeoutMs * 0.75))
    let escalated = false
    while (Date.now() < deadline) {
      await delay(SLEEP_STEP_MS)
      pids = await this.listPids()
      if (pids.length === 0) return true
      if (!escalated && Date.now() >= escalateAt) {
        escalated = true
        await this.signal(pids, '-9')
      }
    }
    return (await this.listPids()).length === 0
  }
}

/** macOS 实现：ps 精确匹配主进程 + kill 信号关闭 + open 启动。
 *  历史注：早期用 osascript/bundle-id 检测（因 Sparkle/todesktop 更新器可能遗留从缓存目录启动、命令行冒充
 *  /Applications/Cursor.app 的实例）。改 ps 后，这类冒充活体实例由 quit 的 SIGTERM→SIGKILL 按精确 PID 兜底
 *  收敛；已退出的 defunct 僵尸 ps 命令行通常显示为括号截断 `(Cursor)`、不含完整主进程路径 → 不会被命中。 */
class MacCursorProcessControl extends PsKillCursorProcessControl {
  protected matches(command: string): boolean {
    return isCursorMainProcessLine(command)
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

/**
 * 判定一行 ps 命令是否为 Linux 上的 Cursor 桌面 App 主进程（排除 Electron 子进程/CLI）。
 * Cursor 的 Linux 主进程 argv0 通常是 `.../cursor`（deb 装 /usr/share/cursor/cursor、/usr/bin/cursor、
 * /opt/cursor/cursor；AppImage 的 cursor.AppImage / cursor-x.y.z.AppImage）。子进程都带 `--type=`。
 * 对齐 cockpit 的「name/exe 含 cursor + 排除 --type= helper」，但按 argv0 二进制名收窄，避免误伤路径里
 * 恰好含 cursor 的无关命令（如 `node .../.cursor/cli.js`）。仍是 PID 精确匹配，不做宽泛 pkill。
 */
export function isLinuxCursorMainProcessLine(command: string): boolean {
  // Electron 子进程（renderer/gpu/utility/zygote…）都带 --type=；主进程没有。整行判定安全（仅子进程带）。
  if (command.toLowerCase().includes('--type=')) return false
  // 取可执行路径段：从命令行首个「空格+连字符」(参数起点)之前截断，再取 basename。
  // 这样容忍安装目录含空格（如 `/opt/My Apps/cursor --flag` → `/opt/My Apps/cursor` → cursor），
  // 避免朴素按空白切 argv0 把 `/home/john doe/…/cursor` 切成 `/home/john` 而漏判 → 脏写。
  const trimmed = command.trim()
  const dashIdx = trimmed.search(/\s-/)
  const exePart = (dashIdx >= 0 ? trimmed.slice(0, dashIdx) : trimmed).trim()
  const base = (exePart.split('/').pop() ?? '').toLowerCase()
  // 主进程二进制名恰为 cursor（deb 装 /usr/share|/usr/bin|/opt/cursor 下的 electron 主二进制、AppImage
  // 挂载后的 /tmp/.mount_xxx/cursor）。要求精确等于，杜绝 cursor-agent / node .cursor/cli.js 等误伤。
  if (base === 'cursor') return true
  // AppImage 本体：cursor.AppImage / Cursor-1.2.3.AppImage。
  if (base.endsWith('.appimage') && base.includes('cursor')) return true
  return false
}

/** Linux 实现：ps 精确匹配主进程 + kill 信号关闭 + 直接 spawn 可执行文件启动（对齐 cockpit spawn_cursor_unix）。 */
class LinuxCursorProcessControl extends PsKillCursorProcessControl {
  protected matches(command: string): boolean {
    return isLinuxCursorMainProcessLine(command)
  }

  async launch(appPath?: string): Promise<void> {
    const exe = await resolveCursorExe(appPath)
    if (exe === null) {
      throw new Error(
        '未找到 Cursor 可执行文件，无法自动重启 Cursor，请手动打开 Cursor 或在平台设置里配置启动路径。',
      )
    }
    // 直接 exec cursor 二进制（非 shell）；detached+unref 让本进程可独立退出。
    await new Promise<void>((resolve, reject) => {
      const child = spawn(exe, [], { detached: true, stdio: 'ignore' })
      child.once('spawn', () => {
        child.unref()
        resolve()
      })
      child.once('error', (e) => reject(e))
    })
  }
}

/** 解析 Cursor 可执行文件的启动路径（Windows/Linux 共用；detectAppPath 按当前 OS 给候选）：
 *  配置路径优先（存在即用）→ detectAppPath 探测到的存在路径 → 退回配置值。都没有则 null。
 *  注意：detectAppPath.detected 为 null 表示所有候选都不存在盘上，故绝不兜底返回 suggestion（第一候选，
 *  此时必不存在，如 AppImage 装法下 /usr/bin/cursor 并不存在）——返回 null 让 launch 报「请手动打开」友好错误，
 *  而不是 spawn 一个必然 ENOENT 的假路径。 */
async function resolveCursorExe(appPath?: string): Promise<string | null> {
  const configured = appPath?.trim()
  if (configured !== undefined && configured.length > 0 && existsSync(configured)) return configured
  const info = await detectAppPath('cursor')
  if (info.detected !== null) return info.detected
  // 探测不到：退回用户配置值（可能路径有效但 existsSync 因权限失败），交给 spawn 尝试；否则 null。
  if (configured !== undefined && configured.length > 0) return configured
  return null
}

/** Windows 实现：tasklist 判存活 + taskkill /T（超时升级 /F）关闭 + spawn 直起 exe。全带 windowsHide。 */
class WindowsCursorProcessControl implements CursorProcessControl {
  private async listPids(): Promise<number[]> {
    try {
      const { stdout } = await execFileAsync(
        'tasklist',
        ['/FI', `IMAGENAME eq ${CURSOR_WIN_IMAGE}`, '/FO', 'CSV', '/NH'],
        { windowsHide: true },
      )
      return parseTasklistCsvPids(stdout)
    } catch {
      // tasklist 失败时保守认为未运行（避免误报「无法退出」阻断切换）。
      return []
    }
  }

  /** taskkill /IM Cursor.exe /T[ /F]：/T 连 Electron 子进程树，force 时 /F 强杀。精确按镜像名，不误伤其它应用。 */
  private async taskkill(force: boolean): Promise<void> {
    const args = force
      ? ['/F', '/IM', CURSOR_WIN_IMAGE, '/T']
      : ['/IM', CURSOR_WIN_IMAGE, '/T']
    await execFileAsync('taskkill', args, { windowsHide: true }).catch(() => undefined)
  }

  async isRunning(): Promise<boolean> {
    return (await this.listPids()).length > 0
  }

  async quit(timeoutMs: number): Promise<boolean> {
    if ((await this.listPids()).length === 0) return true
    // 先优雅关闭（不带 /F）：Electron 收到 WM_CLOSE 干净退出、刷回并释放 state.vscdb 锁。
    await this.taskkill(false)
    const deadline = Date.now() + Math.max(0, timeoutMs)
    // 超时 3/4 仍未退出（如卡在未保存提示）→ /F 强杀兜底。
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
    const exe = await resolveCursorExe(appPath)
    if (exe === null) {
      throw new Error('未找到 Cursor.exe，无法自动重启 Cursor，请手动打开 Cursor 或在平台设置里配置启动路径。')
    }
    // 直接 CreateProcess 起 Cursor.exe（非 cmd/start，避免 shell 解析）；detached+unref 让本进程可独立退出。
    await new Promise<void>((resolve, reject) => {
      const child = spawn(exe, [], { detached: true, stdio: 'ignore', windowsHide: true })
      child.once('spawn', () => {
        child.unref()
        resolve()
      })
      child.once('error', (e) => reject(e))
    })
  }
}

/** 其它平台（非 macOS/Windows/Linux，如 *BSD）的空实现：桌面 App 停-写-启不适用，一律 no-op。 */
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

/** 工厂：macOS / Windows / Linux 返回真实实现，其它平台（*BSD 等）返回 no-op。 */
export function createCursorProcessControl(): CursorProcessControl {
  if (process.platform === 'darwin') return new MacCursorProcessControl()
  if (process.platform === 'win32') return new WindowsCursorProcessControl()
  if (process.platform === 'linux') return new LinuxCursorProcessControl()
  return new NoopCursorProcessControl()
}
