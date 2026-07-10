import type { PlatformSwitchLifecycle, SwitchLifecycleToken } from '../domain/ports'
import type { CursorProcessControl } from './cursor-process'

// Cursor 切换账号的「停-写-启」生命周期（对照 cockpit-tools 的
// cursor_start_instance：close_pid + close_cursor → 注入 → start_cursor）。
//
// 关键事实：Cursor 把登录态缓存在内存，运行时会频繁回写 / 退出时反写 state.vscdb。
// 若不先停掉就注入 cursorAuth/*，会被运行中的 Cursor 覆盖 —— 看似切了实际没切、
// 重开 Cursor 要求重新登录（这正是与 cockpit 未对齐处：号小管此前只对 codex 接了
// 停-写-启，cursor 缺失）。
//
// 与 codex 的差异：cursor 不设「切换后自动启动」开关，改为「只在切换前它确实在运行时
// 才重启」——用户本就开着 Cursor 才停+拉回；本来没开则只注入、由用户下次自己打开时读到
// 新登录态（避免无谓地弹出 Cursor 窗口）。

// 对齐 cockpit close_cursor(20)：刚拉起的 Cursor 对 quit 的响应可能较慢，给足超时。
const DEFAULT_QUIT_TIMEOUT_MS = 20000

export class CursorSwitchLifecycle implements PlatformSwitchLifecycle {
  constructor(
    private readonly control: CursorProcessControl,
    /** 平台设置里的启动路径（idePaths.cursor）；空则按 bundle id / 默认路径。 */
    private readonly appPath: () => string | undefined,
    private readonly quitTimeoutMs: number = DEFAULT_QUIT_TIMEOUT_MS,
  ) {}

  async beforeInject(): Promise<SwitchLifecycleToken> {
    if (!(await this.control.isRunning())) {
      // 没在运行：只注入，不主动拉起（用户下次自己打开时读到新态）。
      return { relaunch: false }
    }
    const exited = await this.control.quit(this.quitTimeoutMs)
    if (!exited) {
      // 停不掉就中止切换：否则写完被运行中的 Cursor 反写回旧账号，看似切了实际没切。
      throw new Error('Cursor 仍在运行且无法退出，切换已中止。请手动完全退出 Cursor 后重试。')
    }
    return { relaunch: true }
  }

  async afterInject(token: SwitchLifecycleToken): Promise<void> {
    // 只重启我们停过的（切换前在运行的）Cursor，让它重读注入后的 state.vscdb。
    if (token.relaunch) await this.control.launch(this.appPath())
  }
}
