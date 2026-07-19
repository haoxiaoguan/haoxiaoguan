import { ipcMain, app, dialog } from 'electron'
import { toIpcError } from '../../../ipc/error'
import { SETTINGS_CHANNELS, SYSTEM_CHANNELS } from '../../../../shared/ipc-channels'
import type { SettingsApplicationService, AppDirs } from '../application/settings-service'
import { appDataDir, appConfigDir, appLogDir } from '../../../platform/persistence/paths'
import { detectAppPath, type AppPathInfo } from '../../../platform/identity/app-paths'
import { migrateLegacyCodexIdePathIfNeeded } from '../../../platform/identity/codex-app-path-migration'

interface UpdateSettingsRequest {
  settings: Record<string, string>
}

export function registerSettingsHandlers(svc: SettingsApplicationService): void {
  ipcMain.handle(SETTINGS_CHANNELS.getSettings, async () => {
    try {
      const kv = svc.getAllSettings()
      // Reshape flat KV into the typed SettingsResponse the frontend expects.
      const refreshIntervals: Record<string, number> = {}
      const platformRefreshIntervals: Record<string, number> = {}
      const idePaths: Record<string, string> = {}
      const routingEnabled: Record<string, boolean> = {}
      const requireOnlineIdentityCheck: Record<string, boolean> = {}
      for (const [k, v] of Object.entries(kv)) {
        if (k.startsWith('platform_refresh_interval_')) {
          platformRefreshIntervals[k.slice('platform_refresh_interval_'.length)] = Number(v)
        } else if (k.startsWith('refresh_interval_')) {
          refreshIntervals[k.slice('refresh_interval_'.length)] = Number(v)
        } else if (k.startsWith('ide_path_')) {
          idePaths[k.slice('ide_path_'.length)] = v
        } else if (k.startsWith('require_online_check_')) {
          requireOnlineIdentityCheck[k.slice('require_online_check_'.length)] = v === 'true'
        } else if (k.startsWith('routing_enabled_')) {
          routingEnabled[k.slice('routing_enabled_'.length)] = v === 'true'
        }
      }
      // 兼容旧键（升级前持久化的单一 Codex 开关）：映射到 routingEnabled.codex。
      if (kv.codex_relay_injection_enabled === 'true' && routingEnabled.codex === undefined) {
        routingEnabled.codex = true
      }
      return {
        theme: kv.theme,
        language: kv.language,
        closeBehavior: kv.close_behavior,
        refreshIntervals,
        platformRefreshIntervals,
        idePaths,
        quotaRefreshConcurrency: Number(kv.quota_refresh_concurrency),
        silentStart: kv.silent_start === 'true',
        autostart: kv.autostart === 'true',
        utilityButtons: kv.utility_buttons,
        requireOnlineIdentityCheck,
        terminalLaunchTemplate: kv.terminal_launch_template,
        routingEnabled,
        codexLaunchOnSwitch: kv.codex_launch_on_switch === 'true',
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

  // Native file picker for the per-platform app/IDE launch path. On macOS the
  // dialog treats an .app bundle as a selectable file. Returns the chosen
  // absolute path, or null if the user cancels.
  ipcMain.handle(SYSTEM_CHANNELS.pickPath, async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // Auto-detect the app/IDE install path for a platform on the current OS. Pure
  // filesystem probing of well-known locations (no launch, no shell) — returns
  // the first existing candidate plus a placeholder suggestion for the UI.
  ipcMain.handle(SYSTEM_CHANNELS.detectAppPath, async (_e, platform: string): Promise<AppPathInfo> => {
    const info = await detectAppPath(platform)
    if (platform === 'codex') {
      // Codex→ChatGPT 改名：打开平台设置(触发探测)时对官方旧启动路径做守卫式自愈。
      // fire-and-forget：不阻塞探测响应；migrate 内部吞异常。
      void migrateLegacyCodexIdePathIfNeeded({
        getSavedPath: () => svc.getIdePath('codex'),
        savePath: (p) => svc.updateSettings({ ide_path_codex: p }),
        detect: async () => info,
      })
    }
    return info
  })
}
