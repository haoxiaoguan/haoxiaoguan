import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { TraeLocalImportCapability } from '../../../src/main/contexts/credential/infrastructure/capabilities/trae-local-import'
import { GeminiLocalImportCapability } from '../../../src/main/contexts/credential/infrastructure/capabilities/gemini-local-import'
import { GitHubCopilotLocalImportCapability } from '../../../src/main/contexts/credential/infrastructure/capabilities/github-copilot-local-import'
import { ZedLocalImportCapability } from '../../../src/main/contexts/credential/infrastructure/capabilities/zed-local-import'
import { QoderLocalImportCapability } from '../../../src/main/contexts/credential/infrastructure/capabilities/qoder-local-import'
import { CodebuddyLocalImportCapability } from '../../../src/main/contexts/credential/infrastructure/capabilities/codebuddy-local-import'
import { WindsurfLocalImportCapability } from '../../../src/main/contexts/credential/infrastructure/capabilities/windsurf-local-import'
import { AntigravityLocalImportCapability } from '../../../src/main/contexts/credential/infrastructure/capabilities/antigravity-local-import'
import { AntigravityCredentialInjectionPort } from '../../../src/main/agents/credential-injection/antigravity-injection'
import { Credential } from '../../../src/main/contexts/account/domain/credential'
import {
  createOAuthInfo,
  createUnifiedTopicEntry,
  encodeLenDelimField,
  encodeStringField,
  parseOAuthTokenInfo,
  parseUserStatus,
} from '../../../src/main/contexts/credential/infrastructure/antigravity-protobuf'
import { byteCryptoEncryptV1 } from '../../../src/main/agents/credential-injection/trae-byte-crypto'

