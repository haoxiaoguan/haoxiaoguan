import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'
import { injectCursorAuthToVscdb } from '../../../src/main/agents/credential-injection/cursor-vscdb-inject'
import type { DecryptedCredential } from '../../../src/main/agents/credential-injection/credential-injection'

// 建一个仅含 ItemTable(key/value) 的临时 state.vscdb，模拟 Cursor 本地库。
function makeDb(seed?: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'cursor-vscdb-'))
  const path = join(dir, 'state.vscdb')
  const db = new Database(path)
  db.exec('CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value BLOB)')
  if (seed) {
    const ins = db.prepare('INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)')
    for (const [k, v] of Object.entries(seed)) ins.run(k, v)
  }
  db.close()
  return path
}

function readItem(path: string, key: string): string | null {
  const db = new Database(path, { readonly: true })
  const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  db.close()
  return row?.value ?? null
}

const created: string[] = []
function track(path: string): string {
  created.push(path)
  return path
}
afterEach(() => {
  for (const p of created.splice(0)) rmSync(p.replace(/state\.vscdb$/, ''), { recursive: true, force: true })
})

describe('injectCursorAuthToVscdb', () => {
  it('从 metadata.cursor_auth_raw 提取并 upsert 全部 cursorAuth/* + cursor.* 键', async () => {
    const path = track(makeDb({ 'cursorAuth/cachedEmail': 'old@x.com', 'cursor.email': 'old@x.com' }))
    const cred: DecryptedCredential = {
      token: 'ACCESS-NEW',
      refreshToken: 'REFRESH-NEW',
      metadata: JSON.stringify({
        cursor_auth_raw: {
          accessToken: 'ACCESS-NEW',
          refreshToken: 'REFRESH-NEW',
          cachedEmail: 'new@x.com',
          stripeMembershipType: 'pro',
          stripeSubscriptionStatus: 'active',
          cachedSignUpType: 'Auth_0',
        },
      }),
    }
    await injectCursorAuthToVscdb(cred, path)
    expect(readItem(path, 'cursorAuth/accessToken')).toBe('ACCESS-NEW')
    expect(readItem(path, 'cursorAuth/refreshToken')).toBe('REFRESH-NEW')
    expect(readItem(path, 'cursorAuth/cachedEmail')).toBe('new@x.com') // 覆盖了旧值
    expect(readItem(path, 'cursorAuth/stripeMembershipType')).toBe('pro')
    expect(readItem(path, 'cursorAuth/stripeSubscriptionStatus')).toBe('active')
    expect(readItem(path, 'cursorAuth/cachedSignUpType')).toBe('Auth_0')
    expect(readItem(path, 'cursor.accessToken')).toBe('ACCESS-NEW')
    expect(readItem(path, 'cursor.email')).toBe('new@x.com')
  })

  it('metadata 缺失/非 JSON 时退回用 token 作 accessToken，可选字段不写', async () => {
    const path = track(makeDb())
    await injectCursorAuthToVscdb({ token: 'ONLY-TOKEN' }, path)
    expect(readItem(path, 'cursorAuth/accessToken')).toBe('ONLY-TOKEN')
    expect(readItem(path, 'cursor.accessToken')).toBe('ONLY-TOKEN')
    // 无 email/refresh 等：相应键不写
    expect(readItem(path, 'cursorAuth/cachedEmail')).toBeNull()
    expect(readItem(path, 'cursorAuth/refreshToken')).toBeNull()
    expect(readItem(path, 'cursor.email')).toBeNull()
  })

  it('DB 不存在 → 抛错（提示先启动 Cursor）', async () => {
    await expect(
      injectCursorAuthToVscdb({ token: 't' }, '/tmp/__no_such_cursor_db__/state.vscdb'),
    ).rejects.toThrow(/不存在/)
  })

  it('凭证缺 accessToken（token 为空且 metadata 无 accessToken）→ 抛错', async () => {
    const path = track(makeDb())
    await expect(
      injectCursorAuthToVscdb({ token: '', metadata: JSON.stringify({ cursor_auth_raw: {} }) }, path),
    ).rejects.toThrow(/accessToken/)
  })
})
