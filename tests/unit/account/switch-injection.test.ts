import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Credential } from '../../../src/main/contexts/account/domain/credential'
import { ZedCredentialInjectionPort } from '../../../src/main/agents/credential-injection/zed-injection'
import { GeminiCredentialInjectionPort } from '../../../src/main/agents/credential-injection/gemini-injection'
import { KiroCredentialInjectionPort } from '../../../src/main/agents/credential-injection/kiro-injection'
import { CodebuddyCredentialInjectionPort } from '../../../src/main/agents/credential-injection/codebuddy-injection'
import { QoderCredentialInjectionPort } from '../../../src/main/agents/credential-injection/qoder-injection'
import { GitHubCopilotCredentialInjectionPort } from '../../../src/main/agents/credential-injection/github-copilot-injection'
import { WindsurfCredentialInjectionPort } from '../../../src/main/agents/credential-injection/windsurf-injection'
import { TraeCredentialInjectionPort } from '../../../src/main/agents/credential-injection/trae-injection'
import {
  byteCryptoEncryptV1,
  byteCryptoDecrypt,
} from '../../../src/main/agents/credential-injection/trae-byte-crypto'
import type { KeychainCommandRunner } from '../../../src/main/agents/credential-injection/mac-keychain'
import type { VscdbWriteOps, VscdbWriter } from '../../../src/main/agents/credential-injection/vscdb-secret-writer'
import {
  __encryptV10ForTest,
  __decryptV10ForTest,
} from '../../../src/main/contexts/credential/infrastructure/vscode-secret-storage'

// 捕获 vscdb 写入的假 writer（不触发 keychain 加密），用于断言注入的 key 与明文结构。
function fakeVscdbWriter(): { writer: VscdbWriter; calls: Array<{ dbPath: string; mode: string; ops: VscdbWriteOps }> } {
  const calls: Array<{ dbPath: string; mode: string; ops: VscdbWriteOps }> = []
  const writer: VscdbWriter = async (dbPath, mode, ops) => {
    calls.push({ dbPath, mode, ops })
  }
  return { writer, calls }
}

