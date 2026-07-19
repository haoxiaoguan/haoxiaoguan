import { describe, it, expect } from 'vitest'
import {
  isOfficialCodexWinProcessPath,
  parseCodexCimProcessLines,
  parseCodexTasklistPids,
  WindowsCodexProcessControl,
} from '../../../src/main/contexts/clientConfig/infrastructure/codex-process'

describe('parseCodexCimProcessLines', () => {
  it('解析「pid|exePath」行；空路径保留空串；坏行/非正整数 pid 忽略；兼容 CRLF', () => {
    const official = 'C:\\Program Files\\WindowsApps\\OpenAI.ChatGPT_1.0_x64__abc\\app\\ChatGPT.exe'
    const out = [
      `12345|${official}`,
      '77|', // 权限不可见 → exePath 空串
      'garbage line', // 无分隔符 → 忽略
      '|C:\\no-pid.exe', // 无 pid → 忽略
      '0|C:\\zero.exe', // 非正整数 → 忽略
      '-3|C:\\negative.exe', // 负数 → 忽略
      'abc|C:\\nan.exe', // 非数字 → 忽略
      '',
    ].join('\r\n')
    expect(parseCodexCimProcessLines(out)).toEqual([
      { pid: 12345, exe: official },
      { pid: 77, exe: '' },
    ])
  })
})

describe('isOfficialCodexWinProcessPath', () => {
  it('官方 Store 包路径 → true(大小写不敏感)；非 Store 同名/空路径 → false', () => {
    expect(
      isOfficialCodexWinProcessPath(
        'C:\\Program Files\\WindowsApps\\OpenAI.ChatGPT_1.2025.317.0_x64__2r0d3g2rzrbt6\\app\\ChatGPT.exe',
      ),
    ).toBe(true)
    expect(
      isOfficialCodexWinProcessPath(
        'C:\\Program Files\\WindowsApps\\OpenAI.ChatGPT-Desktop_1.2.3.0_x64__abc\\app\\ChatGPT.exe',
      ),
    ).toBe(true)
    expect(
      isOfficialCodexWinProcessPath(
        'D:\\PROGRAM FILES\\WINDOWSAPPS\\OPENAI.CODEX_0.9.0.0_X64__ABC\\APP\\CODEX.EXE',
      ),
    ).toBe(true)
    expect(isOfficialCodexWinProcessPath('C:\\Program Files\\SomeChat\\ChatGPT.exe')).toBe(false)
    expect(isOfficialCodexWinProcessPath('')).toBe(false)
    expect(isOfficialCodexWinProcessPath('   ')).toBe(false)
  })
})

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

/** 可编排假 exec/spawn：记录调用与 taskkill 参数，按脚本决定 CIM/tasklist 输出与 spawn 行为。 */
function makeFakes(opts: {
  /** 每次 CIM 查询返回的「pid|exePath」行（可变，quit 轮询会反复查询）。 */
  cimLines?: () => string
  /** CIM(PowerShell) 调用直接抛错 → 触发 tasklist 镜像名降级路径。 */
  cimError?: Error
  /** 降级路径：每次 tasklist 依镜像名返回的 CSV 行。 */
  aliveByImage?: () => Record<string, string>
  spawnError?: NodeJS.ErrnoException
}) {
  const calls: string[] = []
  const taskkillArgs: string[][] = []
  const exec = async (cmd: string, args: string[]) => {
    calls.push([cmd, ...args].join(' '))
    if (cmd === 'powershell.exe' && args.some((a) => a.includes('Get-CimInstance'))) {
      if (opts.cimError !== undefined) throw opts.cimError
      return { stdout: opts.cimLines?.() ?? '' }
    }
    if (cmd === 'tasklist') {
      // args 形如 ['/FI', 'IMAGENAME eq ChatGPT.exe', '/FO', 'CSV', '/NH']
      const image = args[1].replace('IMAGENAME eq ', '')
      return { stdout: opts.aliveByImage?.()[image] ?? '' }
    }
    if (cmd === 'taskkill') {
      taskkillArgs.push([...args])
      return { stdout: '' }
    }
    return { stdout: '' } // powershell Start-Process 等
  }
  const spawnDetached = async (exe: string) => {
    calls.push(`spawn ${exe}`)
    if (opts.spawnError !== undefined) throw opts.spawnError
  }
  return { calls, taskkillArgs, exec, spawnDetached }
}

const OFFICIAL_EXE =
  'C:\\Program Files\\WindowsApps\\OpenAI.ChatGPT_1.0_x64__abc\\app\\ChatGPT.exe'
