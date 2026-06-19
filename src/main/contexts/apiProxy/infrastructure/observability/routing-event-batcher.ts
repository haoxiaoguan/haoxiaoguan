// 路由日志重构（observability v2）· 实时事件批量合并器。
//
// 高 QPS 下逐条 webContents.send 会刷爆渲染层；这里把短时间窗（默认 200ms）内的记录攒成一批
// 再 emit 一次，前端单次注入，节流到每秒最多 ~5 次。纯内存、无 I/O。
//
// 注意：record 已延迟到流末（见 ApiProxyService.recordOnStreamEnd），故进入本合并器的记录
// 已带完整 token/usage，实时 tail 显示的就是终态。

import type { RoutingEvent } from '../../domain/observability/routing-event'

export class RoutingEventBatcher {
  private buffer: RoutingEvent[] = []
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly emit: (batch: RoutingEvent[]) => void,
    private readonly intervalMs = 200,
  ) {}

  /** 入队一条事件；首条启动一个合并窗口定时器。 */
  push(ev: RoutingEvent): void {
    this.buffer.push(ev)
    if (this.timer === null) {
      this.timer = setTimeout(() => this.flush(), this.intervalMs)
    }
  }

  /** 立即冲刷当前缓冲（emit 一批）。空缓冲为 no-op。emit 抛错被吞，不影响主流程。 */
  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.buffer.length === 0) return
    const batch = this.buffer
    this.buffer = []
    try {
      this.emit(batch)
    } catch {
      // 推送失败（窗口已销毁等）不影响主流程
    }
  }

  /** 清定时器与缓冲（应用退出时调用，避免悬挂定时器）。 */
  dispose(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.buffer = []
  }
}
