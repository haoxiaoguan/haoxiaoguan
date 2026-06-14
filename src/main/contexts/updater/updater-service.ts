import { app } from 'electron'
import { autoUpdater } from 'electron-updater'

import type { UpdateStatus } from '../../../shared/api-types'

export interface UpdaterOptions {
  /** 更新源地址（generic provider）；空则用打包的 app-update.yml 默认。 */
  feedUrl?: string
  /** 是否已打包：dev（未打包）下 electron-updater 不工作，check/download no-op。 */
  isPackaged: boolean
}

// 版本元信息：在 update-available 时定型，贯穿 downloading / downloaded / error 各阶段
// 一并回传——否则 download-progress 只带 percent，整条 status 被替换会丢掉版本号/发布说明，
// 弹窗在下载阶段就无法继续展示「a → b」与更新内容。
interface UpdateMeta {
  version?: string
  currentVersion?: string
  releaseNotes?: string
  releaseName?: string
}

// electron-updater 的 releaseNotes 可能是字符串(GitHub 发布正文，常含简单 HTML)或
// { version, note } 数组(多版本累积)。统一规整成可直接展示的纯文本：拆 HTML、解转义、压空行。
function formatReleaseNotes(
  notes: string | Array<{ version?: string; note?: string | null }> | null | undefined,
): string | undefined {
  if (!notes) return undefined
  const raw = Array.isArray(notes)
    ? notes
        .map((n) => (n && typeof n.note === 'string' ? n.note : ''))
        .filter((s) => s.length > 0)
        .join('\n\n')
    : notes
  const text = raw
    .replace(/<\s*li[^>]*>/gi, '• ')
    .replace(/<\s*\/\s*(p|div|li|h[1-6]|ul|ol)\s*>/gi, '\n')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text.length > 0 ? text : undefined
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
  // 当前 update 周期的版本元信息（update-available 时定型；新一轮 checking 时清空）。
  private meta: UpdateMeta = {}

  constructor(opts: UpdaterOptions) {
    this.listener = () => {}
    this.isPackaged = opts.isPackaged
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    // 预发布通道:当前运行的就是预发布构建(版本含 `-`，如 0.1.1-beta.1)时允许发现 GitHub 预发布，
    // 实现「beta 用户留在 beta 通道、稳定用户只见正式版」。github provider 默认跳过 prerelease。
    autoUpdater.allowPrerelease = app.getVersion().includes('-')
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
    autoUpdater.on('checking-for-update', () => {
      this.meta = {} // 新一轮检查：清空上轮版本元信息
      this.emit({ state: 'checking' })
    })
    autoUpdater.on('update-available', (info) => {
      this.meta = {
        version: info.version,
        currentVersion: app.getVersion(),
        releaseNotes: formatReleaseNotes(info.releaseNotes),
        releaseName: info.releaseName ?? undefined,
      }
      this.emit({ state: 'available', ...this.meta })
    })
    autoUpdater.on('update-not-available', () => this.emit({ state: 'not-available' }))
    autoUpdater.on('download-progress', (p) =>
      this.emit({
        state: 'downloading',
        ...this.meta,
        percent: Math.round(p.percent),
        transferred: p.transferred,
        total: p.total,
        bytesPerSecond: Math.round(p.bytesPerSecond),
      }),
    )
    autoUpdater.on('update-downloaded', (info) => {
      this.meta = { ...this.meta, version: info.version }
      this.emit({ state: 'downloaded', ...this.meta })
    })
    autoUpdater.on('error', (err) =>
      this.emit({
        state: 'error',
        ...this.meta,
        error: err instanceof Error ? err.message : String(err),
      }),
    )
  }

  /** 检查更新（autoDownload 开启时，发现可用即自动开始下载）。dev 未打包时 no-op。 */
  async check(): Promise<void> {
    if (!this.isPackaged) return
    try {
      await autoUpdater.checkForUpdates()
    } catch (e) {
      this.emit({ state: 'error', ...this.meta, error: e instanceof Error ? e.message : String(e) })
    }
  }

  /** 手动触发下载（通常 autoDownload 已自动开始）。 */
  async download(): Promise<void> {
    if (!this.isPackaged) return
    try {
      await autoUpdater.downloadUpdate()
    } catch (e) {
      this.emit({ state: 'error', ...this.meta, error: e instanceof Error ? e.message : String(e) })
    }
  }

  /** 退出并安装已下载的更新。 */
  install(): void {
    autoUpdater.quitAndInstall()
  }
}