const IMPOSTOR_EXE = 'C:\\Program Files\\SomeChat\\ChatGPT.exe'
const cimLine = (pid: number, exe: string) => `${pid}|${exe}`

describe('WindowsCodexProcessControl', () => {
  it('isRunning：官方 Store 路径进程 → true；仅同名无关进程 → false', async () => {
    const official = makeFakes({ cimLines: () => cimLine(7, OFFICIAL_EXE) })
    const ctrl = new WindowsCodexProcessControl({
      exec: official.exec,
      spawnDetached: official.spawnDetached,
    })
    expect(await ctrl.isRunning()).toBe(true)

    const impostor = makeFakes({ cimLines: () => cimLine(8, IMPOSTOR_EXE) })
    const ctrl2 = new WindowsCodexProcessControl({
      exec: impostor.exec,
      spawnDetached: impostor.spawnDetached,
    })
    expect(await ctrl2.isRunning()).toBe(false)
  })

  it('quit：只按 PID 优雅停官方进程(/PID <pid> /T 不带 /F)，同名无关进程绝不被 taskkill', async () => {
    let officialAlive = true
    const f = makeFakes({
      cimLines: () =>
        [
          ...(officialAlive ? [cimLine(11, OFFICIAL_EXE)] : []),
          cimLine(999, IMPOSTOR_EXE), // 无关进程一直活着，不应影响 quit 结果
        ].join('\n'),
    })
    // 首次优雅 taskkill 后官方进程退出
    const exec = async (cmd: string, args: string[]) => {
      const r = await f.exec(cmd, args)
      if (cmd === 'taskkill') officialAlive = false
      return r
    }
    const ctrl = new WindowsCodexProcessControl({ exec, spawnDetached: f.spawnDetached })
    expect(await ctrl.quit(2000)).toBe(true)
    expect(f.taskkillArgs.length).toBeGreaterThan(0)
    expect(f.taskkillArgs[0]).toEqual(['/PID', '11', '/T'])
    for (const args of f.taskkillArgs) {
      expect(args).not.toContain('999') // 绝不误杀无关进程
      expect(args).not.toContain('/F') // 优雅退出无需强杀
      expect(args).not.toContain('/IM') // 绝不按镜像名宽泛杀
    }

    // 只有同名无关进程在跑 → 视为「未运行」，quit 一次 taskkill 都不发
    const only = makeFakes({ cimLines: () => cimLine(999, IMPOSTOR_EXE) })
    const ctrl2 = new WindowsCodexProcessControl({ exec: only.exec, spawnDetached: only.spawnDetached })
    expect(await ctrl2.quit(2000)).toBe(true)
    expect(only.taskkillArgs).toEqual([])
  })

  it('quit：优雅关不掉 → 超时 3/4 处用最新 PID 列表升级 /F /PID 强杀', async () => {
    let forced = false
    const f = makeFakes({
      cimLines: () => (forced ? '' : cimLine(11, OFFICIAL_EXE)),
    })
    const exec = async (cmd: string, args: string[]) => {
      const r = await f.exec(cmd, args)
      if (cmd === 'taskkill' && args[0] === '/F') forced = true
      return r
    }
    const ctrl = new WindowsCodexProcessControl({ exec, spawnDetached: f.spawnDetached })
    expect(await ctrl.quit(2000)).toBe(true)
    expect(f.taskkillArgs.some((a) => a[0] === '/F' && a[1] === '/PID' && a[2] === '11')).toBe(true)
  })

  it('CIM(PowerShell) 不可用 → 降级 tasklist 镜像名判存活(丢失身份过滤的已知取舍)', async () => {
    const f = makeFakes({
      cimError: new Error('powershell blocked by policy'),
      aliveByImage: () => ({ 'Codex.exe': '"Codex.exe","7","Console","1","1 K"' }),
    })
    const ctrl = new WindowsCodexProcessControl({ exec: f.exec, spawnDetached: f.spawnDetached })
    expect(await ctrl.isRunning()).toBe(true)

    const none = makeFakes({ cimError: new Error('powershell blocked'), aliveByImage: () => ({}) })
    const ctrl2 = new WindowsCodexProcessControl({ exec: none.exec, spawnDetached: none.spawnDetached })
    expect(await ctrl2.isRunning()).toBe(false)
  })

  it('launch：解析到 exe 直接 spawn', async () => {
    const f = makeFakes({})
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
    const f = makeFakes({ spawnError: err })
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
    const f = makeFakes({ spawnError: err })
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
