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
// 拉起策略对齐 cockpit：cursor_start_instance 里 start_cursor 是**无条件**的——不管切换前
// Cursor 有没有在运行，注入后都拉起 Cursor（让它读到注入后的 state.vscdb 显示新账号）。
// 运行中的先停掉再启（停-写-启）；没在运行的也启（否则用户看不到切换效果、以为切号无效）。

// 对齐 cockpit close_cursor(20)：刚拉起的 Cursor 对退出的响应可能较慢，给足超时。
const DEFAULT_QUIT_TIMEOUT_MS = 20000

export class CursorSwitchLifecycle implements PlatformSwitchLifecycle {
  constructor(
    private readonly control: CursorProcessControl,
    /** 平台设置里的启动路径（idePaths.cursor）；空则按 bundle id / 默认路径。 */
    private readonly appPath: () => string | undefined,
    private readonly quitTimeoutMs: number = DEFAULT_QUIT_TIMEOUT_MS,
  ) {}

  async beforeInject(): Promise<SwitchLifecycleToken> {
    // 运行中的先停掉（否则写完被运行中的 Cursor 反写回旧账号）；停不掉则中止切换。
    if (await this.control.isRunning()) {
      const exited = await this.control.quit(this.quitTimeoutMs)
      if (!exited) {
        throw new Error('Cursor 仍在运行且无法退出，切换已中止。请手动完全退出 Cursor 后重试。')
      }
    }
    // 无论之前是否在运行，注入后都拉起 Cursor（对齐 cockpit 的无条件 start_cursor）。
    return { relaunch: true }
  }

  async afterInject(token: SwitchLifecycleToken): Promise<void> {
    // 注入后拉起 Cursor，让它重读注入后的 state.vscdb 显示新账号。
    if (token.relaunch) await this.control.launch(this.appPath())
  }
}
