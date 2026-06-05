import { autoUpdater } from 'electron-updater'

import type { UpdateStatus } from '../../../shared/api-types'

export interface UpdaterOptions {
  /** 更新源地址（generic provider）；空则用打包的 app-update.yml 默认。 */
  feedUrl?: string
  /** 是否已打包：dev（未打包）下 electron-updater 不工作，check/download no-op。 */
  isPackaged: boolean
}

// electron-updater 封装：把 autoUpdater 的事件投影成 UpdateStatus，通过 setStatusListener
// 推给渲染层。autoDownload 开启 → 发现新版即自动下载，下载完成由前端确认后 install。
export class UpdaterService {
  private status: UpdateStatus = { state: 'idle' }
  private listener: (s: UpdateStatus) => void = () => {}
  private readonly isPackaged: boolean

  constructor(opts: UpdaterOptions) {
    this.isPackaged = opts.isPackaged
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    if (opts.feedUrl && opts.feedUrl.trim().length > 0) {
      autoUpdater.setFeedURL({ provider: 'generic', url: opts.feedUrl.trim() })
    }
    this.wire()
  }

  setStatusListener(fn: (s: UpdateStatus) => void): void {
    this.listener = fn
  }

  getStatus(): UpdateStatus {
    return this.status
  }

  private emit(s: UpdateStatus): void {
    this.status = s
    try {
      this.listener(s)
    } catch {
      // 推送失败不影响更新流程
    }
  }

  private wire(): void {
    autoUpdater.on('checking-for-update', () => this.emit({ state: 'checking' }))
    autoUpdater.on('update-available', (info) =>
      this.emit({ state: 'available', version: info.version }),
    )
    autoUpdater.on('update-not-available', () => this.emit({ state: 'not-available' }))
    autoUpdater.on('download-progress', (p) =>
      this.emit({ state: 'downloading', percent: Math.round(p.percent) }),
    )
    autoUpdater.on('update-downloaded', (info) =>
      this.emit({ state: 'downloaded', version: info.version }),
    )
    autoUpdater.on('error', (err) =>
      this.emit({ state: 'error', error: err instanceof Error ? err.message : String(err) }),
    )
  }

  /** 检查更新（autoDownload 开启时，发现可用即自动开始下载）。dev 未打包时 no-op。 */
  async check(): Promise<void> {
    if (!this.isPackaged) return
    try {
      await autoUpdater.checkForUpdates()
    } catch (e) {
      this.emit({ state: 'error', error: e instanceof Error ? e.message : String(e) })
    }
  }

  /** 手动触发下载（通常 autoDownload 已自动开始）。 */
  async download(): Promise<void> {
    if (!this.isPackaged) return
    try {
      await autoUpdater.downloadUpdate()
    } catch (e) {
      this.emit({ state: 'error', error: e instanceof Error ? e.message : String(e) })
    }
  }

  /** 退出并安装已下载的更新。 */
  install(): void {
    autoUpdater.quitAndInstall()
  }
}
