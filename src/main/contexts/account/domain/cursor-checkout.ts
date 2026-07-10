// Cursor 充值（升级订阅）契约。
//
// Cursor 网页版结账入口是 https://cursor.com/api/auth/checkoutDeepControl（与登录用的
// loginDeepControl 同族，需浏览器已登录）。定价页的个人档位是客户端单选器
// tier-picker-individual：pro / pro_plus / ultra。
//
// 两种打开方式：
//   - 'embedded'：号小管内嵌 BrowserWindow，加载前注入该账号的 WorkosCursorSessionToken
//     cookie → 免登录、精确对应这个托管账号的结账页（付款仍由用户在页面完成）。
//   - 'chrome'：用系统 Chrome 打开结账 URL，充值的是 Chrome 里当前登录的 Cursor 账号
//     （无法免登录指定某个托管账号——外部浏览器的 cookie 无法安全注入）。
//
// 端口定义在域层；infrastructure/cursor-checkout-opener 实现（依赖 electron）。

export type CursorCheckoutTier = 'pro' | 'pro_plus' | 'ultra'
export type CursorCheckoutTarget = 'embedded' | 'chrome'

export interface CursorCheckoutParams {
  /** 账号解密后的 access token（JWT）；仅 'embedded' 需要（拼登录 cookie），'chrome' 忽略。 */
  accessToken: string
  tier: CursorCheckoutTier
  target: CursorCheckoutTarget
}

/** 打开 Cursor 充值页。由容器注入 infra 实现。 */
export type CursorCheckoutFn = (params: CursorCheckoutParams) => Promise<void>

// --- 纯函数（无 electron 依赖，便于单测）---

const CHECKOUT_URL = 'https://cursor.com/api/auth/checkoutDeepControl'

/**
 * 拼结账 URL。yearly=false=按月；tier 依据定价页 tier-picker-individual 的 value
 * (pro/pro_plus/ultra)。若 Cursor 改键名，结账页会回落默认档位（仍能打开）——真机确认后调整。
 */
export function cursorCheckoutUrl(tier: CursorCheckoutTier): string {
  return `${CHECKOUT_URL}?yearly=false&tier=${encodeURIComponent(tier)}`
}

/**
 * 从 access token(JWT) 的 sub 解析 WorkOS user id，构造 session cookie 值
 * `user_xxx%3A%3A<JWT>`（与 quota/http/cursor.ts buildSessionCookie 同源、同为 %3A%3A 编码）。
 * 解析失败或非 user_ 前缀 → undefined。
 */
export function buildCursorSessionTokenValue(accessToken: string): string | undefined {
  const seg = accessToken.split('.')[1]
  if (seg === undefined || seg.length === 0) return undefined
  try {
    const payload = JSON.parse(Buffer.from(seg, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >
    const sub = payload.sub
    if (typeof sub !== 'string') return undefined
    const userId = sub.split('|').pop() ?? sub
    if (!userId.startsWith('user_')) return undefined
    return `${userId}%3A%3A${accessToken}`
  } catch {
    return undefined
  }
}
