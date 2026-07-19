import { describe, it, expect } from 'vitest'
import {
  isLegacyOfficialCodexMacPath,
  isLegacyOfficialCodexWinPath,
  isOfficialChatGptDetectedPath,
  migrateLegacyCodexIdePathIfNeeded,
} from '../../../src/main/platform/identity/codex-app-path-migration'

describe('官方旧路径判定(纯函数)', () => {
  it('mac：仅两个官方形态命中，容忍尾斜杠/大小写；自定义路径不误判', () => {
    expect(isLegacyOfficialCodexMacPath('/Applications/Codex.app')).toBe(true)
    expect(isLegacyOfficialCodexMacPath('/Applications/Codex.app/')).toBe(true)
    expect(isLegacyOfficialCodexMacPath('/applications/codex.app/contents/macos/codex')).toBe(true)
    expect(isLegacyOfficialCodexMacPath('/Users/me/Apps/Codex.app')).toBe(false)
    expect(isLegacyOfficialCodexMacPath('/Applications/ChatGPT.app')).toBe(false)
    expect(isLegacyOfficialCodexMacPath('')).toBe(false)
  })

  it('win：\\windowsapps\\openai.codex_ 下的 codex.exe 命中；自定义/新名不误判', () => {
    expect(
      isLegacyOfficialCodexWinPath('C:\\Program Files\\WindowsApps\\OpenAI.Codex_1.0.0.0_x64__x\\app\\Codex.exe'),
    ).toBe(true)
    expect(isLegacyOfficialCodexWinPath('D:\\tools\\Codex.exe')).toBe(false)
    expect(
      isLegacyOfficialCodexWinPath('C:\\Program Files\\WindowsApps\\OpenAI.ChatGPT_2.0.0.0_x64__x\\app\\ChatGPT.exe'),
    ).toBe(false)
  })

  it('官方新路径判定：mac 精确 ChatGPT.app；win 以 chatgpt.exe 结尾', () => {
    expect(isOfficialChatGptDetectedPath('/Applications/ChatGPT.app', 'darwin')).toBe(true)
    expect(isOfficialChatGptDetectedPath('/Applications/Codex.app', 'darwin')).toBe(false)
    expect(
      isOfficialChatGptDetectedPath('C:\\Program Files\\WindowsApps\\OpenAI.ChatGPT_2.0_x64__x\\app\\ChatGPT.exe', 'win32'),
    ).toBe(true)
    expect(isOfficialChatGptDetectedPath('C:\\x\\Codex.exe', 'win32')).toBe(false)
    expect(isOfficialChatGptDetectedPath('/usr/bin/whatever', 'linux')).toBe(false)
  })
})

describe('migrateLegacyCodexIdePathIfNeeded', () => {
  function deps(saved: string | undefined, detected: string | null, platform: NodeJS.Platform) {
    const saves: string[] = []
    return {
      saves,
      deps: {
        getSavedPath: () => saved,
        savePath: async (p: string) => {
          saves.push(p)
        },
        detect: async () => ({ detected, suggestion: '' }),
        platform,
      },
    }
  }

  it('官方旧路径 + 探测到官方新路径 → 迁移', async () => {
    const { saves, deps: d } = deps('/Applications/Codex.app', '/Applications/ChatGPT.app', 'darwin')
    expect(await migrateLegacyCodexIdePathIfNeeded(d)).toBe(true)
    expect(saves).toEqual(['/Applications/ChatGPT.app'])
  })

  it('自定义路径 → 不动(不跑探测)', async () => {
    let detectCalls = 0
    const d = {
      getSavedPath: () => '/Users/me/Apps/Codex.app',
      savePath: async () => {
        throw new Error('不应写入')
      },
      detect: async () => {
        detectCalls += 1
        return { detected: '/Applications/ChatGPT.app', suggestion: '' }
      },
      platform: 'darwin' as NodeJS.Platform,
    }
    expect(await migrateLegacyCodexIdePathIfNeeded(d)).toBe(false)
    expect(detectCalls).toBe(0)
  })

  it('未保存路径 / 未探测到新路径 / 探测到的不是官方新路径 → 不动', async () => {
    expect(await migrateLegacyCodexIdePathIfNeeded(deps(undefined, '/Applications/ChatGPT.app', 'darwin').deps)).toBe(false)
    expect(await migrateLegacyCodexIdePathIfNeeded(deps('/Applications/Codex.app', null, 'darwin').deps)).toBe(false)
    expect(await migrateLegacyCodexIdePathIfNeeded(deps('/Applications/Codex.app', '/Applications/Codex.app', 'darwin').deps)).toBe(false)
  })

  it('win：旧 Store codex.exe → 新 chatgpt.exe 迁移', async () => {
    const oldPath = 'C:\\Program Files\\WindowsApps\\OpenAI.Codex_1.0.0.0_x64__x\\app\\Codex.exe'
    const newPath = 'C:\\Program Files\\WindowsApps\\OpenAI.ChatGPT_2.0.0.0_x64__x\\app\\ChatGPT.exe'
    const { saves, deps: d } = deps(oldPath, newPath, 'win32')
    expect(await migrateLegacyCodexIdePathIfNeeded(d)).toBe(true)
    expect(saves).toEqual([newPath])
  })

  it('linux 平台直接跳过；savePath 抛错被吞(返回 false，不上抛)', async () => {
    expect(await migrateLegacyCodexIdePathIfNeeded(deps('/Applications/Codex.app', '/Applications/ChatGPT.app', 'linux').deps)).toBe(false)
    const d = {
      getSavedPath: () => '/Applications/Codex.app',
      savePath: async () => {
        throw new Error('disk full')
      },
      detect: async () => ({ detected: '/Applications/ChatGPT.app', suggestion: '' }),
      platform: 'darwin' as NodeJS.Platform,
    }
    await expect(migrateLegacyCodexIdePathIfNeeded(d)).resolves.toBe(false)
  })
})
