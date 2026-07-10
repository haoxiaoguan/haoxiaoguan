import { BrowserWindow, session as electronSession, shell } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import {
  buildCursorSessionTokenValue,
  cursorCheckoutUrl,
  type CursorCheckoutParams,
  type CursorCheckoutTier,
} from '../domain/cursor-checkout'
import { wireCheckoutAutofill } from './cursor-checkout-autofill'

// Cursor 充值开窗器（CursorCheckoutFn 实现）。
//  - embedded：内嵌 BrowserWindow + 注入 WorkosCursorSessionToken cookie，免登录直达该账号结账页。
//  - chrome：用系统 Chrome 打开（充值 Chrome 里登录的账号），失败回退默认浏览器。
// URL/cookie 的纯逻辑在 domain/cursor-checkout（便于单测）；本文件只负责 electron 开窗/进程。

const execFileAsync = promisify(execFile)

/** 常见 Chrome 安装路径（Windows）。直接启动 chrome.exe 而非过 cmd/start，避免 URL 里的 `&`
 *  被 cmd 当命令分隔符（会丢 tier 参数并多开默认浏览器）。 */
function resolveWindowsChromePath(): string | undefined {
  const candidates = [
    join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
    join(
      process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
      'Google\\Chrome\\Application\\chrome.exe',
    ),
    join(
      process.env['LOCALAPPDATA'] ?? '',
      'Google\\Chrome\\Application\\chrome.exe',
    ),
  ]
  return candidates.find((p) => p.length > 0 && existsSync(p))
}

async function openInChrome(url: string): Promise<void> {
  // 各分支都把 URL 作为独立 argv 传给浏览器可执行文件（无 shell 解析），故 URL 里的
  // `&`/`?`/`=` 都安全，不会像 `cmd /c start` 那样被拆断。
  try {
    if (process.platform === 'darwin') {
      await execFileAsync('open', ['-a', 'Google Chrome', url])
      return
    }
    if (process.platform === 'win32') {
      const chromePath = resolveWindowsChromePath()
      if (chromePath !== undefined) {
        await execFileAsync(chromePath, [url])
        return
      }
      // 未找到 chrome.exe → 落到下方默认浏览器兜底
    } else if (process.platform === 'linux') {
      await execFileAsync('google-chrome', [url])
      return
    }
  } catch {
    // Chrome 未安装/启动失败 → 回退默认浏览器
  }
  await shell.openExternal(url)
}

// 内嵌窗口用独立 session 分区，避免不同账号 cookie 串味；不加 persist: 前缀=内存态。
let checkoutSeq = 0

async function openEmbedded(accessToken: string, tier: CursorCheckoutTier): Promise<void> {
  const value = buildCursorSessionTokenValue(accessToken)
  if (value === undefined) {
    throw new Error('无法从 Cursor 凭证解析登录态（WorkOS user id），无法免登录充值')
  }
  checkoutSeq += 1
  const partition = `cursor-checkout-${checkoutSeq}`
  const ses = electronSession.fromPartition(partition)
  await ses.cookies.set({
    url: 'https://cursor.com',
    name: 'WorkosCursorSessionToken',
    value,
    domain: '.cursor.com',
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'no_restriction',
  })
  const win = new BrowserWindow({
    width: 1040,
    height: 840,
    title: 'Cursor 充值',
    autoHideMenuBar: true,
    webPreferences: {
      partition,
      // 加载的是外部网页(cursor.com)，严格隔离、绝不给 node 能力。
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  // 关窗即清该内存 session（连同注入的登录 cookie），不让 token 常驻到 app 退出。
  win.on('closed', () => {
    void ses.clearStorageData().catch(() => {})
  })
  // 挂上「使用随机地址」按钮：主进程预拉日本地址、注入到结账页选支付宝并填表。
  wireCheckoutAutofill(win)
  // 不 await loadURL：窗口已创建/显示，成功不取决于加载完成。checkoutDeepControl 可能做
  // 客户端重定向、或用户中途关窗，都会让 loadURL 以 ERR_ABORTED(-3) reject——那是良性的，
  // 若把它当失败抛出会误报「充值失败」并卡住弹窗。故 fire-and-forget，仅吞掉 reject。
  void win.loadURL(cursorCheckoutUrl(tier)).catch(() => {})
}

/** CursorCheckoutFn 实现。 */
export async function openCursorCheckout(params: CursorCheckoutParams): Promise<void> {
  if (params.target === 'chrome') {
    await openInChrome(cursorCheckoutUrl(params.tier))
    return
  }
  await openEmbedded(params.accessToken, params.tier)
}
