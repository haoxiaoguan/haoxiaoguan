import 'reflect-metadata'
import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { buildContainer, type Container } from './container'
import { registerAllHandlers } from './ipc/registry'
import { appDataDir } from './platform/persistence/paths'
import { QUOTA_EVENTS } from '../shared/ipc-channels'
import { isOfficialTokenizerAvailable } from './contexts/apiProxy/domain/usage/token-estimator'

// userData location. Tests set HXG_USER_DATA_DIR to an isolated temp dir so
// parallel/sequential e2e launches don't share a SingletonLock or DB. In
// production it defaults to the real per-OS app data dir.
app.setPath('userData', process.env.HXG_USER_DATA_DIR || appDataDir())

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let services: Container | null = null

// Quit intent: distinguishes a real quit (menu/Cmd-Q) from a window-close that
// should hide-to-tray. Set true before app.quit() so the close handler lets it
// through.
let isQuitting = false

// Cached close behavior ('quit' | 'minimize'). Seeded from settings at startup
// and refreshed whenever settings change (see refreshCloseBehavior()).
let closeBehavior = 'quit'

// 30-minute periodic local-backup timer (mirrors Rust tokio::time::interval).
const BACKUP_INTERVAL_MS = 30 * 60 * 1000
let backupTimer: ReturnType<typeof setInterval> | null = null

// 5-minute periodic purge of expired pending OAuth sessions (credential manifest
// §5/§9.5 — the source used an async scheduler; there is no built-in equivalent).
const PENDING_OAUTH_PURGE_INTERVAL_MS = 5 * 60 * 1000
let pendingOAuthPurgeTimer: ReturnType<typeof setInterval> | null = null

// Deep-link URL captured before the renderer/container is ready (macOS can emit
// open-url before whenReady resolves). Flushed once the window exists.
let pendingDeepLink: string | null = null

const DEEP_LINK_SCHEME = 'haoxiaoguan'

function createWindow(silentStart: boolean): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 4, y: 14 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  // silent_start: launch hidden to the tray; otherwise show when ready.
  mainWindow.on('ready-to-show', () => {
    if (!silentStart) mainWindow?.show()
  })

  // close-to-tray: when behavior is not 'quit' and we are not actually quitting,
  // hide the window instead of destroying it.
  mainWindow.on('close', (e) => {
    if (!isQuitting && closeBehavior !== 'quit') {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  if (pendingDeepLink) {
    const url = pendingDeepLink
    pendingDeepLink = null
    mainWindow.webContents.once('did-finish-load', () => routeDeepLink(url))
  }
}

function showMainWindow(): void {
  if (mainWindow === null) {
    createWindow(false)
    return
  }
  if (!mainWindow.isVisible()) mainWindow.show()
  mainWindow.focus()
}

// System tray with a template icon (auto-adapts to light/dark menubar on macOS)
// and a Show/Quit context menu.
function createTray(): void {
  // No bundled asset in the skeleton; an empty template image keeps the tray
  // functional (the menu still works) without a missing-file crash.
  const icon = nativeImage.createEmpty()
  icon.setTemplateImage(true)
  tray = new Tray(icon)
  tray.setToolTip('号小管')
  const menu = Menu.buildFromTemplate([
    { label: '显示主窗口', click: () => showMainWindow() },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true
        app.quit()
      },
    },
  ])
  tray.setContextMenu(menu)
  tray.on('click', () => showMainWindow())
}

// Re-read the close behavior from settings (file-backed, always current). Called
// at startup and after the renderer applies an update_settings change.
function refreshCloseBehavior(): void {
  if (!services) return
  try {
    closeBehavior = services.settings.getCloseBehavior()
  } catch {
    closeBehavior = 'quit'
  }
}

// Apply the OS login-item state with two-phase rollback: set → verify via
// getLoginItemSettings → on mismatch, roll back to the previous state and throw
// so the caller can surface the failure.
function applyAutostart(enabled: boolean): void {
  if (process.platform === 'linux') {
    // setLoginItemSettings is a no-op on Linux in Electron; nothing to verify.
    app.setLoginItemSettings({ openAtLogin: enabled })
    return
  }
  const previous = app.getLoginItemSettings().openAtLogin
  app.setLoginItemSettings({ openAtLogin: enabled })
  const applied = app.getLoginItemSettings().openAtLogin
  if (applied !== enabled) {
    // Phase 2: roll back to the prior state.
    app.setLoginItemSettings({ openAtLogin: previous })
    throw new Error(`autostart toggle failed (wanted ${enabled}, got ${applied}); rolled back`)
  }
}

// Route a haoxiaoguan:// deep link. The credential context now implements
// import_deeplink (credential.importDeeplink), but the renderer still owns the
// import confirmation UX (manifest §8 leaves the pending-import confirm flow to
// the frontend), so the URL is forwarded to the renderer which drives the import.
function routeDeepLink(url: string): void {
  if (!url || !url.startsWith(`${DEEP_LINK_SCHEME}://`)) return
  showMainWindow()
  if (mainWindow) {
    mainWindow.webContents.send('deeplink:import', url)
  } else {
    pendingDeepLink = url
  }
}

