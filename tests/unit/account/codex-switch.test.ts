import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Credential } from '../../../src/main/contexts/account/domain/credential'
import { Account } from '../../../src/main/contexts/account/domain/account'
import { PlatformAccountProfile } from '../../../src/main/contexts/account/domain/platform-account-profile'
import { SwitchService } from '../../../src/main/contexts/account/application/switch-service'
import { CodexCredentialInjectionPort } from '../../../src/main/agents/credential-injection/codex-injection'
import { CodexCredentialRefresher } from '../../../src/main/contexts/account/infrastructure/codex-credential-refresher'
import { CodexSwitchLifecycle } from '../../../src/main/contexts/account/infrastructure/codex-switch-lifecycle'
import type { CodexProcessControl } from '../../../src/main/contexts/clientConfig/infrastructure/codex-process'
import type {
  CredentialInjectionPort,
  PlatformSwitchLifecycle,
} from '../../../src/main/contexts/account/domain/ports'

function fakeJwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'none' })}.${b64(payload)}.sig`
}

function codexAccount(): Account {
  const profile = PlatformAccountProfile.fromIdentifier('user@example.com')
  return Account.createWithProfile('codex', 'user@example.com', undefined, [], undefined, profile)
}

const freshJwt = () => fakeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 })
const expiredJwt = () => fakeJwt({ exp: Math.floor(Date.now() / 1000) - 3600 })

describe('CodexCredentialInjectionPort', () => {
  it('OAuth 注入写官方 auth.json 结构并同步 Keychain', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hxg-codex-'))
    const authPath = join(dir, 'auth.json')
    const keychainWrites: string[] = []
    const port = new CodexCredentialInjectionPort(authPath, {
      write: async (secret) => {
        keychainWrites.push(secret)
      },
    })
    const access = freshJwt()
    try {
      await port.inject(
        'codex',
        new Credential(access, 'rt-1', undefined, {
          auth_mode: 'chatgpt_oauth',
          id_token: 'id-1',
          account_id: 'acc-1',
        }),
      )
      const written = JSON.parse(readFileSync(authPath, 'utf8'))
      expect(written.OPENAI_API_KEY).toBeNull()
      expect(written.tokens).toEqual({
        id_token: 'id-1',
        access_token: access,
        refresh_token: 'rt-1',
        account_id: 'acc-1',
      })
      expect(typeof written.last_refresh).toBe('string')
      // Keychain 写的是同款 JSON（compact）
      expect(keychainWrites).toHaveLength(1)
      expect(JSON.parse(keychainWrites[0]).tokens.access_token).toBe(access)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('API Key 注入写 apikey 结构且不碰 Keychain；Keychain 失败不阻断 OAuth 注入', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hxg-codex-'))
    const authPath = join(dir, 'auth.json')
    let keychainCalls = 0
    const failingKeychain = {
      write: async () => {
        keychainCalls += 1
        throw new Error('keychain boom')
      },
    }
    const port = new CodexCredentialInjectionPort(authPath, failingKeychain)
    try {
      await port.inject(
        'codex',
        new Credential('sk-live', undefined, undefined, { auth_mode: 'api_key' }),
      )
      expect(JSON.parse(readFileSync(authPath, 'utf8'))).toEqual({
        auth_mode: 'apikey',
        OPENAI_API_KEY: 'sk-live',
      })
      expect(keychainCalls).toBe(0) // API Key 不写 Keychain

      // OAuth + Keychain 失败 → 仅告警，auth.json 照写
      await port.inject(
        'codex',
        new Credential(freshJwt(), 'rt', undefined, { auth_mode: 'chatgpt_oauth' }),
      )
      expect(keychainCalls).toBe(1)
      expect(JSON.parse(readFileSync(authPath, 'utf8')).tokens).toBeDefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('CodexCredentialRefresher', () => {
  it('token 未到期不刷新（原样返回）', async () => {
    const refreshFn = vi.fn()
    const refresher = new CodexCredentialRefresher(refreshFn)
    const cred = new Credential(freshJwt(), 'rt', undefined, { auth_mode: 'chatgpt_oauth' })
    expect(await refresher.refreshIfNeeded(cred)).toBe(cred)
    expect(refreshFn).not.toHaveBeenCalled()
  })

  it('过期 OAuth → 刷新并合并新 token 进凭据与 rawMetadata（含嵌套 tokens）', async () => {
    const newAccess = freshJwt()
    const refreshFn = vi.fn(async () => ({
      access_token: newAccess,
      refresh_token: 'rt-new',
      id_token: 'id-new',
      expires_in: 3600,
    }))
    const refresher = new CodexCredentialRefresher(refreshFn)
    const old = new Credential(expiredJwt(), 'rt-old', undefined, {
      auth_mode: 'chatgpt_oauth',
      id_token: 'id-old',
      account_id: 'acc-1',
      tokens: { id_token: 'id-old', access_token: 'stale', refresh_token: 'rt-old' },
    })
    const next = await refresher.refreshIfNeeded(old)
    expect(next).not.toBe(old)
    expect(next.token).toBe(newAccess)
    expect(next.refreshToken).toBe('rt-new')
    expect(next.expiresAt!.getTime()).toBeGreaterThan(Date.now())
    const meta = next.rawMetadata as Record<string, unknown>
    expect(meta.id_token).toBe('id-new')
    expect(meta.account_id).toBe('acc-1')
    expect((meta.tokens as Record<string, unknown>).access_token).toBe(newAccess)
    expect(refreshFn).toHaveBeenCalledWith('rt-old')
  })

  it('刷新响应缺 access_token → 抛错（切换失败，不写半残登录）', async () => {
    const refresher = new CodexCredentialRefresher(async () => ({}))
    const old = new Credential(expiredJwt(), 'rt', undefined, { auth_mode: 'chatgpt_oauth' })
    await expect(refresher.refreshIfNeeded(old)).rejects.toThrow(/access_token/)
  })

  it('API Key / 无 refresh_token 不刷新', async () => {
    const refreshFn = vi.fn()
    const refresher = new CodexCredentialRefresher(refreshFn)
    const apiKey = new Credential('sk-live', undefined, undefined, { auth_mode: 'api_key' })
    expect(await refresher.refreshIfNeeded(apiKey)).toBe(apiKey)
    const noRefresh = new Credential(expiredJwt(), undefined, undefined, { auth_mode: 'chatgpt_oauth' })
    expect(await refresher.refreshIfNeeded(noRefresh)).toBe(noRefresh)
    expect(refreshFn).not.toHaveBeenCalled()
  })
})

describe('CodexSwitchLifecycle', () => {
  function fakeControl(running: boolean, quitOk = true) {
    const calls: string[] = []
    const control: CodexProcessControl = {
      isRunning: async () => running,
      quit: async () => {
        calls.push('quit')
        return quitOk
      },
      launch: async (appPath?: string) => {
        calls.push(`launch:${appPath ?? ''}`)
      },
    }
    return { control, calls }
  }

  it('开关开 + App 运行中：先退出、注入后按启动路径拉起', async () => {
    const { control, calls } = fakeControl(true)
    const lc = new CodexSwitchLifecycle(control, () => true, () => '/Applications/Codex.app')
    const token = await lc.beforeInject()
    expect(token.relaunch).toBe(true)
    await lc.afterInject(token)
    expect(calls).toEqual(['quit', 'launch:/Applications/Codex.app'])
  })

  it('开关开 + App 未运行：跳过退出但仍拉起（对照 cockpit 无条件启动）', async () => {
    const { control, calls } = fakeControl(false)
    const lc = new CodexSwitchLifecycle(control, () => true, () => undefined)
    const token = await lc.beforeInject()
    await lc.afterInject(token)
    expect(calls).toEqual(['launch:'])
  })

  it('退不出运行中的 App → 抛错中止（否则写完被反写）', async () => {
    const { control } = fakeControl(true, false)
    const lc = new CodexSwitchLifecycle(control, () => true, () => undefined)
    await expect(lc.beforeInject()).rejects.toThrow(/退出/)
  })

  it('开关关：完全不碰进程', async () => {
    const { control, calls } = fakeControl(true)
    const lc = new CodexSwitchLifecycle(control, () => false, () => undefined)
    const token = await lc.beforeInject()
    expect(token.relaunch).toBe(false)
    await lc.afterInject(token)
    expect(calls).toEqual([])
  })
})

describe('SwitchService（codex 编排）', () => {
  function makeService(opts: {
    credential: Credential
    refreshed?: Credential
    injector?: CredentialInjectionPort
    lifecycle?: PlatformSwitchLifecycle
  }) {
    const stored: Credential[] = []
    const injected: Credential[] = []
    const store = {
      retrieve: async () => opts.credential,
      store: async (_id: string, _p: string, c: Credential) => {
        stored.push(c)
      },
      delete: async () => {},
    }
    const injector: CredentialInjectionPort =
      opts.injector ?? {
        inject: async (_p, c) => {
          injected.push(c)
        },
      }
    const svc = new SwitchService(
      store as never,
      { injector: () => injector },
      opts.refreshed !== undefined
        ? { refresher: () => ({ refreshIfNeeded: async () => opts.refreshed! }) }
        : undefined,
      opts.lifecycle !== undefined ? { lifecycle: () => opts.lifecycle } : undefined,
    )
    return { svc, stored, injected }
  }

  it('刷新出新凭据 → 回写存储并用新凭据注入', async () => {
    const oldCred = new Credential(expiredJwt(), 'rt-old', new Date(Date.now() - 1000), {
      auth_mode: 'chatgpt_oauth',
    })
    const newCred = new Credential(freshJwt(), 'rt-new', new Date(Date.now() + 3_600_000), {
      auth_mode: 'chatgpt_oauth',
    })
    const { svc, stored, injected } = makeService({ credential: oldCred, refreshed: newCred })
    const result = await svc.switchAccount(codexAccount())
    expect(result.success).toBe(true)
    expect(stored).toEqual([newCred])
    expect(injected).toEqual([newCred])
  })

  it('生命周期顺序：beforeInject → inject → afterInject；before 抛错则不注入', async () => {
    const order: string[] = []
    const cred = new Credential(freshJwt(), 'rt', undefined, { auth_mode: 'chatgpt_oauth' })
    const lifecycle: PlatformSwitchLifecycle = {
      beforeInject: async () => {
        order.push('before')
        return { relaunch: true }
      },
      afterInject: async () => {
        order.push('after')
      },
    }
    const { svc } = makeService({
      credential: cred,
      lifecycle,
      injector: {
        inject: async () => {
          order.push('inject')
        },
      },
    })
    const result = await svc.switchAccount(codexAccount())
    expect(order).toEqual(['before', 'inject', 'after'])
    expect(result.platformLaunched).toBe(true)

    // beforeInject 抛错 → 注入不发生
    const order2: string[] = []
    const { svc: svc2 } = makeService({
      credential: cred,
      lifecycle: {
        beforeInject: async () => {
          throw new Error('Codex 仍在运行')
        },
        afterInject: async () => {
          order2.push('after')
        },
      },
      injector: {
        inject: async () => {
          order2.push('inject')
        },
      },
    })
    await expect(svc2.switchAccount(codexAccount())).rejects.toThrow(/仍在运行/)
    expect(order2).toEqual([])
  })

  it('注入抛错时 afterInject 仍执行（恢复用户 App），错误照常上抛', async () => {
    const order: string[] = []
    const cred = new Credential(freshJwt(), 'rt', undefined, { auth_mode: 'chatgpt_oauth' })
    const { svc } = makeService({
      credential: cred,
      lifecycle: {
        beforeInject: async () => ({ relaunch: true }),
        afterInject: async () => {
          order.push('after')
        },
      },
      injector: {
        inject: async () => {
          throw new Error('disk full')
        },
      },
    })
    await expect(svc.switchAccount(codexAccount())).rejects.toThrow(/disk full/)
    expect(order).toEqual(['after'])
  })

  it('过期且无刷新能力 → 维持原 credentialExpired 行为', async () => {
    const cred = new Credential('tok', undefined, new Date(Date.now() - 1000))
    const { svc, injected } = makeService({ credential: cred })
    await expect(svc.switchAccount(codexAccount())).rejects.toThrow()
    expect(injected).toEqual([])
  })
})
