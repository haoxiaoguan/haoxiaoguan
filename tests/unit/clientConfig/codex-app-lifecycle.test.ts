import { describe, it, expect } from 'vitest'
import { CodexAppLifecycle } from '../../../src/main/contexts/clientConfig/infrastructure/codex-app-lifecycle'
import type { CodexProcessControl } from '../../../src/main/contexts/clientConfig/infrastructure/codex-process'

/** 可编排的假 Codex 进程控制：记录调用，按字段决定行为。 */
class FakeControl implements CodexProcessControl {
  running: boolean
  quitSucceeds: boolean
  calls: string[] = []
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
    this.calls.push(`launch:${appPath ?? ''}`)
    this.running = true
  }
}

describe('CodexAppLifecycle', () => {
  it('App 未运行：beforeWrite 不停进程、restart=false', async () => {
    const ctrl = new FakeControl(false)
    const lc = new CodexAppLifecycle(ctrl)
    const token = await lc.beforeWrite()
    expect(token.restart).toBe(false)
    expect(ctrl.calls).toEqual(['isRunning']) // 没调 quit
  })

  it('App 运行中：beforeWrite 优雅停掉、restart=true', async () => {
    const ctrl = new FakeControl(true)
    const lc = new CodexAppLifecycle(ctrl)
    const token = await lc.beforeWrite()
    expect(token.restart).toBe(true)
    expect(ctrl.calls).toContain('quit')
    expect(ctrl.running).toBe(false)
  })

  it('停不掉：beforeWrite 抛错中止写入（避免写了被反写抹掉）', async () => {
    const ctrl = new FakeControl(true, false) // quit 不成功
    const lc = new CodexAppLifecycle(ctrl)
    await expect(lc.beforeWrite()).rejects.toThrow(/Codex 仍在运行/)
  })

  it('afterWrite(restart=true)：重启 App', async () => {
    const ctrl = new FakeControl(false)
    const lc = new CodexAppLifecycle(ctrl)
    await lc.afterWrite({ restart: true })
    expect(ctrl.calls).toContain('launch:')
  })

  it('afterWrite(restart=false)：不重启（我们没停过它）', async () => {
    const ctrl = new FakeControl(false)
    const lc = new CodexAppLifecycle(ctrl)
    await lc.afterWrite({ restart: false })
    expect(ctrl.calls.some((c) => c.startsWith('launch'))).toBe(false)
  })

  it('afterWrite 重启带上平台设置的启动路径(尊重自定义路径)', async () => {
    const ctrl = new FakeControl(false)
    const lc = new CodexAppLifecycle(ctrl, () => 'D:\\custom\\ChatGPT.exe')
    await lc.afterWrite({ restart: true })
    expect(ctrl.calls).toContain('launch:D:\\custom\\ChatGPT.exe')
  })

  it('enabled=false（关闭自动重启）：完全不碰 App', async () => {
    const ctrl = new FakeControl(true)
    const lc = new CodexAppLifecycle(ctrl, () => undefined, () => false)
    const token = await lc.beforeWrite()
    expect(token.restart).toBe(false)
    expect(ctrl.calls).toEqual([]) // 连 isRunning 都不调
  })

  it('完整一轮：停 → 写(外部) → 重启，App 最终恢复运行', async () => {
    const ctrl = new FakeControl(true)
    const lc = new CodexAppLifecycle(ctrl)
    const token = await lc.beforeWrite()
    expect(ctrl.running).toBe(false) // 写盘窗口内 App 已退出
    await lc.afterWrite(token)
    expect(ctrl.running).toBe(true) // 写完重启回来
    expect(ctrl.calls).toEqual(['isRunning', 'quit', 'launch:'])
  })
})
