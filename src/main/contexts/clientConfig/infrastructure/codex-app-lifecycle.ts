// Codex 桌面 App 的写盘生命周期：停 App → (applier 写盘) → 重启 App。
// 运行中的 Codex App 会按内存反写 ~/.codex/config.toml 抹掉外部编辑，必须停掉它写、再重启
// 让它在启动时把 provider 吃进内存。退出用 AppleScript 优雅退出（见 codex-process.ts），
// 绝不宽泛 pkill。可由 enabled 开关关闭（关闭后退化为 no-op，仅 codex CLI 链路生效）。
import type { WriteLifecycle, WriteLifecycleToken } from '../domain/client-writer'
import type { CodexProcessControl } from './codex-process'

const DEFAULT_QUIT_TIMEOUT_MS = 8000

export class CodexAppLifecycle implements WriteLifecycle {
  private readonly control: CodexProcessControl
  private readonly appPath: () => string | undefined
  private readonly enabled: () => boolean
  private readonly quitTimeoutMs: number

  constructor(
    control: CodexProcessControl,
    /** 平台设置里的启动路径（idePaths.codex）；空则按 bundle id / 动态探测。 */
    appPath: () => string | undefined = () => undefined,
    enabled: () => boolean = () => true,
    quitTimeoutMs: number = DEFAULT_QUIT_TIMEOUT_MS,
  ) {
    this.control = control
    this.appPath = appPath
    this.enabled = enabled
    this.quitTimeoutMs = quitTimeoutMs
  }

  async beforeWrite(): Promise<WriteLifecycleToken> {
    // 关闭自动重启时不碰用户的 Codex App（仅 CLI 链路）。
    if (!this.enabled()) return { restart: false }
    if (!(await this.control.isRunning())) return { restart: false }
    const exited = await this.control.quit(this.quitTimeoutMs)
    if (!exited) {
      // 停不掉就中止写入：否则写了也会被运行中的 App 立刻抹掉，造成「配置没生效」的假象。
      throw new Error('Codex 仍在运行，无法安全写入配置。请手动完全退出 Codex App 后重试。')
    }
    return { restart: true }
  }

  async afterWrite(token: WriteLifecycleToken): Promise<void> {
    // 只重启「我们停掉的」那次；写盘失败回滚后也照常重启，恢复用户的 App。
    if (token.restart) await this.control.launch(this.appPath())
  }
}
