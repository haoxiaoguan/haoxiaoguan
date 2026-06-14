import { app, net, shell } from 'electron'
import { createWriteStream } from 'node:fs'
import { join } from 'node:path'
import { autoUpdater } from 'electron-updater'

import type { UpdateStatus } from '../../../shared/api-types'

// 自身仓库（dmg 手动安装下载源；与 electron-builder.yml publish 一致）。
const GITHUB_OWNER = 'haoxiaoguan'
const GITHUB_REPO = 'haoxiaoguan'
const RELEASES_PAGE = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases`

const IS_MAC = process.platform === 'darwin'

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
  // mac 手动安装:已下载的 dmg 路径（install 时 openPath 打开让用户拖入 Applications）。
  private dmgPath: string | null = null

  constructor(opts: UpdaterOptions) {
    this.listener = () => {}
    this.isPackaged = opts.isPackaged
    // mac 未签名:Squirrel.Mac「下载后安装」会因签名校验失败。改走「我方下载 dmg + 用户手动拖入」，
    // 故关掉 autoDownload/autoInstallOnAppQuit 避免 electron-updater 触发 Squirrel 暂存。
    // win/linux 未签名仍可正常自动更新，保留自动下载 + quitAndInstall。
    autoUpdater.autoDownload = !IS_MAC
    autoUpdater.autoInstallOnAppQuit = !IS_MAC
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
      // mac:autoDownload 已关，由我方下载 dmg（带进度），完成后 install 时打开供拖入安装。
      if (IS_MAC && info.version) {
        void this.downloadDmg(info.version)
      }
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

  /**
   * 安装已下载的更新。
   * - win/linux：electron-updater quitAndInstall（退出并安装）。
   * - mac：打开已下载的 dmg（用户把 号小管 拖入 Applications 覆盖安装）；无 dmg 时兜底打开 Releases 页。
   */
  async install(): Promise<void> {
    if (IS_MAC) {
      if (this.dmgPath) {
        const err = await shell.openPath(this.dmgPath)
        if (err) {
          // openPath 失败（如文件被删）→ 兜底打开 Releases 页让用户手动下载。
          await shell.openExternal(RELEASES_PAGE)
        }
      } else {
        await shell.openExternal(RELEASES_PAGE)
      }
      return
    }
    autoUpdater.quitAndInstall()
  }

  // mac:从 GitHub Release 下载对应架构的 dmg（带进度），存到临时目录。完成 → state=downloaded
  // 且 manualInstall=true（弹窗提示拖入 Applications）；失败 → state=error。
  private async downloadDmg(version: string): Promise<void> {
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
    const fileName = `${GITHUB_REPO}-${version}-${arch}.dmg`
    const url = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/v${version}/${fileName}`
    const dest = join(app.getPath('temp'), fileName)
    try {
      await this.downloadFile(url, dest)
      this.dmgPath = dest
      this.emit({ state: 'downloaded', ...this.meta, version, manualInstall: true })
    } catch (e) {
      this.emit({
        state: 'error',
        ...this.meta,
        error: `下载安装包失败：${e instanceof Error ? e.message : String(e)}`,
      })
    }
  }

  // 用 Electron net（自动跟随 GitHub 资源 302 跳转到 CDN）流式下载到 dest，按 content-length 报进度。
  private downloadFile(url: string, dest: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const request = net.request(url)
      request.on('response', (response) => {
        const status = response.statusCode
        if (status < 200 || status >= 300) {
          reject(new Error(`HTTP ${status}`))
          return
        }
        const clHeader = response.headers['content-length']
        const total = Number(Array.isArray(clHeader) ? clHeader[0] : clHeader) || 0
        let transferred = 0
        const file = createWriteStream(dest)
        response.on('data', (chunk: Buffer) => {
          transferred += chunk.length
          file.write(chunk)
          this.emit({
            state: 'downloading',
            ...this.meta,
            percent: total > 0 ? Math.round((transferred / total) * 100) : 0,
            transferred,
            total,
          })
        })
        response.on('end', () => {
          file.end(() => resolve())
        })
        response.on('error', (err: Error) => {
          file.destroy()
          reject(err)
        })
      })
      request.on('error', reject)
      request.end()
    })
  }
}
