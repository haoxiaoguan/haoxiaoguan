import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { ClaudeDesktopWriter, CLAUDE_DESKTOP_PROFILE_ID } from '../../../src/main/contexts/clientConfig/infrastructure/writers/claude-desktop-writer'
import type { ApplyInput, FileBundle } from '../../../src/main/contexts/clientConfig/domain/client-writer'

const ROOT = '/Users/me/Library/Application Support'
const NORMAL = join(ROOT, 'Claude', 'claude_desktop_config.json')
const THREEP = join(ROOT, 'Claude-3p', 'claude_desktop_config.json')
const PROFILE = join(ROOT, 'Claude-3p', 'configLibrary', `${CLAUDE_DESKTOP_PROFILE_ID}.json`)
const META = join(ROOT, 'Claude-3p', 'configLibrary', '_meta.json')

const writer = new ClaudeDesktopWriter(NORMAL, THREEP)

function input(over: Partial<ApplyInput> = {}): ApplyInput {
  return {
    profileId: 'p1',
    name: 'Claude Desktop Gateway',
    source: 'manual',
    baseUrl: 'https://gateway.example.com',
    apiKey: 'sk-desktop',
    settings: {
      modelMap: {
        sonnet: { model: 'claude-sonnet-4-6', name: 'Sonnet via Gateway' },
      },
    },
    ...over,
  }
}

function parse(out: FileBundle, path: string): any {
  return JSON.parse(out[path] ?? '{}')
}

describe('ClaudeDesktopWriter', () => {
  it('apply 写入 Claude Desktop 3P profile、meta，并保留原配置其它字段', () => {
    const out = writer.renderApply(
      {
        [NORMAL]: JSON.stringify({ mcpServers: { git: {} }, deploymentMode: '1p' }),
        [THREEP]: null,
        [PROFILE]: null,
        [META]: null,
      },
      input(),
    )

    expect(writer.configFiles()).toEqual([NORMAL, THREEP, PROFILE, META])
    expect(parse(out, NORMAL)).toMatchObject({ deploymentMode: '3p', mcpServers: { git: {} } })
    expect(parse(out, THREEP).deploymentMode).toBe('3p')
    expect(parse(out, PROFILE)).toEqual({
      coworkEgressAllowedHosts: ['*'],
      disableDeploymentModeChooser: true,
      inferenceGatewayApiKey: 'sk-desktop',
      inferenceGatewayAuthScheme: 'bearer',
      inferenceGatewayBaseUrl: 'https://gateway.example.com',
      inferenceProvider: 'gateway',
      inferenceModels: [{ name: 'claude-sonnet-4-6', labelOverride: 'Sonnet via Gateway' }],
    })
    expect(parse(out, META)).toEqual({
      appliedId: CLAUDE_DESKTOP_PROFILE_ID,
      entries: [{ id: CLAUDE_DESKTOP_PROFILE_ID, name: '号小管' }],
    })
  })

  it('没有分级映射时使用表单选择的模型写入 Desktop profile', () => {
    const out = writer.renderApply(
      { [NORMAL]: null, [THREEP]: null, [PROFILE]: null, [META]: null },
      input({ model: 'deepseek-chat', settings: {} }),
    )

    expect(parse(out, PROFILE).inferenceModels).toEqual(['deepseek-chat'])
  })

  it('clear 切回 1P、移除号小管 meta entry，并清空 profile 内容', () => {
    const applied = writer.renderApply({ [NORMAL]: null, [THREEP]: null, [PROFILE]: null, [META]: null }, input())
    const cleared = writer.renderClear(applied, 'p1')

    expect(parse(cleared, NORMAL).deploymentMode).toBe('1p')
    expect(parse(cleared, THREEP).deploymentMode).toBe('1p')
    expect(parse(cleared, PROFILE)).toEqual({})
    expect(parse(cleared, META)).toEqual({ entries: [] })
  })
})
