import { describe, it, expect } from 'vitest'
import { verifyUpgrade } from '../../../src/main/contexts/clientConfig/application/client-version-service'
import type { ClientVersionInfo } from '../../../src/main/contexts/clientConfig/domain/client-version'

const ver = (p: Partial<ClientVersionInfo>): ClientVersionInfo => ({
  clientId: 'claude',
  upgradable: false,
  installedButBroken: false,
  ...p,
})

describe('verifyUpgrade（升级后校验，杀「显示成功但实际没升」假成功）', () => {
  it('命令本就失败 → 原样返回', () => {
    const r = verifyUpgrade({ ok: false, detail: 'boom' }, ver({ installedVersion: '1.0.0' }))
    expect(r).toEqual({ ok: false, detail: 'boom' })
  })

  it('命令成功 + 已到最新（不再可升级）→ 成功', () => {
    const r = verifyUpgrade({ ok: true }, ver({ installedVersion: '2.1.179', latestVersion: '2.1.179', upgradable: false }))
    expect(r.ok).toBe(true)
  })

  it('命令成功但版本仍可升级（升到别处了）→ 失败 + 提示多处安装', () => {
    const r = verifyUpgrade(
      { ok: true },
      ver({ installedVersion: '2.1.90', latestVersion: '2.1.179', upgradable: true }),
    )
    expect(r.ok).toBe(false)
    expect(r.detail).toContain('2.1.90')
    expect(r.detail).toContain('2.1.179')
    expect(r.detail).toContain('诊断安装冲突')
  })

  it('命令成功但升级后跑不起来（如 bun 阻断 postinstall）→ 失败', () => {
    const r = verifyUpgrade({ ok: true }, ver({ installedButBroken: true }))
    expect(r.ok).toBe(false)
    expect(r.detail).toContain('无法运行')
  })

  it('命令成功但探不到版本 → 失败', () => {
    const r = verifyUpgrade({ ok: true }, ver({ installedVersion: undefined }))
    expect(r.ok).toBe(false)
  })

  it('latest 未知（离线）+ 无升级前版本 → 无从校验，沿用命令退出码（成功）', () => {
    const r = verifyUpgrade({ ok: true }, ver({ installedVersion: '2.1.90', latestVersion: undefined, upgradable: false }))
    expect(r.ok).toBe(true)
  })

  it('latest 未知 + 升级前后版本没变 → 失败（杀「显示成功但版本原地不动」的假成功）', () => {
    const r = verifyUpgrade(
      { ok: true },
      ver({ installedVersion: '2.1.158', latestVersion: undefined, upgradable: false }),
      '2.1.158',
    )
    expect(r.ok).toBe(false)
    expect(r.detail).toContain('未发生变化')
    expect(r.detail).toContain('诊断安装冲突')
  })

  it('latest 未知 + 版本确实前进了 → 成功', () => {
    const r = verifyUpgrade(
      { ok: true },
      ver({ installedVersion: '2.1.181', latestVersion: undefined, upgradable: false }),
      '2.1.158',
    )
    expect(r.ok).toBe(true)
  })

  it('latest 已知已最新 + 版本与升级前相同（已最新/重复升级）→ 不误判，成功', () => {
    const r = verifyUpgrade(
      { ok: true },
      ver({ installedVersion: '2.1.181', latestVersion: '2.1.181', upgradable: false }),
      '2.1.181',
    )
    expect(r.ok).toBe(true)
  })
})
