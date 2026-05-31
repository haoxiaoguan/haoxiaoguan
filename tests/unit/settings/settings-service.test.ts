import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SettingsFileService } from '../../../src/main/contexts/settings/infrastructure/settings-file-service'
import { SettingsApplicationService } from '../../../src/main/contexts/settings/application/settings-service'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hxg-settings-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('SettingsApplicationService', () => {
  it('returns defaults when no file exists, then persists updates', async () => {
    const file = new SettingsFileService(join(dir, 'settings.json'))
    await file.load()
    const svc = new SettingsApplicationService(file)

    const before = svc.getAllSettings()
    expect(before.theme).toBe('system')

    await svc.updateSettings({ theme: 'dark', ws_port: '5000' })
    const after = svc.getAllSettings()
    expect(after.theme).toBe('dark')
    expect(after.ws_port).toBe('5000')

    // a fresh service over the same file sees the persisted values
    const file2 = new SettingsFileService(join(dir, 'settings.json'))
    await file2.load()
    const svc2 = new SettingsApplicationService(file2)
    expect(svc2.getAllSettings().theme).toBe('dark')
  })

  it('heals a corrupt settings file by replacing it with defaults', async () => {
    const path = join(dir, 'settings.json')
    writeFileSync(path, '{ not valid json', 'utf8')
    const file = new SettingsFileService(path)
    await file.load()
    const svc = new SettingsApplicationService(file)
    expect(svc.getAllSettings().theme).toBe('system')
  })
})
