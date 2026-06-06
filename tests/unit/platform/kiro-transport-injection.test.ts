// G2 阶段0 守卫：Kiro 全出站(聊天/刷新/额度/模型/oauth)必须经统一 transport 注入点，
// 一处 setKiroTransportImpl 即覆盖全部——否则原生 TLS 指纹 sidecar 就绪后漏一条即 JA3 分裂。
import { describe, it, expect, afterEach } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  createKiroTransport,
  setKiroTransportImpl,
} from '../../../src/main/platform/net/kiro-transport'

const ROOT = process.cwd()

afterEach(() => setKiroTransportImpl(undefined))

describe('统一注入点行为', () => {
  it('setKiroTransportImpl 覆盖【创建早于注入】的所有 createKiroTransport() 消费者', async () => {
    // 模拟「模块加载时已创建的 upstream/identity 单例」：在 set 之前创建
    const a = createKiroTransport()
    const b = createKiroTransport()
    const calls: string[] = []
    setKiroTransportImpl(async (url) => {
      calls.push(url)
      return new Response('ok')
    })
    await a.fetch('https://q.aws/1', { method: 'GET' })
    await b.fetch('https://q.aws/2', { method: 'GET' })
    // 两个先创建的实例都路由到注入实现（调用时动态解析），证明一处注入即全覆盖
    expect(calls).toEqual(['https://q.aws/1', 'https://q.aws/2'])
  })

  it('opts.impl 显式注入优先且不受全局 set 影响（测试隔离用）', async () => {
    const calls: string[] = []
    const t = createKiroTransport({
      impl: async (u) => {
        calls.push('explicit:' + u)
        return new Response()
      },
    })
    setKiroTransportImpl(async (u) => {
      calls.push('global:' + u)
      return new Response()
    })
    await t.fetch('https://x/1', { method: 'GET' })
    expect(calls).toEqual(['explicit:https://x/1'])
  })

  it('清除注入后回退默认实现（fetch 仍可调用）', () => {
    setKiroTransportImpl(async () => new Response())
    setKiroTransportImpl(undefined)
    expect(typeof createKiroTransport().fetch).toBe('function')
  })
})

describe('出站统一性 CI 守卫（防 JA3 分裂）', () => {
  const OUTBOUND_FILES = [
    'src/main/contexts/apiProxy/infrastructure/adapters/kiro/kiro-upstream-client.ts',
    'src/main/platform/net/kiro/kiro-identity-client.ts',
    'src/main/contexts/credential/infrastructure/capabilities/kiro-oauth.ts',
  ]

  it('三条出站路径都经 createKiroTransport（统一 seam）', () => {
    for (const rel of OUTBOUND_FILES) {
      const src = readFileSync(join(ROOT, rel), 'utf8')
      expect(src, `${rel} 应经 createKiroTransport 出站`).toMatch(/createKiroTransport/)
    }
  })

  it('Kiro 出站模块不得运行时直接引入 undici fetch/Agent（必须经 kiro-transport）', () => {
    const dirs = [
      'src/main/platform/net/kiro',
      'src/main/contexts/apiProxy/infrastructure/adapters/kiro',
    ]
    const listTs = (dir: string): string[] => {
      const out: string[] = []
      for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
        const rel = join(dir, e.name)
        if (e.isDirectory()) out.push(...listTs(rel))
        else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) out.push(rel)
      }
      return out
    }
    const offenders: string[] = []
    for (const dir of dirs) {
      for (const rel of listTs(dir)) {
        const src = readFileSync(join(ROOT, rel), 'utf8')
        for (const line of src.split('\n')) {
          if (!/from ['"]undici['"]/.test(line)) continue
          if (/^\s*import\s+type\b/.test(line)) continue // import type 仅类型，已擦除，放行
          if (/\b(fetch|Agent)\b/.test(line)) offenders.push(`${rel}: ${line.trim()}`)
        }
      }
    }
    expect(offenders, '出站模块绕过 kiro-transport 直连 undici').toEqual([])
  })
})
