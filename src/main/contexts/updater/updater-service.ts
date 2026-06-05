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
  // 注意：不能用 class property 箭头函数初始化（`listener = () => {}`）——
  // bytecodePlugin(babel) 不支持「arrow inside class property」，会让 main bundle
  // 的 bytecode 编译失败。改在 constructor 里赋值。
  private listener: (s: UpdateStatus) => void
  private readonly isPackaged: boolean

  constructor(opts: UpdaterOptions) {
    this.listener = () => {}
    this.isPackaged = opts.isPackaged
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    this.setFeedUrl(opts.feedUrl)
    this.wire()
  }

  /**
   * 设置更新源（generic provider）。强制 HTTPS（回环地址例外，便于本地联调）——
   * 产物未签名时 HTTPS 是防 MITM 投毒更新的唯一防线。非法 / 非 HTTPS 源被忽略，
   * 回退打包的 app-update.yml；空串同样回退默认源。运行时改更新源可调用此方法。
   */
  setFeedUrl(url?: string): void {
    if (!url || url.trim().length === 0) return
    const raw = url.trim()
    let parsed: URL
    try {
      parsed = new URL(raw)
    } catch {
      return // 非法 URL：忽略，回退 app-update.yml
    }
    const isLoopback =
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '::1' ||
      parsed.hostname === '[::1]' // WHATWG URL 对 IPv6 字面量 hostname 带方括号
    if (parsed.protocol !== 'https:' && !isLoopback) {
      return // 非 HTTPS 非回环：拒绝（防 MITM；unsigned 无签名兜底）
    }
    autoUpdater.setFeedURL({ provider: 'generic', url: raw })
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
