import { describe, it, expect } from 'vitest'
import { CursorSwitchLifecycle } from '../../../src/main/contexts/account/infrastructure/cursor-switch-lifecycle'
import {
  isCursorMainProcessLine,
  isLinuxCursorMainProcessLine,
  parseTasklistCsvPids,
  type CursorProcessControl,
} from '../../../src/main/contexts/account/infrastructure/cursor-process'

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

  it('未运行：beforeInject 不停进程但 relaunch=true，afterInject 仍拉起(对齐 cockpit 无条件 start)', async () => {
    const ctrl = new FakeControl(false)
    const lc = new CursorSwitchLifecycle(ctrl, noPath)
    const token = await lc.beforeInject()
    expect(token.relaunch).toBe(true)
    expect(ctrl.calls).toEqual(['isRunning']) // 没调 quit（本来没运行）
    await lc.afterInject(token)
    expect(ctrl.calls).toContain('launch') // 无条件拉起
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

describe('isCursorMainProcessLine', () => {
  it('匹配 Cursor 主进程', () => {
    expect(isCursorMainProcessLine('/Applications/Cursor.app/Contents/MacOS/Cursor')).toBe(true)
    expect(isCursorMainProcessLine('/Applications/Cursor.app/Contents/MacOS/Cursor --foo')).toBe(true)
  })
  it('不匹配 Helper/渲染子进程（其命令行在 Frameworks 下，不含主进程串）', () => {
    const helper =
      '/Applications/Cursor.app/Contents/Frameworks/Cursor Helper (Renderer).app/Contents/MacOS/Cursor Helper (Renderer) --type=renderer'
    expect(isCursorMainProcessLine(helper)).toBe(false)
    const gpu =
      '/Applications/Cursor.app/Contents/Frameworks/Cursor Helper (GPU).app/Contents/MacOS/Cursor Helper (GPU) --type=gpu-process'
    expect(isCursorMainProcessLine(gpu)).toBe(false)
  })
  it('不匹配无关进程', () => {
    expect(isCursorMainProcessLine('/usr/bin/node /some/cursor/cli.js')).toBe(false)
    expect(isCursorMainProcessLine('/Applications/Xcode.app/Contents/MacOS/Xcode')).toBe(false)
  })
})

describe('isLinuxCursorMainProcessLine', () => {
  it('匹配 Linux 主进程（deb 安装的各种 argv0）', () => {
    expect(isLinuxCursorMainProcessLine('/usr/share/cursor/cursor')).toBe(true)
    expect(isLinuxCursorMainProcessLine('/usr/bin/cursor')).toBe(true)
    expect(isLinuxCursorMainProcessLine('/opt/cursor/cursor --no-sandbox')).toBe(true)
    // AppImage
    expect(isLinuxCursorMainProcessLine('/home/u/Applications/cursor.AppImage')).toBe(true)
    expect(isLinuxCursorMainProcessLine('/home/u/Apps/Cursor-1.2.3.AppImage')).toBe(true)
    // AppImage 挂载后的真实二进制
    expect(isLinuxCursorMainProcessLine('/tmp/.mount_CursorAbc/cursor')).toBe(true)
  })
  it('容忍安装目录含空格（不因空白切分而漏判 → 避免脏写）', () => {
    expect(isLinuxCursorMainProcessLine('/opt/My Apps/cursor --no-sandbox')).toBe(true)
    expect(isLinuxCursorMainProcessLine('/home/john doe/Apps/cursor.AppImage')).toBe(true)
    expect(isLinuxCursorMainProcessLine('/home/john doe/Apps/cursor.AppImage --disable-gpu')).toBe(
      true,
    )
  })
  it('不匹配 Electron 子进程（带 --type= / crashpad）', () => {
    expect(
      isLinuxCursorMainProcessLine('/usr/share/cursor/cursor --type=renderer --enable-crashpad'),
    ).toBe(false)
    expect(isLinuxCursorMainProcessLine('/usr/share/cursor/cursor --type=gpu-process')).toBe(false)
    expect(isLinuxCursorMainProcessLine('/usr/share/cursor/cursor --type=zygote')).toBe(false)
    expect(
      isLinuxCursorMainProcessLine('/usr/share/cursor/chrome_crashpad_handler --database=/x'),
    ).toBe(false)
  })
  it('不匹配路径里恰好含 cursor 的无关命令（node CLI 等）', () => {
    expect(isLinuxCursorMainProcessLine('node /home/u/.cursor/cli/index.js')).toBe(false)
    expect(isLinuxCursorMainProcessLine('/bin/bash /opt/cursor/wrapper.sh')).toBe(false)
    expect(isLinuxCursorMainProcessLine('/usr/bin/code')).toBe(false)
    expect(isLinuxCursorMainProcessLine('/usr/bin/cursor-agent chat')).toBe(false)
  })
})

describe('parseTasklistCsvPids（Windows）', () => {
  it('解析出所有 Cursor.exe 的 PID（主进程 + helper 同名）', () => {
    const out =
      '"Cursor.exe","12345","Console","1","250,000 K"\r\n' +
      '"Cursor.exe","12346","Console","1","80,000 K"\r\n'
    expect(parseTasklistCsvPids(out)).toEqual([12345, 12346])
  })
  it('镜像名大小写不敏感', () => {
    expect(parseTasklistCsvPids('"CURSOR.EXE","999","Console","1","1 K"')).toEqual([999])
  })
  it('无匹配时 tasklist 的 INFO 行不产生 PID', () => {
    expect(
      parseTasklistCsvPids('INFO: No tasks are running which match the specified criteria.'),
    ).toEqual([])
  })
  it('忽略其它镜像名与畸形行', () => {
    const out =
      '"Code.exe","111","Console","1","10 K"\r\n' +
      'garbage line without quotes\r\n' +
      '"Cursor.exe","222","Console","1","20 K"'
    expect(parseTasklistCsvPids(out)).toEqual([222])
  })
})
