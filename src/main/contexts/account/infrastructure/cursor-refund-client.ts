import type { Credential } from '../domain/credential'
import type { CursorRefundResult, CursorRefundStatus } from '../domain/cursor-refund'

// Cursor 一键退款客户端。对齐 9router/tk.sh：
//   POST {base}/pub/refund-cli/refund?fmt=text  body={"token":"<JWT>"}
// 响应为若干 `__KCR_KEY__=value` 行。base 默认 https://kc.haoxiaoguan.store，可用 KC_BASE 覆盖。
//
// 直连（不走账号绑定的代理）：退款服务器是自建后端，tk.sh 也用 `curl --noproxy '*'`；
// 用全局 fetch 且不套 per-account dispatcher，即为直连。
//
// 不在此处主动刷新 access token（对齐 tk.sh：原样发送用户持有的 token）：
//   ① 主动刷新若走全局 fetch 会绕过账号代理、把真实 IP 暴露给 Cursor（破坏反关联）；
//   ② 存储的 token 由配额刷新周期保鲜并持久化，退款时通常已新鲜；
//   ③ 万一 token 过期，服务端会回退款失败，用户刷新配额后重试即可。

const DEFAULT_BASE = 'https://kc.haoxiaoguan.store'
const REFUND_PATH = '/pub/refund-cli/refund?fmt=text'
const REFUND_TIMEOUT_MS = 120_000

function refundBaseUrl(): string {
  const env = process.env.KC_BASE?.trim()
  return env && env.length > 0 ? env.replace(/\/+$/, '') : DEFAULT_BASE
}

function normalizeStatus(raw: string | undefined): CursorRefundStatus {
  switch (raw) {
    case 'success':
      return 'success'
    case 'pending':
      return 'pending'
    case 'already_free':
      return 'already_free'
    case 'ratelimited':
      return 'ratelimited'
    default:
      return 'failed'
  }
}

/**
 * 解析退款接口的 text 响应（`__KCR_STATUS__=` / `__KCR_AMOUNT__=` / `__KCR_MSG__=` /
 * `__KCR_SPONSOR__=`）。纯函数，单测覆盖。空响应 → failed + 兜底文案。
 */
export function parseRefundResponse(text: string): CursorRefundResult {
  const pick = (key: string): string | undefined => {
    // key 只含字母/下划线，无正则元字符；逐行匹配取等号后的整段。
    const match = text.match(new RegExp(`^${key}=(.*)$`, 'm'))
    return match ? match[1].trim() : undefined
  }
  const status = normalizeStatus(pick('__KCR_STATUS__'))
  const amountUsd = pick('__KCR_AMOUNT__') || undefined
  const message = pick('__KCR_MSG__') || undefined
  const sponsorUrl = pick('__KCR_SPONSOR__') || undefined

  const result: CursorRefundResult = { status }
  if (amountUsd) result.amountUsd = amountUsd
  if (message) result.message = message
  if (sponsorUrl) result.sponsorUrl = sponsorUrl
  if (status === 'failed' && !message && text.trim().length === 0) {
    result.message = '退款请求失败或超时，请稍后重试'
  }
  return result
}

/** 对已解密凭证发起退款（CursorRefundFn 实现）。access token 即 credential.token。 */
export async function refundCursorCredential(credential: Credential): Promise<CursorRefundResult> {
  const accessToken = credential.token?.trim()
  if (!accessToken) {
    return { status: 'failed', message: 'Cursor 凭证缺少 access token，无法退款' }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REFUND_TIMEOUT_MS)
  try {
    const resp = await fetch(`${refundBaseUrl()}${REFUND_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: accessToken }),
      signal: controller.signal,
    })
    return parseRefundResponse(await resp.text())
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError'
    return {
      status: 'failed',
      message: aborted ? '退款请求超时，请稍后重试' : e instanceof Error ? e.message : String(e),
    }
  } finally {
    clearTimeout(timer)
  }
}
