import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import {
  parseCodexStoreDirName,
  compareVersionArrays,
  findCodexWindowsAppMainExe,
  windowsAppsRoots,
  detectCodexAppOnWindows,
} from '../../../src/main/platform/identity/codex-app-detect-win'

describe('parseCodexStoreDirName', () => {
  it('识别三种包前缀并解析版本，大小写不敏感', () => {
    expect(parseCodexStoreDirName('OpenAI.ChatGPT_2.0.0.0_x64__8wekyb3d8bbwe')).toEqual({
      priority: 2,
      version: [2, 0, 0, 0],
    })
    expect(parseCodexStoreDirName('openai.chatgpt-desktop_1.5.0.0_x64__abc')).toEqual({
      priority: 2,
      version: [1, 5, 0, 0],
    })
    expect(parseCodexStoreDirName('OpenAI.Codex_1.0.0.0_x64__8wekyb3d8bbwe')).toEqual({
      priority: 1,
      version: [1, 0, 0, 0],
    })
  })

  it('非官方包/坏版本号 → null', () => {
    expect(parseCodexStoreDirName('Microsoft.WindowsTerminal_1.0_x64__x')).toBeNull()
    expect(parseCodexStoreDirName('OpenAI.ChatGPT_notaversion_x64__x')).toBeNull()
    expect(parseCodexStoreDirName('OpenAI.ChatGPT')).toBeNull()
  })
})

describe('compareVersionArrays', () => {
  it('逐段数值比较，长度不齐按 0 补', () => {
    expect(compareVersionArrays([2, 0], [1, 9, 9])).toBeGreaterThan(0)
    expect(compareVersionArrays([1, 0, 0], [1, 0])).toBe(0)
    expect(compareVersionArrays([1, 0, 1], [1, 0, 2])).toBeLessThan(0)
  })
})

describe('findCodexWindowsAppMainExe', () => {
  it('先 ChatGPT.exe 再 Codex.exe，都无 → null', () => {
    const appDir = join('C:\\WindowsApps\\OpenAI.ChatGPT_2.0.0.0_x64__x', 'app')
    const both = new Set([join(appDir, 'ChatGPT.exe'), join(appDir, 'Codex.exe')])
    expect(findCodexWindowsAppMainExe(appDir, (p) => both.has(p))).toBe(join(appDir, 'ChatGPT.exe'))
    const onlyOld = new Set([join(appDir, 'Codex.exe')])
    expect(findCodexWindowsAppMainExe(appDir, (p) => onlyOld.has(p))).toBe(join(appDir, 'Codex.exe'))
    expect(findCodexWindowsAppMainExe(appDir, () => false)).toBeNull()
  })
})

describe('windowsAppsRoots', () => {
  it('C 盘走 Program Files\\WindowsApps，其它盘走 X:\\WindowsApps', () => {
    const existing = new Set(['C:\\Program Files\\WindowsApps', 'D:\\WindowsApps'])
    expect(windowsAppsRoots((p) => existing.has(p))).toEqual([
      'C:\\Program Files\\WindowsApps',
      'D:\\WindowsApps',
    ])
    expect(windowsAppsRoots(() => false)).toEqual([])
  })
})

describe('detectCodexAppOnWindows', () => {
  const ROOT = 'C:\\Program Files\\WindowsApps'

  function fsWith(dirs: Record<string, string[]>, files: string[]) {
    const fileSet = new Set(files)
    return {
      exists: (p: string) => p in dirs || fileSet.has(p),
      readDir: (p: string) => {
        const entries = dirs[p]
        if (entries === undefined) throw new Error('EPERM')
        return entries
      },
    }
  }

  it('通道1：ChatGPT 包优先于 Codex 包，取 app\\ChatGPT.exe', async () => {
    const chatgptDir = 'OpenAI.ChatGPT_2.0.0.0_x64__x'
    const codexDir = 'OpenAI.Codex_9.9.9.9_x64__x' // 版本更高也不敌优先级
    const chatgptExe = join(ROOT, chatgptDir, 'app', 'ChatGPT.exe')
    const codexExe = join(ROOT, codexDir, 'app', 'Codex.exe')
    const fs = fsWith({ [ROOT]: [chatgptDir, codexDir, 'Unrelated_1.0_x64__x'] }, [chatgptExe, codexExe])
    const detected = await detectCodexAppOnWindows({
      ...fs,
      runPowershell: async () => { throw new Error('不应走到通道2') },
    })
    expect(detected).toBe(chatgptExe)
  })

  it('通道1：同优先级取版本最高；exe 缺失的包被跳过', async () => {
    const v1 = 'OpenAI.ChatGPT_1.0.0.0_x64__x'
    const v2 = 'OpenAI.ChatGPT_2.0.0.0_x64__x' // 版本更高但没有 exe → 跳过
    const v1Exe = join(ROOT, v1, 'app', 'ChatGPT.exe')
    const fs = fsWith({ [ROOT]: [v1, v2] }, [v1Exe])
    const detected = await detectCodexAppOnWindows({
      ...fs,
      runPowershell: async () => { throw new Error('不应走到通道2') },
    })
    expect(detected).toBe(v1Exe)
  })

  it('通道1读目录被拒(ACL) → 回退通道2 Get-AppxPackage', async () => {
    const loc = join('C:\\Program Files\\WindowsApps', 'OpenAI.ChatGPT_2.0.0.0_x64__x')
    const exe = join(loc, 'app', 'ChatGPT.exe')
    const detected = await detectCodexAppOnWindows({
      exists: (p) => p === 'C:\\Program Files\\WindowsApps' || p === exe,
      readDir: () => { throw new Error('EPERM') },
      runPowershell: async () => `${loc}\r\n`,
    })
    expect(detected).toBe(exe)
  })

  it('两通道都落空 → null(不抛错)', async () => {
    expect(
      await detectCodexAppOnWindows({
        exists: () => false,
        readDir: () => { throw new Error('EPERM') },
        runPowershell: async () => '',
      }),
    ).toBeNull()
    expect(
      await detectCodexAppOnWindows({
        exists: () => false,
        readDir: () => { throw new Error('EPERM') },
        runPowershell: async () => { throw new Error('ps boom') },
      }),
    ).toBeNull()
  })
})
