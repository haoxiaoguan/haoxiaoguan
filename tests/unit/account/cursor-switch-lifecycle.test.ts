import { describe, it, expect } from 'vitest'
import { CursorSwitchLifecycle } from '../../../src/main/contexts/account/infrastructure/cursor-switch-lifecycle'
import type { CursorProcessControl } from '../../../src/main/contexts/account/infrastructure/cursor-process'

/** 可编排的假 Cursor 进程控制：记录调用，按字段决定行为。 */
class FakeControl implements CursorProcessControl {
  running: boolean
  quitSucceeds: boolean
  calls: string[] = []
  launchedWith: string | undefined
  constructor(running: boolean, quitSucceeds = true) {
    this.running = running
    this.quitSucceeds = quitSucceeds
  }
  async isRunning(): Promise<boolean> {
    this.calls.push('isRunning')
    return this.running
  }
  async quit(_timeoutMs: number): Promise<boolean> {
    this.calls.push('quit')
    if (this.quitSucceeds) this.running = false
    return !this.running
  }
  async launch(appPath?: string): Promise<void> {
    this.calls.push('launch')
    this.launchedWith = appPath
    this.running = true
  }
}

describe('CursorSwitchLifecycle', () => {
  const noPath = () => undefined

  it('未运行：beforeInject 不停进程、relaunch=false，afterInject 不拉起', async () => {
    const ctrl = new FakeControl(false)
    const lc = new CursorSwitchLifecycle(ctrl, noPath)
    const token = await lc.beforeInject()
    expect(token.relaunch).toBe(false)
    expect(ctrl.calls).toEqual(['isRunning']) // 没调 quit
    await lc.afterInject(token)
    expect(ctrl.calls).not.toContain('launch') // 本来没开就不拉起
  })

  it('运行中：beforeInject 停掉、relaunch=true', async () => {
    const ctrl = new FakeControl(true)
    const lc = new CursorSwitchLifecycle(ctrl, noPath)
    const token = await lc.beforeInject()
    expect(token.relaunch).toBe(true)
    expect(ctrl.calls).toContain('quit')
    expect(ctrl.running).toBe(false)
  })

  it('停不掉：beforeInject 抛错中止切换（避免注入被反写抹掉）', async () => {
    const ctrl = new FakeControl(true, false)
    const lc = new CursorSwitchLifecycle(ctrl, noPath)
    await expect(lc.beforeInject()).rejects.toThrow(/Cursor 仍在运行/)
  })

  it('完整一轮：停 → 注入(外部) → 重启，Cursor 最终恢复运行；用配置的启动路径', async () => {
    const ctrl = new FakeControl(true)
    const lc = new CursorSwitchLifecycle(ctrl, () => '/custom/Cursor.app')
    const token = await lc.beforeInject()
    expect(ctrl.running).toBe(false) // 注入窗口内已退出
    await lc.afterInject(token)
    expect(ctrl.running).toBe(true) // 注入后重启回来
    expect(ctrl.calls).toEqual(['isRunning', 'quit', 'launch'])
    expect(ctrl.launchedWith).toBe('/custom/Cursor.app')
  })
})