function fakeJwt(payload: Record<string, unknown>): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${enc({ alg: 'none' })}.${enc(payload)}.sig`
}

// 测试替身：secret 值按「已解密」处理（真实解密走 SafeStorage/Keychain，纯加解密
// 已在 vscode-secret-storage 测试中覆盖）。
const identityDecode = async (raw: string): Promise<string> => raw

let tmp: string
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'cred-local-'))
})
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

function makeStateVscdb(items: Record<string, string>): string {
  const dbPath = join(tmp, 'state.vscdb')
  const db = new Database(dbPath)
  db.exec('CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)')
  const insert = db.prepare('INSERT INTO ItemTable (key, value) VALUES (?, ?)')
  for (const [k, v] of Object.entries(items)) insert.run(k, v)
  db.close()
  return dbPath
}

describe('TraeLocalImportCapability', () => {
  const write = (root: Record<string, unknown>): string => {
    const p = join(tmp, 'storage.json')
    writeFileSync(p, JSON.stringify(root))
    return p
  }

  it('reads明文 JSON 的 iCubeAuthInfo://icube.cloudide', async () => {
    const path = write({
      'iCubeAuthInfo://icube.cloudide': {
        accessToken: 't-access',
        refreshToken: 't-refresh',
        userId: 't-1',
        NonPlainTextEmail: 'trae@example.com',
      },
      'iCubeServerData://icube.cloudide': { loginRegion: 'sg' },
      'iCubeAuthInfo://usertag': 'tag-x',
    })
    const cap = new TraeLocalImportCapability(path)
    const materials = await cap.scanLocal()
    expect(materials).toHaveLength(1)
    const m = materials[0]
    expect(m.provider).toBe('trae')
    expect(m.accessToken).toBe('t-access')
    expect(m.refreshToken).toBe('t-refresh')
    expect(m.email).toBe('trae@example.com')
    const meta = m.rawMetadata as Record<string, unknown>
    expect(meta.user_id).toBe('t-1')
    expect(meta.trae_usertag_raw).toBe('tag-x')
  })

  it('解密 ByteCrypto v1 base64 的 auth 值', async () => {
    const authPlain = JSON.stringify({ accessToken: 'enc-access', userId: 'u-2', email: 'e2@x.com' })
    const path = write({
      'iCubeAuthInfo://icube.cloudide': byteCryptoEncryptV1(authPlain),
    })
    const cap = new TraeLocalImportCapability(path)
    const materials = await cap.scanLocal()
    expect(materials).toHaveLength(1)
    expect(materials[0].accessToken).toBe('enc-access')
    expect(materials[0].email).toBe('e2@x.com')
  })

  it('真实客户端形状：token/expiredAt/account.username（无邮箱→用户名兜底）+ 明文 entitlement', async () => {
    // 对齐真机 storage.json：auth 为 ByteCrypto 密文，字段是 token/refreshToken/
    // expiredAt/userId/host/account.username（email 无 '@'）；entitlement/server 为明文 JSON 串。
    const authPlain = JSON.stringify({
      token: 'real-access-token',
      refreshToken: 'real-refresh',
      expiredAt: '2026-07-11T12:14:03.241Z',
      refreshExpiredAt: '2026-12-24T12:14:03.241Z',
      userId: '7481284779884135432',
      host: 'https://growsg-normal.trae.ai',
      account: { username: 'RuffianLiu', email: 'RuffianLiu' },
    })
    const path = write({
      'iCubeAuthInfo://icube.cloudide': byteCryptoEncryptV1(authPlain),
      'iCubeEntitlementInfo://icube.cloudide': JSON.stringify({ identityStr: 'Pro', identity: 1 }),
      'iCubeServerData://icube.cloudide': JSON.stringify({ entitlementInfo: { identityStr: 'Free' } }),
      'iCubeAuthInfo://usertag': 'opaque-tag',
      'iCubeAuthInfo://icube-dc:7513082638632044048': 'device-key-cipher',
    })
    const cap = new TraeLocalImportCapability(path)
    const materials = await cap.scanLocal()
    expect(materials).toHaveLength(1)
    const m = materials[0]
    expect(m.accessToken).toBe('real-access-token')
    expect(m.refreshToken).toBe('real-refresh')
    // email 无 '@' → 丢弃，回退 account.username
    expect(m.email).toBe('RuffianLiu')
    expect(m.expiresAt?.toISOString()).toBe('2026-07-11T12:14:03.241Z')
    const meta = m.rawMetadata as Record<string, unknown>
    expect(meta.user_id).toBe('7481284779884135432')
    expect(meta.nickname).toBe('RuffianLiu')
    expect(meta.plan_type).toBe('Pro')
    expect(meta.login_host).toBe('https://growsg-normal.trae.ai')
  })

  it('非默认 provider id 也能解析（iCubeAuthInfo://<other>）', async () => {
    const path = write({
      'iCubeAuthInfo://icube.custom': { accessToken: 'c-access', userId: 'c-1' },
    })
    const cap = new TraeLocalImportCapability(path)
    const materials = await cap.scanLocal()
    expect(materials[0]?.accessToken).toBe('c-access')
  })

  it('storage.json 缺失 → []', async () => {
    const cap = new TraeLocalImportCapability(join(tmp, 'nope.json'))
    expect(await cap.scanLocal()).toEqual([])
  })

  it('无 auth 键 → []', async () => {
    const path = write({ somethingElse: 1 })
    const cap = new TraeLocalImportCapability(path)
    expect(await cap.scanLocal()).toEqual([])
  })
})

describe('GeminiLocalImportCapability', () => {
  it('读 oauth_creds.json + google_accounts.json + settings.json', async () => {
    const idToken = fakeJwt({ email: 'g@example.com', sub: 'sub-1' })
    writeFileSync(
      join(tmp, 'oauth_creds.json'),
      JSON.stringify({
        access_token: 'g-access',
        refresh_token: 'g-refresh',
        id_token: idToken,
        token_type: 'Bearer',
        scope: 'a b',
        expiry_date: 1893456000000,
      }),
    )
    writeFileSync(join(tmp, 'google_accounts.json'), JSON.stringify({ active: 'g@example.com', old: [] }))
    writeFileSync(
      join(tmp, 'settings.json'),
      JSON.stringify({ security: { auth: { selectedType: 'oauth-personal' } } }),
    )
    const cap = new GeminiLocalImportCapability(tmp)
    const materials = await cap.scanLocal()
    expect(materials).toHaveLength(1)
    const m = materials[0]
    expect(m.provider).toBe('gemini_cli')
    expect(m.accessToken).toBe('g-access')
    expect(m.refreshToken).toBe('g-refresh')
    expect(m.email).toBe('g@example.com')
    const meta = m.rawMetadata as Record<string, unknown>
    expect(meta.selected_auth_type).toBe('oauth-personal')
    expect(meta.auth_id).toBe('sub-1')
    expect((meta.gemini_auth_raw as Record<string, unknown>).access_token).toBe('g-access')
  })

  it('email 从 id_token 兜底（无 google_accounts.json）', async () => {
    const idToken = fakeJwt({ email: 'fallback@x.com' })
    writeFileSync(join(tmp, 'oauth_creds.json'), JSON.stringify({ access_token: 'a', id_token: idToken }))
    const cap = new GeminiLocalImportCapability(tmp)
    const materials = await cap.scanLocal()
    expect(materials[0].email).toBe('fallback@x.com')
  })

  it('无 oauth_creds.json（非 macOS 无 keychain）→ []', async () => {
    const cap = new GeminiLocalImportCapability(join(tmp, 'empty'))
    // 在 macOS 上会尝试 keychain（通常无该条目 → []）；其它平台直接 []。
    expect(Array.isArray(await cap.scanLocal())).toBe(true)
  })
})

describe('GitHubCopilotLocalImportCapability', () => {
  it('state.vscdb 缺失 → []', async () => {
    const cap = new GitHubCopilotLocalImportCapability(join(tmp, 'missing.vscdb'))
    expect(await cap.scanLocal()).toEqual([])
  })
})

describe('ZedLocalImportCapability', () => {
  it('返回数组（无 keychain 条目 / 非 macOS → []）', async () => {
    const cap = new ZedLocalImportCapability('https://zed.invalid-test')
    const materials = await cap.scanLocal()
    expect(Array.isArray(materials)).toBe(true)
  })
})

describe('QoderLocalImportCapability', () => {
  // 真机形状：三个裸 key（secret://aicoding.auth.*），userInfo 含 token/refreshToken/
  // expireTime(字符串毫秒)/email/name/userTag，creditUsage 含 userQuota。
  it('读三个 secret 并映射 qoder profile/注入形状', async () => {
    const dbPath = makeStateVscdb({
      'secret://aicoding.auth.userInfo': JSON.stringify({
        id: '019c048b-5246-771d-9846-2579b4292b4f',
        name: 'RuffianLiu',
        token: 'q-token',
        refreshToken: 'q-refresh',
        expireTime: '1784582898000',
        email: 'user@example.com',
        userTag: 'Free',
        userType: 'personal_standard',
      }),
      'secret://aicoding.auth.userPlan': JSON.stringify({
        user_type: 'personal_professional',
        plan_tier_name: 'Pro',
      }),
      'secret://aicoding.auth.creditUsage': JSON.stringify({
        userId: '019c048b-5246-771d-9846-2579b4292b4f',
        userQuota: { total: 2000, used: 5, remaining: 1995, percentage: 0 },
      }),
    })
    const cap = new QoderLocalImportCapability(dbPath, identityDecode)
    const materials = await cap.scanLocal()
    expect(materials).toHaveLength(1)
    const m = materials[0]
    expect(m.provider).toBe('qoder')
    expect(m.email).toBe('user@example.com')
    expect(m.accessToken).toBe('q-token')
    expect(m.refreshToken).toBe('q-refresh')
    expect(m.expiresAt?.getTime()).toBe(1784582898000)
    const meta = m.rawMetadata as Record<string, unknown>
    expect(meta.user_id).toBe('019c048b-5246-771d-9846-2579b4292b4f')
    expect(meta.display_name).toBe('RuffianLiu')
    expect(meta.plan_type).toBe('Pro')
    expect(meta.credits_total).toBe(2000)
    expect(meta.credits_remaining).toBe(1995)
    expect((meta.auth_user_info_raw as Record<string, unknown>).token).toBe('q-token')
  })

  it('userInfo 缺 token → []', async () => {
    const dbPath = makeStateVscdb({
      'secret://aicoding.auth.userInfo': JSON.stringify({ email: 'x@y.com' }),
    })
    const cap = new QoderLocalImportCapability(dbPath, identityDecode)
    expect(await cap.scanLocal()).toEqual([])
  })

  it('state.vscdb 缺失 → []', async () => {
    const cap = new QoderLocalImportCapability(join(tmp, 'missing.vscdb'), identityDecode)
    expect(await cap.scanLocal()).toEqual([])
  })
})

describe('CodebuddyLocalImportCapability', () => {
  const sessionKeyIntl =
    'secret://{"extensionId":"tencent.planning-genie","key":"planning-genie.new.accessToken"}'
  const sessionKeyCn =
    'secret://{"extensionId":"tencent-cloud.coding-copilot","key":"planning-genie.new.accessTokencn"}'

  it('intl：第二候选键 + session JSON + uid+token 前缀剥离', async () => {
    const dbPath = makeStateVscdb({
      [sessionKeyIntl]: JSON.stringify({
        id: 'Tencent-Cloud.genie-ide',
        accessToken: 'uid-123+real-token',
        refreshToken: 'cb-refresh',
        domain: 'codebuddy.ai',
        expiresAt: 1784582898,
        account: { uid: 'uid-123', label: 'Ruffian', nickname: 'Ruffian' },
        auth: { accessToken: 'real-token', tokenType: 'Bearer' },
      }),
    })
    const cap = new CodebuddyLocalImportCapability('codebuddy', dbPath, identityDecode)
    const materials = await cap.scanLocal()
    expect(materials).toHaveLength(1)
    const m = materials[0]
    expect(m.provider).toBe('codebuddy')
    // parse_local_access_token 先取顶层 accessToken（uid+token），拆出真 token
    expect(m.accessToken).toBe('real-token')
    expect(m.refreshToken).toBe('cb-refresh')
    const meta = m.rawMetadata as Record<string, unknown>
    expect(meta.uid).toBe('uid-123')
    expect(meta.nickname).toBe('Ruffian')
    expect(meta.domain).toBe('codebuddy.ai')
  })

  it('cn：裸 token 字符串（无 JSON）也可导入', async () => {
    const dbPath = makeStateVscdb({ [sessionKeyCn]: 'bare-cn-token' })
    const cap = new CodebuddyLocalImportCapability('codebuddy_cn', dbPath, identityDecode)
    const materials = await cap.scanLocal()
    expect(materials).toHaveLength(1)
    expect(materials[0].provider).toBe('codebuddy_cn')
    expect(materials[0].accessToken).toBe('bare-cn-token')
  })

  it('无匹配键 → []', async () => {
    const dbPath = makeStateVscdb({ other: 'x' })
    const cap = new CodebuddyLocalImportCapability('codebuddy', dbPath, identityDecode)
    expect(await cap.scanLocal()).toEqual([])
  })
})

describe('WindsurfLocalImportCapability', () => {
  it('读明文 windsurfAuthStatus + windsurf_auth-* 登录提示', async () => {
    const dbPath = makeStateVscdb({
      windsurfAuthStatus: JSON.stringify({
        status: 'SignedIn',
        apiKey: 'ws-api-key',
        name: 'Ruffian',
        email: 'ws@example.com',
        apiServerUrl: 'https://server.codeium.com',
      }),
      'windsurf_auth-ruffianliu': JSON.stringify({ ok: true }),
    })
    const cap = new WindsurfLocalImportCapability(dbPath)
    const materials = await cap.scanLocal()
    expect(materials).toHaveLength(1)
    const m = materials[0]
    expect(m.provider).toBe('windsurf')
    expect(m.accessToken).toBe('ws-api-key')
    expect(m.email).toBe('ws@example.com')
    const meta = m.rawMetadata as Record<string, unknown>
    expect(meta.github_login).toBe('ruffianliu')
    expect(meta.windsurf_api_key).toBe('ws-api-key')
    expect(meta.windsurf_api_server_url).toBe('https://server.codeium.com')
    expect((meta.windsurf_auth_status_raw as Record<string, unknown>).status).toBe('SignedIn')
  })

  it('缺 apiKey → []', async () => {
    const dbPath = makeStateVscdb({ windsurfAuthStatus: JSON.stringify({ status: 'SignedOut' }) })
    const cap = new WindsurfLocalImportCapability(dbPath)
    expect(await cap.scanLocal()).toEqual([])
  })

  it('state.vscdb 缺失 → []', async () => {
    const cap = new WindsurfLocalImportCapability(join(tmp, 'missing.vscdb'))
    expect(await cap.scanLocal()).toEqual([])
  })
})

describe('antigravity protobuf codec', () => {
  it('createOAuthInfo → parseOAuthTokenInfo 往返', () => {
    const blob = createUnifiedTopicEntry(
      'oauthTokenInfoSentinelKey',
      createOAuthInfo('ya29.access', '1//refresh', 1779239682),
    )
    const info = parseOAuthTokenInfo(blob)
    expect(info?.accessToken).toBe('ya29.access')
    expect(info?.refreshToken).toBe('1//refresh')
    expect(info?.tokenType).toBe('Bearer')
    expect(info?.expiryUnixSeconds).toBe(1779239682)
  })

  it('parseUserStatus 读 email/name/plan（f3/f7/f36）', () => {
    const planMsg = Buffer.concat([
      encodeStringField(1, 'ws-ai-ultra-business-tier'),
      encodeStringField(2, 'Google AI Ultra for Business'),
    ])
    const payload = Buffer.concat([
      encodeStringField(3, 'anti veo'),
      encodeStringField(7, 'veo@example.asia'),
      encodeLenDelimField(36, planMsg),
    ])
    const status = parseUserStatus(createUnifiedTopicEntry('userStatusSentinelKey', payload))
    expect(status?.email).toBe('veo@example.asia')
    expect(status?.name).toBe('anti veo')
    expect(status?.planTierId).toBe('ws-ai-ultra-business-tier')
    expect(status?.planName).toBe('Google AI Ultra for Business')
  })
})

describe('AntigravityLocalImportCapability', () => {
  function makeUserStatus(email: string, name: string, tier: string, planName: string): string {
    const planMsg = Buffer.concat([encodeStringField(1, tier), encodeStringField(2, planName)])
    const payload = Buffer.concat([
      encodeStringField(3, name),
      encodeStringField(7, email),
      encodeLenDelimField(36, planMsg),
    ])
    return createUnifiedTopicEntry('userStatusSentinelKey', payload).toString('base64')
  }

  // 'antigravity'（旧版）平台会先探一次真实 Keychain（见下方专门的 describe）。这些
  // state.vscdb 专项测试要跟本机是否真的登录过旧版 Antigravity 完全无关，所以显式
  // 关掉 Keychain 分支，逼它们只走 state.vscdb 解析路径。
  const noKeychain = { readKeychainSecret: async () => undefined }

  it('从 protobuf state.vscdb 解析 access/refresh/expiry/email/plan', async () => {
    const dbPath = makeStateVscdb({
      'antigravityUnifiedStateSync.oauthToken': createUnifiedTopicEntry(
        'oauthTokenInfoSentinelKey',
        createOAuthInfo('ya29.real-access', '1//real-refresh', 1779239682),
      ).toString('base64'),
      'antigravityUnifiedStateSync.userStatus': makeUserStatus(
        'veo@example.asia',
        'anti veo',
        'ws-ai-ultra-business-tier',
        'Google AI Ultra for Business',
      ),
    })
    const cap = new AntigravityLocalImportCapability('antigravity', dbPath, noKeychain)
    const materials = await cap.scanLocal()
    expect(materials).toHaveLength(1)
    const m = materials[0]
    expect(m.provider).toBe('antigravity')
    expect(m.email).toBe('veo@example.asia')
    expect(m.accessToken).toBe('ya29.real-access')
    expect(m.refreshToken).toBe('1//real-refresh')
    expect(m.expiresAt?.getTime()).toBe(1779239682000)
    const meta = m.rawMetadata as Record<string, unknown>
    expect(meta.selected_auth_type).toBe('google')
    expect(meta.plan_name).toBe('Google AI Ultra for Business')
    expect(meta.tier_id).toBe('ws-ai-ultra-business-tier')
    expect((meta.antigravity_oauth_raw as Record<string, unknown>).refresh_token).toBe('1//real-refresh')
    expect((meta.antigravity_user_raw as Record<string, unknown>).name).toBe('anti veo')
  })

  it('antigravity_ide 平台 → provider=antigravity_ide', async () => {
    const dbPath = makeStateVscdb({
      'antigravityUnifiedStateSync.oauthToken': createUnifiedTopicEntry(
        'oauthTokenInfoSentinelKey',
        createOAuthInfo('ya29.ide-access', '1//ide-refresh', 1779239682),
      ).toString('base64'),
      'antigravityUnifiedStateSync.userStatus': makeUserStatus(
        'ide@example.com',
        'IDE User',
        'ws-ai-ultra-business-tier',
        'Google AI Ultra for Business',
      ),
    })
    const cap = new AntigravityLocalImportCapability('antigravity_ide', dbPath)
    const materials = await cap.scanLocal()
    expect(materials).toHaveLength(1)
    expect(materials[0].provider).toBe('antigravity_ide')
    expect(materials[0].email).toBe('ide@example.com')
    expect(materials[0].accessToken).toBe('ya29.ide-access')
  })

  it('oauthToken 缺失 → []', async () => {
    const dbPath = makeStateVscdb({ other: 'x' })
    const cap = new AntigravityLocalImportCapability('antigravity', dbPath, noKeychain)
    expect(await cap.scanLocal()).toEqual([])
  })

  it('state.vscdb 缺失 → []', async () => {
    const cap = new AntigravityLocalImportCapability('antigravity', join(tmp, 'missing.vscdb'), noKeychain)
    expect(await cap.scanLocal()).toEqual([])
  })

  // 旧版 antigravity（非 IDE）>= 2.0 把登录态挪到了 macOS Keychain（见
  // antigravity-system-credential.ts）。这里通过 overrides 注入假 Keychain 读取
  // 和假 transport，验证「Keychain 优先，读不到/解不出邮箱则 fallback 回
  // state.vscdb」的完整分支，不碰真实 Keychain / 网络。
  describe('legacy antigravity 走 Keychain（>= 2.0），fallback 回 state.vscdb', () => {
    function fakeUserinfoTransport(email: string) {
      return async (url: string) =>
        url.includes('userinfo')
          ? new Response(JSON.stringify({ email }), { status: 200 })
          : new Response(JSON.stringify({ access_token: 'ya29.refreshed', expires_in: 3600 }), { status: 200 })
    }

    it('Keychain 有解得出邮箱的凭据 → 用它，不碰 state.vscdb', async () => {
      const dbPath = makeStateVscdb({
        'antigravityUnifiedStateSync.oauthToken': createUnifiedTopicEntry(
          'oauthTokenInfoSentinelKey',
          createOAuthInfo('ya29.from-db', '1//from-db', 1779239682),
        ).toString('base64'),
        'antigravityUnifiedStateSync.userStatus': (() => {
          const payload = Buffer.concat([encodeStringField(3, 'DB User'), encodeStringField(7, 'db@example.com')])
          return createUnifiedTopicEntry('userStatusSentinelKey', payload).toString('base64')
        })(),
      })
      const secret = `go-keyring-base64:${Buffer.from(
        JSON.stringify({ token: { access_token: 'ya29.keychain', refresh_token: '1//keychain' } }),
      ).toString('base64')}`
      const cap = new AntigravityLocalImportCapability('antigravity', dbPath, {
        readKeychainSecret: async () => secret,
        systemCredentialOpts: { transport: fakeUserinfoTransport('keychain@example.com') },
      })
      const materials = await cap.scanLocal()
      expect(materials).toHaveLength(1)
      expect(materials[0].email).toBe('keychain@example.com')
      expect(materials[0].accessToken).toBe('ya29.refreshed')
    })

    it('Keychain 没有条目 → fallback 回 state.vscdb 解析', async () => {
      const dbPath = makeStateVscdb({
        'antigravityUnifiedStateSync.oauthToken': createUnifiedTopicEntry(
          'oauthTokenInfoSentinelKey',
          createOAuthInfo('ya29.from-db', '1//from-db', 1779239682),
        ).toString('base64'),
        'antigravityUnifiedStateSync.userStatus': (() => {
          const payload = Buffer.concat([encodeStringField(3, 'DB User'), encodeStringField(7, 'db@example.com')])
          return createUnifiedTopicEntry('userStatusSentinelKey', payload).toString('base64')
        })(),
      })
      const cap = new AntigravityLocalImportCapability('antigravity', dbPath, {
        readKeychainSecret: async () => undefined,
      })
      const materials = await cap.scanLocal()
      expect(materials).toHaveLength(1)
      expect(materials[0].email).toBe('db@example.com')
      expect(materials[0].accessToken).toBe('ya29.from-db')
    })

    it('Keychain 有条目但 token 彻底失效（userinfo 解不出邮箱）→ fallback 回 state.vscdb', async () => {
      const dbPath = makeStateVscdb({
        'antigravityUnifiedStateSync.oauthToken': createUnifiedTopicEntry(
          'oauthTokenInfoSentinelKey',
          createOAuthInfo('ya29.from-db', '1//from-db', 1779239682),
        ).toString('base64'),
        'antigravityUnifiedStateSync.userStatus': (() => {
          const payload = Buffer.concat([encodeStringField(3, 'DB User'), encodeStringField(7, 'db@example.com')])
          return createUnifiedTopicEntry('userStatusSentinelKey', payload).toString('base64')
        })(),
      })
      const secret = `go-keyring-base64:${Buffer.from(
        JSON.stringify({ token: { access_token: 'ya29.dead' } }),
      ).toString('base64')}`
      const cap = new AntigravityLocalImportCapability('antigravity', dbPath, {
        readKeychainSecret: async () => secret,
        systemCredentialOpts: { transport: async () => new Response('unauthorized', { status: 401 }) },
      })
      const materials = await cap.scanLocal()
      expect(materials).toHaveLength(1)
      expect(materials[0].email).toBe('db@example.com')
    })

    it('antigravity_ide 平台永远不查 Keychain', async () => {
      const dbPath = makeStateVscdb({
        'antigravityUnifiedStateSync.oauthToken': createUnifiedTopicEntry(
          'oauthTokenInfoSentinelKey',
          createOAuthInfo('ya29.ide', '1//ide', 1779239682),
        ).toString('base64'),
        'antigravityUnifiedStateSync.userStatus': (() => {
          const payload = Buffer.concat([encodeStringField(3, 'IDE User'), encodeStringField(7, 'ide@example.com')])
          return createUnifiedTopicEntry('userStatusSentinelKey', payload).toString('base64')
        })(),
      })
      let keychainCalls = 0
      const cap = new AntigravityLocalImportCapability('antigravity_ide', dbPath, {
        readKeychainSecret: async () => {
          keychainCalls += 1
          return undefined
        },
      })
      const materials = await cap.scanLocal()
      expect(keychainCalls).toBe(0)
      expect(materials[0].email).toBe('ide@example.com')
    })
  })
})

describe('AntigravityCredentialInjectionPort', () => {
  function readItem(dbPath: string, key: string): string | undefined {
    const db = new Database(dbPath, { readonly: true })
    try {
      const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get(key) as
        | { value: string }
        | undefined
      return row?.value
    } finally {
      db.close()
    }
  }

  it('写回 oauthToken/userStatus/onboarding，并保留同 topic 其它 sentinel', async () => {
    // 既有 oauthToken topic：一个 authState sentinel（应保留）+ 旧的 oauthTokenInfo（应替换）。
    const existingTopic = Buffer.concat([
      createUnifiedTopicEntry('authStateWithContextSentinelKey', encodeStringField(1, 'signedIn')),
      createUnifiedTopicEntry('oauthTokenInfoSentinelKey', createOAuthInfo('ya29.OLD', '1//OLD', 111)),
    ])
    const dbPath = makeStateVscdb({
      'antigravityUnifiedStateSync.oauthToken': existingTopic.toString('base64'),
      'jetskiStateSync.agentManagerInitState': 'stale',
    })

    const cred = new Credential('ya29.NEW', '1//NEW', new Date(1779239682000), {
      email: 'ide@example.com',
      antigravity_oauth_raw: { access_token: 'ya29.NEW', refresh_token: '1//NEW' },
      antigravity_user_raw: { email: 'ide@example.com' },
    })
    const port = new AntigravityCredentialInjectionPort('antigravity_ide', dbPath)
    await port.inject('antigravity_ide', cred)

    // oauthToken：新 token 生效，旧 authState sentinel 仍在。
    const tokenB64 = readItem(dbPath, 'antigravityUnifiedStateSync.oauthToken')!
    const info = parseOAuthTokenInfo(Buffer.from(tokenB64, 'base64'))!
    expect(info.accessToken).toBe('ya29.NEW')
    expect(info.refreshToken).toBe('1//NEW')
    expect(info.expiryUnixSeconds).toBe(1779239682)
    // authState sentinel 未被删除（明文里能找到）。
    expect(Buffer.from(tokenB64, 'base64').toString('latin1')).toContain('authStateWithContextSentinelKey')

    // userStatus 写了新 email；onboarding=true；jetski 初始化态被删。
    const statusB64 = readItem(dbPath, 'antigravityUnifiedStateSync.userStatus')!
    expect(parseUserStatus(Buffer.from(statusB64, 'base64'))?.email).toBe('ide@example.com')
    expect(readItem(dbPath, 'antigravityOnboarding')).toBe('true')
    expect(readItem(dbPath, 'jetskiStateSync.agentManagerInitState')).toBeUndefined()
  })
})
