import 'reflect-metadata'
import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, nativeTheme } from 'electron'
import { join } from 'node:path'
import { buildContainer, type Container } from './container'
import { registerAllHandlers } from './ipc/registry'
import { appDataDir } from './platform/persistence/paths'
import {
  QUOTA_EVENTS,
  USAGE_EVENTS,
  UPDATE_EVENTS,
  ROUTING_OBS_EVENTS,
  WINDOW_CHANNELS,
  WINDOW_EVENTS,
} from '../shared/ipc-channels'
import { isOfficialTokenizerAvailable } from './contexts/apiProxy/domain/usage/token-estimator'
import { routingEventFromRecord } from './contexts/apiProxy/domain/observability/routing-event'
import { RoutingEventBatcher } from './contexts/apiProxy/infrastructure/observability/routing-event-batcher'
import { UpdaterService } from './contexts/updater/updater-service'
import { registerUpdaterHandlers } from './contexts/updater/ipc/updater-handlers'

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

// 用量 session-log 同步：对齐 cc-switch 的 SESSION_SYNC_INTERVAL_SECS=60。
// 增量 per-file 游标使重复扫描很快；usageSyncRunning 重入保护避免首次全量未完成就叠跑。
const USAGE_SYNC_INTERVAL_MS = 60 * 1000
let usageSyncTimer: ReturnType<typeof setInterval> | null = null
let usageSyncRunning = false

// 路由日志分析：把内存缓冲的反代请求日志定时批量落库（明细 + 日桶 rollup）。
// 15s 一次平衡「实时性」与「写放大」；退出前再 flush 一次避免丢最后一批。
const ROUTING_LOG_FLUSH_INTERVAL_MS = 15 * 1000
let routingLogFlushTimer: ReturnType<typeof setInterval> | null = null

// 路由日志重构 observability v2：实时事件 200ms 合并推送器（统一实时出口 routingObs:event）。
let routingEventBatcher: RoutingEventBatcher | null = null

// Deep-link URL captured before the renderer/container is ready (macOS can emit
// open-url before whenReady resolves). Flushed once the window exists.
let pendingDeepLink: string | null = null

const DEEP_LINK_SCHEME = 'haoxiaoguan'

// Windows 原生标题栏覆盖按钮(min/max/close)所在标题栏高度，须与渲染层 Windows header
// 高度一致（见 AppShell 的 h-[48px]），按钮才会在 header 行内垂直居中。
const WINDOWS_TITLEBAR_HEIGHT = 48

/** 原生覆盖按钮配置：背景透明(露出 header 底色)，图标色随明暗主题。 */
function windowsOverlayOptions(isDark: boolean): {
  color: string
  symbolColor: string
  height: number
} {
  return {
    color: '#00000000',
    symbolColor: isDark ? '#e6e6e6' : '#2b2b2b',
    height: WINDOWS_TITLEBAR_HEIGHT,
  }
}

