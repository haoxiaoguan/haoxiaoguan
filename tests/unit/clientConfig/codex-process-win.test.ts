import { describe, it, expect } from 'vitest'
import {
  parseCodexTasklistPids,
  WindowsCodexProcessControl,
} from '../../../src/main/contexts/clientConfig/infrastructure/codex-process'

describe('parseCodexTasklistPids', () => {
  it('按镜像名过滤 CSV 行(大小写不敏感)，无匹配行安全忽略', () => {
    const out = [
      '"ChatGPT.exe","12345","Console","1","123,456 K"',
      '"chatgpt.exe","12346","Console","1","64 K"',
      '"Other.exe","999","Console","1","1 K"',
      'INFO: No tasks are running which match the specified criteria.',
    ].join('\n')
    expect(parseCodexTasklistPids(out, 'ChatGPT.exe')).toEqual([12345, 12346])
    expect(parseCodexTasklistPids(out, 'Codex.exe')).toEqual([])
  })
})

/** 可编排假 exec/spawn：记录调用，按脚本决定 tasklist 输出与 spawn 行为。 */
function makeFakes(opts: {
  /** 每次 tasklist 依镜像名返回的 CSV 行（可变，quit 轮询会反复查询）。 */
  aliveByImage: () => Record<string, string>
  spawnError?: NodeJS.ErrnoException
}) {
  const calls: string[] = []
  const exec = async (cmd: string, args: string[]) => {
    calls.push([cmd, ...args].join(' '))
    if (cmd === 'tasklist') {
      // args 形如 ['/FI', 'IMAGENAME eq ChatGPT.exe', '/FO', 'CSV', '/NH']
      const image = args[1].replace('IMAGENAME eq ', '')
      return { stdout: opts.aliveByImage()[image] ?? '' }
    }
    return { stdout: '' } // taskkill / powershell
  }
  const spawnDetached = async (exe: string) => {
    calls.push(`spawn ${exe}`)
    if (opts.spawnError !== undefined) throw opts.spawnError
  }
  return { calls, exec, spawnDetached }
}

const aliveLine = (image: string, pid: number) => `"${image}","${pid}","Console","1","1 K"`

describe('WindowsCodexProcessControl', () => {
  it('isRunning：ChatGPT.exe 或 Codex.exe 任一存活即 true', async () => {
    const f = makeFakes({ aliveByImage: () => ({ 'Codex.exe': aliveLine('Codex.exe', 7) }) })
    const ctrl = new WindowsCodexProcessControl({ exec: f.exec, spawnDetached: f.spawnDetached })
    expect(await ctrl.isRunning()).toBe(true)
    const none = makeFakes({ aliveByImage: () => ({}) })
    const ctrl2 = new WindowsCodexProcessControl({ exec: none.exec, spawnDetached: none.spawnDetached })
    expect(await ctrl2.isRunning()).toBe(false)
  })

  it('quit：先优雅 taskkill /T(不带 /F)，进程消失后返回 true', async () => {
    let alive: Record<string, string> = { 'ChatGPT.exe': aliveLine('ChatGPT.exe', 11) }
    const f = makeFakes({ aliveByImage: () => alive })
    const ctrl = new WindowsCodexProcessControl({ exec: f.exec, spawnDetached: f.spawnDetached })
    // 首次优雅 taskkill 后标记退出
    const origExec = f.exec
    const exec = async (cmd: string, args: string[]) => {
      const r = await origExec(cmd, args)
      if (cmd === 'taskkill') alive = {}
      return r
    }
    const ctrl2 = new WindowsCodexProcessControl({ exec, spawnDetached: f.spawnDetached })
    expect(await ctrl2.quit(2000)).toBe(true)
    const gentle = f.calls.filter((c) => c.startsWith('taskkill') && !c.includes('/F'))
    expect(gentle.length).toBeGreaterThan(0)
    void ctrl
  })

  it('quit：优雅关不掉 → 超时 3/4 处升级 /F 强杀', async () => {
    let forced = false
    const f = makeFakes({
      aliveByImage: () => (forced ? {} : { 'ChatGPT.exe': aliveLine('ChatGPT.exe', 11) }),
    })
    const origExec = f.exec
    const exec = async (cmd: string, args: string[]) => {
      const r = await origExec(cmd, args)
      if (cmd === 'taskkill' && args[0] === '/F') forced = true
      return r
    }
    const ctrl = new WindowsCodexProcessControl({ exec, spawnDetached: f.spawnDetached })
    expect(await ctrl.quit(2000)).toBe(true)
    expect(f.calls.some((c) => c.startsWith('taskkill /F'))).toBe(true)
  })

  it('launch：解析到 exe 直接 spawn', async () => {
    const f = makeFakes({ aliveByImage: () => ({}) })
    const ctrl = new WindowsCodexProcessControl({
      exec: f.exec,
      spawnDetached: f.spawnDetached,
      resolveExe: async () => 'D:\\WindowsApps\\OpenAI.ChatGPT_1.0_x64__x\\app\\ChatGPT.exe',
    })
    await ctrl.launch()
    expect(f.calls).toContain('spawn D:\\WindowsApps\\OpenAI.ChatGPT_1.0_x64__x\\app\\ChatGPT.exe')
  })

  it('launch：WindowsApps 下 spawn 权限拒绝 → 回退 PowerShell Start-Process', async () => {
    const err: NodeJS.ErrnoException = Object.assign(new Error('spawn EPERM'), { code: 'EPERM' })
    const exe = 'C:\\Program Files\\WindowsApps\\OpenAI.ChatGPT_1.0_x64__x\\app\\ChatGPT.exe'
    const f = makeFakes({ aliveByImage: () => ({}), spawnError: err })
    const ctrl = new WindowsCodexProcessControl({
      exec: f.exec,
      spawnDetached: f.spawnDetached,
      resolveExe: async () => exe,
    })
    await ctrl.launch()
    expect(f.calls.some((c) => c.startsWith('powershell.exe') && c.includes('Start-Process'))).toBe(true)
  })

  it('launch：WindowsApps 之外的 spawn 失败原样上抛；解析不到 exe 抛友好错误', async () => {
    const err: NodeJS.ErrnoException = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })
    const f = makeFakes({ aliveByImage: () => ({}), spawnError: err })
    const ctrl = new WindowsCodexProcessControl({
      exec: f.exec,
      spawnDetached: f.spawnDetached,
      resolveExe: async () => 'D:\\custom\\ChatGPT.exe',
    })
    await expect(ctrl.launch()).rejects.toThrow(/ENOENT/)

    const none = new WindowsCodexProcessControl({
      exec: f.exec,
      spawnDetached: f.spawnDetached,
      resolveExe: async () => null,
    })
    await expect(none.launch()).rejects.toThrow(/未找到 ChatGPT/)
  })
})
