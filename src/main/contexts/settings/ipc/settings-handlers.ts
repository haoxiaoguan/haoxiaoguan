import { ipcMain, app } from 'electron'
import { toIpcError } from '../../../ipc/error'
import { SETTINGS_CHANNELS, SYSTEM_CHANNELS } from '../../../../shared/ipc-channels'
import type { SettingsApplicationService, AppDirs } from '../application/settings-service'
import { appDataDir, appConfigDir, appLogDir } from '../../../platform/persistence/paths'

interface UpdateSettingsRequest {
  settings: Record<string, string>
}

export function registerSettingsHandlers(svc: SettingsApplicationService): void {
  ipcMain.handle(SETTINGS_CHANNELS.getSettings, async () => {
    try {
      const kv = svc.getAllSettings()
      // Reshape flat KV into the typed SettingsResponse the frontend expects.
      const refreshIntervals: Record<string, number> = {}
      for (const [k, v] of Object.entries(kv)) {
        if (k.startsWith('refresh_interval_')) {
          refreshIntervals[k.slice('refresh_interval_'.length)] = Number(v)
        }
      }
      return {
        theme: kv.theme,
        language: kv.language,
        closeBehavior: kv.close_behavior,
        wsPort: Number(kv.ws_port),
        refreshIntervals,
        silentStart: kv.silent_start === 'true',
        autostart: kv.autostart === 'true',
        utilityButtons: kv.utility_buttons,
      }
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  ipcMain.handle(SETTINGS_CHANNELS.updateSettings, async (_e, req: UpdateSettingsRequest) => {
    try {
      await svc.updateSettings(req.settings)
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  ipcMain.handle(SETTINGS_CHANNELS.setAutostart, async (_e, enabled: boolean) => {
    try {
      app.setLoginItemSettings({ openAtLogin: enabled })
      await svc.updateSettings({ autostart: String(enabled) })
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  ipcMain.handle(SYSTEM_CHANNELS.getAppDirs, async (): Promise<AppDirs> => {
    return { dataDir: appDataDir(), configDir: appConfigDir(), logDir: appLogDir() }
  })
}
