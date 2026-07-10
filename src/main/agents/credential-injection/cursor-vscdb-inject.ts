// Cursor 账号切换 —— 把认证写回 Cursor 的 state.vscdb(SQLite ItemTable)。
//
// 关键事实:Cursor 的登录态读自 state.vscdb 的 `cursorAuth/*` 键，而非 storage.json。
// 此前通用的 storage_json 注入只写了 storage.json 的 storage.serviceMachineId(机器码字段)，
// 对 auth 完全无效 —— 切换静默不生效。本实现对齐参考(cockpit-tools cursor_account::inject_to_cursor):
// 用 INSERT OR REPLACE upsert cursorAuth/*(+ cursor.*)。
//
// 注意:Cursor 在内存缓存 auth，切换需在 Cursor 重启后生效;若 Cursor 持有库锁，写入最多等待 busy_timeout。

import { existsSync } from 'node:fs'
import Database from 'better-sqlite3'
import type { DecryptedCredential } from './credential-injection'

interface CursorAuthFields {
  accessToken: string
  refreshToken?: string | undefined
  email?: string | undefined
  membershipType?: string | undefined
  subscriptionStatus?: string | undefined
  signUpType?: string | undefined
}

function pickString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim().length > 0 ? v : undefined
}

// credential.metadata 是 raw_metadata 的 JSON 串：cursor_auth_raw 里有本地扫描导入时读出的
// 原值；顶层字段（email/membershipType/…）是配额刷新回填的最新值。身份字段（尤其 cachedEmail）
// 从两处兜底读取——OAuth/Google 导入的凭证 cursor_auth_raw 里没有 cachedEmail，只读它会漏，
// 导致切号后 cursorAuth/cachedEmail 残留上一个账号（Cursor 按 cachedEmail 显示，看着像没切）。
function extractCursorAuth(credential: DecryptedCredential): CursorAuthFields {
  let meta: Record<string, unknown> = {}
  let raw: Record<string, unknown> = {}
  if (credential.metadata) {
    try {
      meta = JSON.parse(credential.metadata) as Record<string, unknown>
      const car = meta.cursor_auth_raw
      if (car !== null && typeof car === 'object' && !Array.isArray(car)) {
        raw = car as Record<string, unknown>
      }
    } catch {
      /* metadata 非 JSON:退回仅用 token */
    }
  }
  return {
    accessToken: pickString(raw.accessToken) ?? credential.token,
    refreshToken: pickString(raw.refreshToken) ?? credential.refreshToken,
    email: pickString(raw.cachedEmail) ?? pickString(raw.email) ?? pickString(meta.email),
    membershipType:
      pickString(raw.stripeMembershipType) ??
      pickString(meta.membershipType) ??
      pickString(meta.membership_type),
    subscriptionStatus:
      pickString(raw.stripeSubscriptionStatus) ??
      pickString(meta.subscriptionStatus) ??
      pickString(meta.subscription_status),
    signUpType: pickString(raw.cachedSignUpType) ?? pickString(meta.sign_up_type),
  }
}

export async function injectCursorAuthToVscdb(
  credential: DecryptedCredential,
  dbPath: string,
): Promise<void> {
  if (!existsSync(dbPath)) {
    throw new Error(`Cursor 本地数据库不存在，请先启动一次 Cursor：${dbPath}`)
  }
  const fields = extractCursorAuth(credential)
  if (!fields.accessToken) {
    throw new Error('Cursor 凭证缺少 accessToken，无法切换')
  }
  let db: Database.Database | null = null
  try {
    db = new Database(dbPath)
    db.pragma('busy_timeout = 4000')
    const upsert = db.prepare('INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)')
    const apply = db.transaction((f: CursorAuthFields) => {
      upsert.run('cursorAuth/accessToken', f.accessToken)
      if (f.refreshToken) upsert.run('cursorAuth/refreshToken', f.refreshToken)
      if (f.email) upsert.run('cursorAuth/cachedEmail', f.email)
      if (f.membershipType) upsert.run('cursorAuth/stripeMembershipType', f.membershipType)
      if (f.subscriptionStatus)
        upsert.run('cursorAuth/stripeSubscriptionStatus', f.subscriptionStatus)
      if (f.signUpType) upsert.run('cursorAuth/cachedSignUpType', f.signUpType)
      // cockpit 同时写的 cursor.* 副本
      upsert.run('cursor.accessToken', f.accessToken)
      if (f.email) upsert.run('cursor.email', f.email)
    })
    apply(fields)
  } catch (e) {
    throw new Error(
      `写入 Cursor 本地数据库失败（若 Cursor 正在运行，请关闭后重试）：${e instanceof Error ? e.message : String(e)}`,
    )
  } finally {
    db?.close()
  }
}
