import type { PlatformSwitchLifecycle, SwitchLifecycleToken } from '../domain/ports'
import type { CodexProcessControl } from '../../clientConfig/infrastructure/codex-process'

// 对齐 cockpit-tools close_codex_default(20)：刚拉起不久的 Codex App 对
// AppleScript quit 的响应可能超过 10 秒，8 秒会误判「退不出」而中止切换。
const DEFAULT_QUIT_TIMEOUT_MS = 20000

/**
 * Codex 切换账号的「停-写-启」生命周期（对照 cockpit-tools 的
 * codex_launch_on_switch + codex_start_default_with_prepared_profile）：
 * 运行中的 Codex App 持登录态在内存、退出时反写 auth.json，不停掉它写了也白写；
 * 切完按 cockpit 语义无条件拉起 App（即便之前没在运行）。
 * 开关关闭时完全不碰进程（仅写盘，CLI 用户场景）。
 */
export class CodexSwitchLifecycle implements PlatformSwitchLifecycle {
  constructor(
    private readonly control: CodexProcessControl,
    /** 「切换后自动启动 Codex App」设置（默认 true，对齐 cockpit-tools）。 */
    private readonly launchOnSwitch: () => boolean,
    /** 平台设置里的启动路径（idePaths.codex）；空则按 bundle id / 默认路径。 */
    private readonly appPath: () => string | undefined,
    private readonly quitTimeoutMs: number = DEFAULT_QUIT_TIMEOUT_MS,
  ) {}

  async beforeInject(): Promise<SwitchLifecycleToken> {
    if (!this.launchOnSwitch()) return { relaunch: false }
    if (await this.control.isRunning()) {
      const exited = await this.control.quit(this.quitTimeoutMs)
      if (!exited) {
        // 停不掉就中止切换：否则写完被运行中的 App 反写回旧账号，看似切了实际没切。
        throw new Error('Codex 仍在运行且无法退出，切换已中止。请手动完全退出 Codex App 后重试。')
      }
    }
    return { relaunch: true }
  }

  async afterInject(token: SwitchLifecycleToken): Promise<void> {
    if (token.relaunch) await this.control.launch(this.appPath())
  }
}
