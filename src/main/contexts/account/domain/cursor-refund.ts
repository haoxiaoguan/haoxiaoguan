import type { Credential } from './credential'

// Cursor 一键退款契约。退款业务逻辑全部在服务端（KC 后端），本端只负责：取出
// 账号的 Cursor access token（JWT）→ POST 给退款接口 → 解析结果回显。对齐用户脚本
// 9router/tk.sh（接口 /pub/refund-cli/refund，响应以 __KCR_*__ 行返回）。
//
// 端口定义在域层（依赖倒置）：application 依赖此类型，infrastructure 实现它。

/** 退款结果状态。对应 tk.sh 的 __KCR_STATUS__（未知/空响应归一为 failed）。 */
export type CursorRefundStatus =
  | 'success'
  | 'pending'
  | 'already_free'
  | 'ratelimited'
  | 'failed'

export interface CursorRefundResult {
  status: CursorRefundStatus
  /** 退款金额（美元，字符串，来自 __KCR_AMOUNT__）。success/pending 时可能有。 */
  amountUsd?: string | undefined
  /** 服务端下发的可读消息（__KCR_MSG__），失败/限流/已是 Free 时展示。 */
  message?: string | undefined
  /** 赞助作者链接（__KCR_SPONSOR__），可选展示。 */
  sponsorUrl?: string | undefined
}

/** 对已解密的凭证发起退款。由 infrastructure/cursor-refund-client 实现，容器注入。 */
export type CursorRefundFn = (credential: Credential) => Promise<CursorRefundResult>