// Non-IPC-registry channels: version, shell.open, and app relaunch.
function registerShellAndAppHandlers(): void {
  ipcMain.handle('app:getVersion', () => app.getVersion())
  ipcMain.handle('shell:open', async (_e, target: string) => {
    await shell.openExternal(target)
  })
  // WebDAV sync download returns needsRestart when the master key changed; the
  // sync context (not yet implemented) calls this to relaunch the app. Exposed
  // now so the sync layer can trigger it without touching lifecycle wiring.
  ipcMain.handle('app:relaunch', () => {
    isQuitting = true
    app.relaunch()
    app.exit(0)
  })
  // The renderer re-applies autostart through settings:setAutostart (handled in
  // the settings context). Expose the two-phase variant for lifecycle callers.
  ipcMain.handle('app:setAutostart', (_e, enabled: boolean) => {
    applyAutostart(enabled)
  })
}

// ── Single-instance lock (Windows/Linux deep-link + focus-existing) ──────────
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    // Windows/Linux deliver the deep link as a CLI arg to the second instance.
    const url = argv.find((a) => a.startsWith(`${DEEP_LINK_SCHEME}://`))
    if (url) routeDeepLink(url)
    showMainWindow()
  })

  // macOS deep-link delivery.
  app.on('open-url', (event, url) => {
    event.preventDefault()
    if (mainWindow) routeDeepLink(url)
    else pendingDeepLink = url
  })

  app.whenReady().then(async () => {
    // Register the custom URL scheme (dev needs the explicit exec path on win32).
    if (process.defaultApp && process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME, process.execPath, [
        join(process.argv[1]),
      ])
    } else {
      app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME)
    }

    services = await buildContainer()
    registerAllHandlers(services)
    registerShellAndAppHandlers()

    refreshCloseBehavior()
    // Apply persisted autostart preference at startup (best-effort; a rollback
    // failure is logged, never fatal).
    try {
      applyAutostart(services.settings.getAllSettings().autostart === 'true')
    } catch (e) {
      console.error('[autostart]', e)
    }

    const silentStart = (() => {
      try {
        return services.settings.getSilentStart()
      } catch {
        return false
      }
    })()

    createTray()
    createWindow(silentStart)

    // Token-refresh / health-scan scheduler (60s tick) — started on ready,
    // stopped on quit.
    services.tokenRefreshScheduler.start()

    // Per-platform quota scheduler (60s tick). Push quota:updated to the renderer
    // after each sweep so the UI re-pulls the affected quota states.
    services.platformQuotaScheduler.setOnRefreshed((accountIds) => {
      mainWindow?.webContents.send(QUOTA_EVENTS.updated, accountIds)
    })
    services.platformQuotaScheduler.start()

    // tokenizer 加载自检（一次性，打包后可观测是否降级）。
    if (isOfficialTokenizerAvailable()) {
      console.info('[apiProxy] token 估算：官方 tokenizer 已加载')
    } else {
      console.warn('[apiProxy] token 估算：官方 tokenizer 不可用，降级字符分类估算（usage 计数为近似值）')
    }

    // 本地 AI API 反代服务：尊重「API 服务」页开关，仅当 apiProxyEnabled 为 true
    // 时随就绪自启。启动失败（如端口耗尽）只记日志，不致命。
    if (services.settings.getApiProxyEnabled()) {
      services.apiProxyService.start().catch((e) => {
        console.error('[apiProxy] autostart failed:', e)
      })
    }

    // 30-minute periodic local backup. Run once immediately, then on interval.
    const runBackup = (): void => {
      services?.localBackup.periodicBackupIfNeeded().catch((e) => {
        console.error('[localBackup] periodic backup failed:', e)
      })
    }
    runBackup()
    backupTimer = setInterval(runBackup, BACKUP_INTERVAL_MS)

    // Periodic purge of expired pending OAuth sessions (replay/cleanup).
    const runPendingOAuthPurge = (): void => {
      services?.credentialOAuth.purgeExpired().catch((e) => {
        console.error('[credential] pending oauth purge failed:', e)
      })
    }
    runPendingOAuthPurge()
    pendingOAuthPurgeTimer = setInterval(
      runPendingOAuthPurge,
      PENDING_OAUTH_PURGE_INTERVAL_MS,
    )

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(false)
      else showMainWindow()
    })
  })
}

// Refresh the cached close behavior whenever the renderer updates settings.
// settings:updateSettings is an invoke handler (registry-owned); we observe the
// same channel name to re-sync our cached value after it runs.
ipcMain.on('settings:closeBehaviorChanged', () => refreshCloseBehavior())

app.on('before-quit', () => {
  isQuitting = true
  if (backupTimer) {
    clearInterval(backupTimer)
    backupTimer = null
  }
  if (pendingOAuthPurgeTimer) {
    clearInterval(pendingOAuthPurgeTimer)
    pendingOAuthPurgeTimer = null
  }
  services?.tokenRefreshScheduler.stop()
  services?.platformQuotaScheduler.stop()
  services?.apiProxyService.stop().catch((e) => {
    console.error('[apiProxy] stop on quit failed:', e)
  })
})

app.on('window-all-closed', () => {
  // With a tray + close-to-tray, do not auto-quit on window close (except when a
  // real quit is in progress). On non-macOS, only quit if behavior is 'quit'.
  if (process.platform !== 'darwin' && (isQuitting || closeBehavior === 'quit')) {
    app.quit()
  }
})
