import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// atomicWrite (platform/fs/atomic-write.ts) writes to a shared `${path}.tmp`
// sibling before renaming it onto `path`. SettingsFileService.mutate()/save()
// does not serialise concurrent calls, so two overlapping settings writes
// (e.g. dragging a slider while blurring a text field — very reachable from
// PlatformSettingsDialog) race on that one shared tmp file: whichever
// atomicWrite call's writeFile+rename happens to land LAST wins, even if its
// snapshot of the settings object is the OLDER one — silently dropping
// whatever the other, actually-more-recent call wrote (or, as this test
// happens to surface, one call's rename() finds the shared tmp file already
// gone because the other call's rename already moved it away). Either
// failure mode is invisible during the running session (in-memory `cache`
// still has both changes) and only surfaces after a restart, when a fresh
// SettingsFileService reads whatever actually ended up on disk — exactly the
// "works now, gone after quitting" symptom reported.

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hxg-settings-race-'))
  vi.resetModules()
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  vi.doUnmock('node:fs/promises')
})

describe('SettingsFileService concurrent writes', () => {
  it('两个重叠的 updateSettings() 调用会在共享的 .tmp 文件上竞争，丢数据/报错（复现）', async () => {
    // fnA/fnB 对同一个 cache 对象的同步 mutation 顺序是确定的（先 A 后 B，JS 单线程
    // 保证），所以「B 的快照」必然包含 theme:dark，「A 的快照」必然不包含——用内容而
    // 不是调用序号来识别，不受 mkdir/writeFile 实际落盘顺序的不确定性影响。故意延迟
    // 更旧的那份（A 的），让它的 rename 落在 B 之后，制造「旧快照覆盖新快照」。
    vi.doMock('node:fs/promises', async () => {
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
      return {
        ...actual,
        writeFile: vi.fn(async (path: string, data: string | Buffer) => {
          if (typeof data === 'string' && data.includes('/Applications/Antigravity.app') && !data.includes('"theme": "dark"')) {
            await new Promise((r) => setTimeout(r, 40))
          }
          return actual.writeFile(path, data)
        }),
      }
    })
    const { SettingsFileService } = await import(
      '../../../src/main/contexts/settings/infrastructure/settings-file-service'
    )
    const { SettingsApplicationService } = await import(
      '../../../src/main/contexts/settings/application/settings-service'
    )

    const settingsPath = join(dir, 'settings.json')
    const file = new SettingsFileService(settingsPath)
    await file.load()
    const svc = new SettingsApplicationService(file)

    // Fired back-to-back without awaiting the first — exactly what happens
    // when a user interacts with two controls in PlatformSettingsDialog in
    // quick succession (both call settingsService.updateSettings independently).
    const pA = svc.updateSettings({ ide_path_antigravity: '/Applications/Antigravity.app' })
    const pB = svc.updateSettings({ theme: 'dark' })
    await Promise.all([pA, pB])

    // Simulate quit + relaunch: a brand-new instance reading the same file.
    const fresh = new SettingsFileService(settingsPath)
    await fresh.load()
    const freshSvc = new SettingsApplicationService(fresh)

    expect(freshSvc.getIdePath('antigravity')).toBe('/Applications/Antigravity.app')
    expect(freshSvc.getAllSettings().theme).toBe('dark')
  })
})
