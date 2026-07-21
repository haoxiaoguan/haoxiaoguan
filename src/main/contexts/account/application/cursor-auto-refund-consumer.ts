// Cursor「额度用尽自动退款」消费者（application 端口实现）。
//
// 由 quota 配额刷新在算出整体态后回调（仅 cursor 平台）。门控走纯逻辑 policy；命中则
// 调退款客户端、把结果状态写回 profilePayload、持久化账号、并通知渲染层弹 toast。
// 依赖全部注入（container 装配），本文件不 import 任何 infrastructure。
//
// 类型定义在 quota 侧（CursorAutoRefundConsumer），此实现 satisfies 之，以避免
// quota → account 的层依赖（quota 只认结构类型，具体函数由 container 注入）。

import type { Account } from '../domain/account'
import type { Credential } from '../domain/credential'
import type { JsonValue } from '../domain/platform-account-profile'
import type { CursorRefundResult } from '../domain/cursor-refund'
import type { CursorAutoRefundConsumer } from '../../quota/application/quota-service'
import {
  readAutoRefundStatus,
  shouldAttemptAutoRefund,
} from '../domain/cursor-auto-refund-policy'

/** 自动退款完成后推给渲染层的通知（渲染层据 status 弹对应 toast）。 */
export interface CursorAutoRefundNotice {
  accountId: string
  status: string
  amountUsd?: string | undefined
  message?: string | undefined
}

export interface CursorAutoRefundConsumerDeps {
  /** 对已解密凭证发起退款（注入退款客户端）。 */
  refund: (credential: Credential) => Promise<CursorRefundResult>
  /** 持久化账号（写回 autoRefundStatus/autoRefundAt）。 */
  saveAccount: (account: Account) => Promise<void>
  /** 通知渲染层（container 转 webContents.send）。 */
  notify: (notice: CursorAutoRefundNotice) => void
}

function isPlainObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 从 profilePayload 读 membershipType（仅 plain object 且值为 string 时返回）。 */
function readMembershipType(profilePayload: JsonValue): string | undefined {
  if (!isPlainObject(profilePayload)) return undefined
  const value = profilePayload.membershipType
  return typeof value === 'string' ? value : undefined
}

/**
 * 组装自动退款消费者。返回的函数 satisfies quota 的 CursorAutoRefundConsumer。
 * 整段 try/catch：自动退款是配额刷新的旁路副作用，任何异常都不外抛（记 console.warn），
 * 以免拖垮配额刷新主流程。
 */
export function createCursorAutoRefundConsumer(
  deps: CursorAutoRefundConsumerDeps,
): CursorAutoRefundConsumer {
  // 进程内「账号级在途锁」。refreshQuota 除配额调度器外还经 IPC 暴露给渲染层手动刷新，
  // 两条路径可并发跑同一 cursor 账号；若无锁，二者都会在幂等标记落库前读到 lastStatus=undefined
  // → 都过门控 → 并发发两个退款请求。服务端 already_free 只是「顺序」幂等，并发窗口内兜不住。
  // 退款不可逆，故加锁：本账号退款在途时，后到的并发回调直接跳过。
  // check(has) 到 add 之间全是同步代码（无 await），Node 单线程下这段原子执行，故 check-then-add 无竞态。
  const inFlight = new Set<string>()

  const consumer: CursorAutoRefundConsumer = async ({ account, credential, quotaExhausted }) => {
    if (inFlight.has(account.id)) return
    try {
      const planTier = account.planTier
      const membershipType = readMembershipType(account.profilePayload)
      const lastStatus = readAutoRefundStatus(account.profilePayload)

      // 额度健康（充值/新计费周期后未耗尽）→ 清掉上一轮的终态幂等标记，为下次耗尽重新武装。
      // 否则退款成功后 autoRefundStatus=success 会永久压制：账号再充值/升级、开关仍开着也不会再退。
      if (!quotaExhausted) {
        if (lastStatus !== undefined) {
          account.clearAutoRefundStatus()
          await deps.saveAccount(account)
        }
        return
      }

      const attempt = shouldAttemptAutoRefund({
        enabled: account.autoRefundEnabled,
        quotaExhausted,
        planTier,
        membershipType,
        lastStatus,
      })
      if (!attempt) return

      inFlight.add(account.id)
      const result = await deps.refund(credential)
      // 先通知：退款已真实发生（不可逆），即便随后 saveAccount 失败也要让用户知道这次结果。
      deps.notify({
        accountId: account.id,
        status: result.status,
        ...(result.amountUsd !== undefined ? { amountUsd: result.amountUsd } : {}),
        ...(result.message !== undefined ? { message: result.message } : {}),
      })
      account.updateProfilePayload({
        autoRefundStatus: result.status,
        autoRefundAt: new Date().toISOString(),
      })
      await deps.saveAccount(account)
    } catch (e) {
      console.warn(
        `[account] cursor 自动退款失败（accountId=${account.id}）: ${e instanceof Error ? e.message : String(e)}`,
      )
    } finally {
      inFlight.delete(account.id)
    }
  }
  return consumer
}