// 记录 security 调用的假 Keychain，available=true 以驱动真实分支（不碰真机 Keychain）。
class FakeKeychain implements KeychainCommandRunner {
  readonly available = true
  readonly calls: string[][] = []
  async run(args: string[]): Promise<void> {
    this.calls.push(args)
  }
}

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('ZedCredentialInjectionPort', () => {
  it('macOS: 写 internet-password（先删后加，server=https://zed.dev, account=user_id）', async () => {
    const kc = new FakeKeychain()
    const port = new ZedCredentialInjectionPort(kc)
    await port.inject('zed', new Credential('zed-access-token', undefined, undefined, { user_id: 'zed-user-1' }))

    expect(kc.calls[0][0]).toBe('delete-internet-password')
    const add = kc.calls.find((c) => c[0] === 'add-internet-password')!
    expect(add).toContain('https://zed.dev')
    expect(add).toContain('zed-user-1')
    expect(add).toContain('zed-access-token')
  })

  it('非 macOS 回退：写 ~/.zed/credentials.json {"token"}', async () => {
    const dir = tmp('hxg-zed-')
    const fallback = join(dir, 'credentials.json')
    const noop: KeychainCommandRunner = { available: false, run: async () => undefined }
    const port = new ZedCredentialInjectionPort(noop, fallback)
    try {
      await port.inject('zed', new Credential('tk', undefined, undefined, { user_id: 'u' }))
      expect(JSON.parse(readFileSync(fallback, 'utf8'))).toEqual({ token: 'tk' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('GeminiCredentialInjectionPort', () => {
  it('写 oauth_creds.json / google_accounts.json / settings.json + Keychain，并清 file-keychain', async () => {
    const dir = tmp('hxg-gemini-')
    const kc = new FakeKeychain()
    // 预置一个 file-keychain 与旧 active，验证清理与 old 归并。
    writeFileSync(join(dir, 'gemini-credentials.json'), '{}')
    writeFileSync(join(dir, 'google_accounts.json'), JSON.stringify({ active: 'old@x.com', old: [] }))
    const port = new GeminiCredentialInjectionPort(dir, kc)
    try {
      await port.inject(
        'gemini_cli',
        new Credential('g-access', 'g-refresh', undefined, {
          email: 'new@x.com',
          gemini_auth_raw: {
            access_token: 'g-access',
            refresh_token: 'g-refresh',
            id_token: 'g-id',
            token_type: 'Bearer',
            scope: 'a b',
            expiry_date: 1893456000000,
          },
        }),
      )

      const creds = JSON.parse(readFileSync(join(dir, 'oauth_creds.json'), 'utf8'))
      expect(creds.access_token).toBe('g-access')
      expect(creds.refresh_token).toBe('g-refresh')
      expect(creds.id_token).toBe('g-id')
      expect(creds.expiry_date).toBe(1893456000000)

      const accounts = JSON.parse(readFileSync(join(dir, 'google_accounts.json'), 'utf8'))
      expect(accounts.active).toBe('new@x.com')
      expect(accounts.old).toContain('old@x.com')

      const settings = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))
      expect(settings.security.auth.selectedType).toBe('oauth-personal')

      expect(existsSync(join(dir, 'gemini-credentials.json'))).toBe(false)

      const add = kc.calls.find((c) => c[0] === 'add-generic-password')!
      expect(add).toContain('gemini-cli-oauth')
      expect(add).toContain('main-account')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('settings.json 已存在时保留其它设置，仅 merge selectedType', async () => {
    const dir = tmp('hxg-gemini2-')
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ theme: 'dark', security: { other: 1 } }))
    const port = new GeminiCredentialInjectionPort(dir, { available: false, run: async () => undefined })
    try {
      await port.inject('gemini_cli', new Credential('g', undefined, undefined, { email: 'e@x.com' }))
      const settings = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))
      expect(settings.theme).toBe('dark')
      expect(settings.security.other).toBe(1)
      expect(settings.security.auth.selectedType).toBe('oauth-personal')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('KiroCredentialInjectionPort', () => {
  it('写 ~/.aws/sso/cache/kiro-auth-token.json（覆盖 token，保留 region/provider 骨架）', async () => {
    const dir = tmp('hxg-kiro-')
    const authPath = join(dir, 'kiro-auth-token.json')
    const profileDir = join(dir, 'globalStorage', 'kiro.kiroagent')
    mkdirSync(profileDir, { recursive: true })
    const profilePath = join(profileDir, 'profile.json')
    const port = new KiroCredentialInjectionPort(authPath, profilePath)
    try {
      await port.inject(
        'kiro',
        new Credential('kiro-access-new', 'kiro-refresh-new', new Date(1893456000000), {
          region: 'eu-west-1',
          profileArn: 'arn:aws:codewhisperer:eu-west-1:123:profile/x',
          kiro_auth_token_raw: {
            accessToken: 'kiro-access-old',
            refreshToken: 'kiro-refresh-old',
            region: 'eu-west-1',
            provider: 'AwsIdc',
            clientIdHash: 'hash-1',
          },
          kiro_profile_raw: { userId: 'kiro-1', email: 'k@x.com' },
        }),
      )
      const auth = JSON.parse(readFileSync(authPath, 'utf8'))
      expect(auth.accessToken).toBe('kiro-access-new')
      expect(auth.refreshToken).toBe('kiro-refresh-new')
      expect(auth.region).toBe('eu-west-1')
      expect(auth.provider).toBe('AwsIdc')
      expect(auth.clientIdHash).toBe('hash-1')
      expect(auth.expiresAt).toBe(new Date(1893456000000).toISOString())

      const profile = JSON.parse(readFileSync(profilePath, 'utf8'))
      expect(profile.userId).toBe('kiro-1')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('无 kiro_auth_token_raw 骨架也能写最小 auth 文件', async () => {
    const dir = tmp('hxg-kiro2-')
    const authPath = join(dir, 'kiro-auth-token.json')
    const port = new KiroCredentialInjectionPort(authPath, join(dir, 'nope', 'profile.json'))
    try {
      await port.inject('kiro', new Credential('only-access', undefined, undefined, {}))
      const auth = JSON.parse(readFileSync(authPath, 'utf8'))
      expect(auth.accessToken).toBe('only-access')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('VSCode SafeStorage AES-128-CBC v10 round-trip', () => {
  it('__encryptV10ForTest → __decryptV10ForTest 还原明文（v10 前缀）', () => {
    const key = Buffer.alloc(16, 7)
    const plaintext = JSON.stringify({ hello: 'world', n: 42 })
    const enc = __encryptV10ForTest(key, plaintext)
    expect(enc.subarray(0, 3).toString()).toBe('v10')
    expect(__decryptV10ForTest(key, enc)).toBe(plaintext)
  })
})

describe('CodebuddyCredentialInjectionPort', () => {
  it('写加密 SecretStorage：planning-genie session（含 account/auth 块）', async () => {
    const { writer, calls } = fakeVscdbWriter()
    const port = new CodebuddyCredentialInjectionPort('codebuddy', '/tmp/x/state.vscdb', writer)
    await port.inject(
      'codebuddy',
      new Credential('cb-access', 'cb-refresh', undefined, {
        uid: 'u-1',
        nickname: 'Bud',
        domain: 'ent',
        enterprise_id: 'e-1',
        expires_at: 1893456000,
      }),
    )
    expect(calls).toHaveLength(1)
    expect(calls[0].mode).toBe('codebuddy')
    const secret = calls[0].ops.secrets![0]
    expect(secret.key).toContain('tencent-cloud.coding-copilot')
    expect(secret.key).toContain('planning-genie.new.accessToken')
    const session = JSON.parse(secret.plaintext)
    expect(session.token).toBe('cb-access')
    expect(session.accessToken).toBe('u-1+cb-access')
    expect(session.account.uid).toBe('u-1')
    expect(session.auth.refreshToken).toBe('cb-refresh')
    expect(session.domain).toBe('ent')
  })

  it('codebuddy_cn 用 cn secret key 与 cn 模式', async () => {
    const { writer, calls } = fakeVscdbWriter()
    const port = new CodebuddyCredentialInjectionPort('codebuddy_cn', '/tmp/x/state.vscdb', writer)
    await port.inject('codebuddy_cn', new Credential('t', undefined, undefined, { uid: 'u' }))
    expect(calls[0].mode).toBe('codebuddy_cn')
    expect(calls[0].ops.secrets![0].key).toContain('planning-genie.new.accessTokencn')
  })
})

describe('QoderCredentialInjectionPort', () => {
  it('写三个加密 secret（userInfo/userPlan/creditUsage），token 落在 userInfo', async () => {
    const { writer, calls } = fakeVscdbWriter()
    const port = new QoderCredentialInjectionPort('/tmp/x/state.vscdb', writer)
    await port.inject(
      'qoder',
      new Credential('q-token', 'q-refresh', undefined, {
        auth_user_info_raw: { id: 'q-1', email: 'q@x.com' },
        auth_user_plan_raw: { plan: 'pro' },
        auth_credit_usage_raw: { used: 10 },
      }),
    )
    expect(calls[0].mode).toBe('qoder')
    const keys = calls[0].ops.secrets!.map((s) => s.key)
    expect(keys).toEqual([
      'secret://aicoding.auth.userInfo',
      'secret://aicoding.auth.userPlan',
      'secret://aicoding.auth.creditUsage',
    ])
    const userInfo = JSON.parse(calls[0].ops.secrets![0].plaintext)
    expect(userInfo.token).toBe('q-token')
    expect(userInfo.id).toBe('q-1')
  })

  it('无 raw 快照时用凭据兜底组装 userInfo（含 token）', async () => {
    const { writer, calls } = fakeVscdbWriter()
    const port = new QoderCredentialInjectionPort('/tmp/x/state.vscdb', writer)
    await port.inject('qoder', new Credential('only-token', undefined, undefined, { email: 'e@x.com' }))
    expect(calls[0].ops.secrets).toHaveLength(1)
    const userInfo = JSON.parse(calls[0].ops.secrets![0].plaintext)
    expect(userInfo.token).toBe('only-token')
    expect(userInfo.email).toBe('e@x.com')
  })
})

describe('GitHubCopilotCredentialInjectionPort', () => {
  it('写加密 github.auth（3 组 scope）+ 明文偏好键 + 清 chat 缓存', async () => {
    const { writer, calls } = fakeVscdbWriter()
    const port = new GitHubCopilotCredentialInjectionPort('/tmp/x/state.vscdb', writer)
    await port.inject(
      'github_copilot',
      new Credential('ghu_token', undefined, undefined, { github_login: 'octocat', github_id: '123' }),
    )
    expect(calls[0].mode).toBe('default')
    const secret = calls[0].ops.secrets![0]
    expect(secret.key).toContain('vscode.github-authentication')
    const sessions = JSON.parse(secret.plaintext)
    expect(sessions).toHaveLength(3)
    expect(sessions.every((s: { accessToken: string }) => s.accessToken === 'ghu_token')).toBe(true)
    expect(sessions[0].account.label).toBe('octocat')

    const plainKeys = calls[0].ops.plain!.map((p) => p.key)
    expect(plainKeys).toContain('github.copilot-github')
    expect(plainKeys).toContain('github-octocat')
    expect(plainKeys).toContain('github-octocat-usages')
    expect(calls[0].ops.deletes).toContain('chat.cachedLanguageModels')
  })
})

describe('WindsurfCredentialInjectionPort', () => {
  it('写 windsurfAuthStatus(SignedIn) + 加密 sessions/apiServerUrl + 保留 installationId', async () => {
    const { writer, calls } = fakeVscdbWriter()
    // 现有扩展态里已有 installationId，应被保留。
    const readPlain = (_db: string, key: string): string | undefined =>
      key === 'codeium.windsurf' ? JSON.stringify({ 'codeium.installationId': 'iid-keep' }) : undefined
    const port = new WindsurfCredentialInjectionPort('/tmp/x/state.vscdb', writer, readPlain)
    await port.inject(
      'windsurf',
      new Credential('fb-token', undefined, undefined, {
        windsurf_api_key: 'sk-ws-1',
        windsurf_api_server_url: 'https://server.codeium.com',
        github_login: 'octocat',
        github_email: 'o@x.com',
        github_name: 'Octo',
      }),
    )
    expect(calls[0].mode).toBe('windsurf')

    const secretKeys = calls[0].ops.secrets!.map((s) => s.key)
    expect(secretKeys.some((k) => k.includes('windsurf_auth.sessions'))).toBe(true)
    expect(secretKeys.some((k) => k.includes('windsurf_auth.apiServerUrl'))).toBe(true)
    const sessions = JSON.parse(calls[0].ops.secrets!.find((s) => s.key.includes('sessions'))!.plaintext)
    expect(sessions[0].accessToken).toBe('fb-token')
    expect(sessions[0].account.label).toBe('octocat')

    const plain = new Map(calls[0].ops.plain!.map((p) => [p.key, p.value]))
    const authStatus = JSON.parse(plain.get('windsurfAuthStatus')!)
    expect(authStatus.status).toBe('SignedIn')
    expect(authStatus.apiKey).toBe('sk-ws-1')
    expect(authStatus.user.email).toBe('o@x.com')
    expect(plain.get('codeium.windsurf-windsurf_auth')).toBe('octocat')

    const extState = JSON.parse(plain.get('codeium.windsurf')!)
    expect(extState['codeium.installationId']).toBe('iid-keep')
  })

  it('installationId 缺失时生成新的（UUID 形态）', async () => {
    const { writer, calls } = fakeVscdbWriter()
    const port = new WindsurfCredentialInjectionPort('/tmp/x/state.vscdb', writer, () => undefined)
    await port.inject('windsurf', new Credential('fb', undefined, undefined, { windsurf_api_key: 'k', github_login: 'u' }))
    const plain = new Map(calls[0].ops.plain!.map((p) => [p.key, p.value]))
    const extState = JSON.parse(plain.get('codeium.windsurf')!)
    expect(typeof extState['codeium.installationId']).toBe('string')
    expect(extState['codeium.installationId']).toMatch(/^[0-9a-f-]{36}$/)
  })
})

describe('Trae ByteCrypto v1', () => {
  it('encrypt → decrypt 往返还原明文（含 sha512 完整性校验）', () => {
    const plaintext = JSON.stringify({ accessToken: 't-atk', loginHost: 'https://www.trae.ai' })
    const enc = byteCryptoEncryptV1(plaintext)
    // base64，且带 6 字节 'tc' header（116,99,... → base64 前缀 'dGM'）。
    expect(enc.startsWith('dGM')).toBe(true)
    expect(byteCryptoDecrypt(enc)).toBe(plaintext)
  })

  it('篡改密文 → 解密返回 null', () => {
    const enc = byteCryptoEncryptV1('hello')
    const tampered = Buffer.from(enc, 'base64')
    tampered[tampered.length - 1] ^= 0xff
    expect(byteCryptoDecrypt(tampered.toString('base64'))).toBeNull()
  })
})

describe('TraeCredentialInjectionPort', () => {
  it('写 storage.json：iCubeAuthInfo 加密 + 设备密钥对 + server/usertag', async () => {
    const dir = tmp('hxg-trae-')
    const storagePath = join(dir, 'storage.json')
    const port = new TraeCredentialInjectionPort(storagePath)
    try {
      await port.inject(
        'trae',
        new Credential('t-access', 't-refresh', undefined, {
          trae_auth_raw: {
            accessToken: 't-access',
            refreshToken: 't-refresh',
            loginHost: 'https://www.trae.ai',
            deviceInfo: { DeviceID: '7633793279305631249' },
            deviceKeyPair: { privateKeyPEM: 'priv', publicKeyPEM: 'pub' },
          },
          trae_server_raw: { loginRegion: 'sg' },
          trae_usertag_raw: 'tag-raw',
        }),
      )
      const root = JSON.parse(readFileSync(storagePath, 'utf8'))

      // iCubeAuthInfo://icube.cloudide 是 ByteCrypto 密文，可解回原 auth_raw。
      const authDecoded = JSON.parse(byteCryptoDecrypt(root['iCubeAuthInfo://icube.cloudide'])!)
      expect(authDecoded.accessToken).toBe('t-access')
      expect(authDecoded.loginHost).toBe('https://www.trae.ai')

      // 设备密钥对写在 icube-dc:{deviceId} 键，同样 ByteCrypto 加密。
      const deviceKey = root['iCubeAuthInfo://icube-dc:7633793279305631249']
      expect(deviceKey).toBeDefined()
      const deviceDecoded = JSON.parse(byteCryptoDecrypt(deviceKey)!)
      expect(deviceDecoded.privateKeyPEM).toBe('priv')
      expect(deviceDecoded.publicKeyPEM).toBe('pub')

      expect(JSON.parse(root['iCubeServerData://icube.cloudide']).loginRegion).toBe('sg')
      expect(root['iCubeAuthInfo://usertag']).toBe('tag-raw')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('缺少 trae_auth_raw 时报错（提示重新导入）', async () => {
    const dir = tmp('hxg-trae2-')
    const port = new TraeCredentialInjectionPort(join(dir, 'storage.json'))
    try {
      await expect(
        port.inject('trae', new Credential('t', undefined, undefined, {})),
      ).rejects.toThrow(/trae_auth_raw/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