function createWindow(silentStart: boolean): void {
  // 去掉 Windows/Linux 的原生应用菜单栏(File/Edit/View/Window)。macOS 保留系统菜单不动。
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
  }
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    // macOS：hiddenInset(红绿灯,保持不变)。Windows：hidden + titleBarOverlay(系统原生
    // min/max/close 覆盖按钮)。Linux：hidden(无原生按钮)，由渲染层自绘(见 WindowControls)。
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    trafficLightPosition: { x: 4, y: 14 },
    ...(process.platform === 'win32'
      ? { titleBarOverlay: windowsOverlayOptions(nativeTheme.shouldUseDarkColors) }
      : {}),
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

  // 自绘窗口控制：把最大化态变化推给渲染层，切换 max/restore 图标。
  mainWindow.on('maximize', () => mainWindow?.webContents.send(WINDOW_EVENTS.maximizeChanged, true))
  mainWindow.on('unmaximize', () =>
    mainWindow?.webContents.send(WINDOW_EVENTS.maximizeChanged, false),
  )

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
    // Web URL(http/https/mailto)用 openExternal；本地路径(目录/文件)用 openPath——
    // openExternal 只认 URL scheme，传目录路径会失败，正是「打开文件夹」按钮报错的原因。
    // openPath 不抛错、用返回的非空字符串表示失败，这里转成 throw 让渲染层 catch 提示。
    if (/^(https?|mailto):/i.test(target)) {
      await shell.openExternal(target)
    } else {
      const err = await shell.openPath(target)
      if (err) throw new Error(err)
    }
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

  // 窗口控制：Linux 无原生标题栏，渲染层 header 的 min/max/close 调这些。
  ipcMain.handle(WINDOW_CHANNELS.minimize, () => mainWindow?.minimize())
  ipcMain.handle(WINDOW_CHANNELS.maximizeToggle, () => {
    if (!mainWindow) return
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  })
  ipcMain.handle(WINDOW_CHANNELS.close, () => mainWindow?.close())
  ipcMain.handle(WINDOW_CHANNELS.isMaximized, () => mainWindow?.isMaximized() ?? false)
  // 仅 Windows：应用主题切换时同步原生覆盖按钮的图标颜色（亮=深色图标，暗=浅色图标）。
  ipcMain.handle(WINDOW_CHANNELS.setOverlayTheme, (_e, isDark: boolean) => {
    if (!mainWindow || process.platform !== 'win32') return
    mainWindow.setTitleBarOverlay(windowsOverlayOptions(isDark))
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

    // 自动更新（G9）：UpdaterService 封装 electron-updater，状态推送给渲染层。
    // dev（未打包）下 check/download 内部 no-op。feedUrl 空则用打包的 app-update.yml。
    const updater = new UpdaterService({
      feedUrl: services.settings.getUpdateFeedUrl(),
      isPackaged: app.isPackaged,
    })
    updater.setStatusListener((s) => mainWindow?.webContents.send(UPDATE_EVENTS.status, s))
    registerUpdaterHandlers(updater)
    // 反代请求日志（G3）→ 渲染层日志页（闭包惰性读 mainWindow，窗口存在时才推）。
    // 统一实时出口：每条记录（已延迟到流末、带完整 token）喂 200ms 合并器 → routingObs:event。
    routingEventBatcher = new RoutingEventBatcher((batch) =>
      mainWindow?.webContents.send(ROUTING_OBS_EVENTS.event, batch),
    )
    services.apiProxyRequestLog.setListener((rec) => {
      routingEventBatcher?.push(routingEventFromRecord(rec))
    })
    // 启动后延迟检查（仅用户启用时；autoDownload 会在发现新版后自动下载）。
    if (services.settings.getAutoUpdateEnabled()) {
      setTimeout(() => {
        void updater.check()
      }, 10_000)
    }

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

    // 用量同步：启动后立即跑一次，然后每 60s 一次。首次为全量扫描（清库后重建），
    // 之后靠 per-file mtime 游标只处理变化的文件，并 rebuild 当日 rollup。
    // 对齐 cc-switch：用量 + 活动的同步统一由后端固定定时负责（UI 不再触发 syncAll），
    // 完成后推 usage:synced 让大屏只读刷新。usage 与 activity 各自独立容错，互不阻塞。
    const runBackgroundSync = async (): Promise<void> => {
      const svc = services
      if (!svc || usageSyncRunning) return
      usageSyncRunning = true
      try {
        try {
          // syncAll 扫描各 agent 本地日志写入 usage_records，
          // 同时经 UsageSyncService 注入的 analyticsIngest 追加写入 usage_events。
          await svc.usageSync.syncAll()
        } catch (e) {
          console.error('[usage] periodic sync failed:', e)
        }
        try {
          await svc.activitySync.syncAll()
        } catch (e) {
          console.error('[activity] periodic sync failed:', e)
        }
        // 推送渲染层：大屏据此只读刷新（最后同步时间 + 数字 + 趋势 + 工具/账号），与页内自动刷新开关无关。
        mainWindow?.webContents.send(USAGE_EVENTS.synced)
      } finally {
        usageSyncRunning = false
      }
    }
    void runBackgroundSync()
    usageSyncTimer = setInterval(() => void runBackgroundSync(), USAGE_SYNC_INTERVAL_MS)

    // 路由日志定时落库（非阻塞；flush 内部有重入保护，空缓冲直接返回）。
    routingLogFlushTimer = setInterval(() => {
      services?.routingObservabilityService.flush().catch((e) => {
        console.error('[routingObs] periodic flush failed:', e)
      })
    }, ROUTING_LOG_FLUSH_INTERVAL_MS)

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
  if (usageSyncTimer) {
    clearInterval(usageSyncTimer)
    usageSyncTimer = null
  }
  if (routingLogFlushTimer) {
    clearInterval(routingLogFlushTimer)
    routingLogFlushTimer = null
  }
  if (routingEventBatcher) {
    routingEventBatcher.dispose()
    routingEventBatcher = null
  }
  // 退出前最后落库一次（best-effort；异步不阻塞退出，最坏丢极少量未落库样本）。
  services?.routingObservabilityService.flush().catch((e) => {
    console.error('[routingObs] flush on quit failed:', e)
  })
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
