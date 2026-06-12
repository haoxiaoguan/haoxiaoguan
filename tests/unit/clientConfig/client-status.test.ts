import { describe, it, expect } from 'vitest'
import { clientStatus, indexVersions } from '../../../src/renderer/components/clientConfig/clientStatus'
import type { ClientConfigVersionInfo } from '../../../src/shared/api-types'

// 简单的 t：返回 "key" 或 "key|参数" 便于断言走了哪条分支。
const t = (key: string, opts?: Record<string, unknown>): string =>
  opts === undefined ? key : `${key}|${JSON.stringify(opts)}`

const v = (p: Partial<ClientConfigVersionInfo>): ClientConfigVersionInfo => ({
  clientId: 'claude',
  upgradable: false,
  installedButBroken: false,
  ...p,
})

describe('clientStatus', () => {
  it('未检测到配置且无已装版本 → 未安装（灰）', () => {
    const s = clientStatus(false, undefined, t)
    expect(s.label).toBe('clientConfigPage.notDetected')
    expect(s.dotClass).toBe('bg-zinc-400')
  })

  it('检测到配置但版本未知 → 已安装（绿），无 title', () => {
    const s = clientStatus(true, undefined, t)
    expect(s.label).toBe('clientConfigPage.detected')
    expect(s.dotClass).toBe('bg-emerald-500')
    expect(s.title).toBeUndefined()
  })

  it('可升级 → 可升级（琥珀），title 含当前/最新 + 升级命令', () => {
    const s = clientStatus(
      true,
      v({ installedVersion: '1.0.86', latestVersion: '1.0.90', upgradable: true, upgradeCommand: 'npm i -g x@latest' }),
      t,
    )
    expect(s.label).toBe('clientConfigPage.upgradable')
    expect(s.dotClass).toBe('bg-amber-500')
    expect(s.title).toContain('clientConfigPage.versionUpgradable')
    expect(s.title).toContain('1.0.86')
    expect(s.title).toContain('1.0.90')
    expect(s.title).toContain('clientConfigPage.versionUpgradeHint')
  })

  it('已是最新（有 latest 且不可升级）→ 已安装（绿），title 显示已是最新', () => {
    const s = clientStatus(true, v({ installedVersion: '1.0.90', latestVersion: '1.0.90' }), t)
    expect(s.label).toBe('clientConfigPage.detected')
    expect(s.dotClass).toBe('bg-emerald-500')
    expect(s.title).toContain('clientConfigPage.versionLatest')
  })

  it('仅探到已装版本、latest 未知（离线）→ 已安装，title 显示已装版本', () => {
    const s = clientStatus(false, v({ installedVersion: '1.0.90' }), t)
    expect(s.label).toBe('clientConfigPage.detected')
    expect(s.title).toContain('clientConfigPage.versionInstalled')
  })

  it('indexVersions 按 clientId 归并', () => {
    const idx = indexVersions([v({ clientId: 'codex', installedVersion: '0.5.0' }), v({ clientId: 'hermes' })])
    expect(idx.codex?.installedVersion).toBe('0.5.0')
    expect(idx.hermes?.clientId).toBe('hermes')
    expect(idx.claude).toBeUndefined()
    expect(indexVersions(undefined)).toEqual({})
  })
})
