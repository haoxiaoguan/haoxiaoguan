/**
 * P2-2：KiroAdapter conversationId 稳定复用测试。
 * 注入 ConversationIdCache + 固定 genConversationId，验证：
 * 1. 同 sessionHint 两次 prepare → conversationId 相同。
 * 2. 无 sessionHint 时用 history fingerprint → 同内容两次 → 相同 id。
 * 3. sessionHint 和 fingerprint 都无 → 回退 ctx.requestId。
 */
import { describe, it, expect } from 'vitest'
import { KiroAdapter } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/kiro/kiro-adapter'
import { ConversationIdCache } from '../../../src/main/contexts/apiProxy/domain/account-selection/conversation-id-cache'
import type { KiroUpstreamClient } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/kiro/kiro-upstream-client'
import type { CanonicalRequest } from '../../../src/main/contexts/apiProxy/domain/canonical'
import type { UpstreamCtx } from '../../../src/main/contexts/apiProxy/domain/platform-adapter'
import type { ConversationStateEnvelope } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/kiro/kiro-wire-types'

const ACCOUNT = { id: 'acc-1', email: 'u@x.com', isActive: true, loginProvider: 'Github', profilePayload: { profileArn: 'arn:aws:codewhisperer:us-east-1:111122223333:profile/SOCIAL' } }
const CRED = { token: 'tok-1', rawMetadata: { provider: 'Github' } }

const BASE_IR: CanonicalRequest = {
  model: 'claude-sonnet-4.5',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hello world' }] }],
  stream: false,
}

function makeAdapter(opts?: { cache?: ConversationIdCache; seq?: { n: number } }) {
  const capturedEnvelopes: ConversationStateEnvelope[] = []
  const seq = opts?.seq ?? { n: 0 }
  const genConversationId = () => `conv-${++seq.n}`

  const clientMock = {
    async chat(envelope: ConversationStateEnvelope) {
      capturedEnvelopes.push(envelope)
      return {
        model: 'claude-sonnet-4.5',
        content: [{ type: 'text', text: 'ok' }],
        stopReason: 'end_turn',
        usage: { inputTokens: 1, outputTokens: 1 },
      }
    },
  } as unknown as KiroUpstreamClient

  const cacheStub = {
    buildProfile: () => null,
    compute: () => ({ cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }),
    update: () => {},
  } as any

  const adapter = new KiroAdapter({
    client: clientMock,
    cacheTracker: cacheStub,
    conversationIdCache: opts?.cache,
    genConversationId,
  })

  return { adapter, capturedEnvelopes }
}

describe('KiroAdapter conversationId — sessionHint 稳定复用', () => {
  it('同 sessionHint 两次 prepare → conversationId 相同', async () => {
    const cache = new ConversationIdCache({ ttlMs: 2 * 60 * 60 * 1000, maxEntries: 1000 })
    const { adapter, capturedEnvelopes } = makeAdapter({ cache })

    const ctx: UpstreamCtx = { requestId: 'req-1', account: ACCOUNT, credential: CRED, sessionHint: 'session-abc' }
    await adapter.chat(BASE_IR, ctx)
    await adapter.chat(BASE_IR, { ...ctx, requestId: 'req-2' })

    expect(capturedEnvelopes).toHaveLength(2)
    const id1 = capturedEnvelopes[0].conversationState.conversationId
    const id2 = capturedEnvelopes[1].conversationState.conversationId
    expect(id1).toBe('conv-1')
    expect(id2).toBe('conv-1') // 缓存命中，genId 未再调用
  })

  it('不同 sessionHint → 不同 conversationId', async () => {
    const cache = new ConversationIdCache({ ttlMs: 2 * 60 * 60 * 1000, maxEntries: 1000 })
    const { adapter, capturedEnvelopes } = makeAdapter({ cache })

    const ctx1: UpstreamCtx = { requestId: 'req-1', account: ACCOUNT, credential: CRED, sessionHint: 'hint-A' }
    const ctx2: UpstreamCtx = { requestId: 'req-2', account: ACCOUNT, credential: CRED, sessionHint: 'hint-B' }
    await adapter.chat(BASE_IR, ctx1)
    await adapter.chat(BASE_IR, ctx2)

    const id1 = capturedEnvelopes[0].conversationState.conversationId
    const id2 = capturedEnvelopes[1].conversationState.conversationId
    expect(id1).not.toBe(id2)
  })
})

describe('KiroAdapter conversationId — history fingerprint 稳定复用', () => {
  it('无 sessionHint 时同内容请求两次 → conversationId 相同', async () => {
    const cache = new ConversationIdCache({ ttlMs: 2 * 60 * 60 * 1000, maxEntries: 1000 })
    const { adapter, capturedEnvelopes } = makeAdapter({ cache })

    const ctx: UpstreamCtx = { requestId: 'req-1', account: ACCOUNT, credential: CRED }
    await adapter.chat(BASE_IR, ctx)
    await adapter.chat(BASE_IR, { ...ctx, requestId: 'req-2' })

    const id1 = capturedEnvelopes[0].conversationState.conversationId
    const id2 = capturedEnvelopes[1].conversationState.conversationId
    expect(id1).toBe(id2) // fingerprint 相同 → 缓存命中
  })

  it('不同消息内容 → 不同 conversationId', async () => {
    const cache = new ConversationIdCache({ ttlMs: 2 * 60 * 60 * 1000, maxEntries: 1000 })
    const { adapter, capturedEnvelopes } = makeAdapter({ cache })

    const ir2: CanonicalRequest = {
      ...BASE_IR,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'different content' }] }],
    }

    await adapter.chat(BASE_IR, { requestId: 'r1', account: ACCOUNT, credential: CRED })
    await adapter.chat(ir2, { requestId: 'r2', account: ACCOUNT, credential: CRED })

    const id1 = capturedEnvelopes[0].conversationState.conversationId
    const id2 = capturedEnvelopes[1].conversationState.conversationId
    expect(id1).not.toBe(id2)
  })
})

describe('KiroAdapter conversationId — 无 cache 注入时回退 requestId', () => {
  it('无 cache 注入 + 有 sessionHint → 回退 ctx.requestId', async () => {
    // cache 未注入时无论 sessionHint 存在与否都回退 requestId
    const { adapter, capturedEnvelopes } = makeAdapter({ cache: undefined })

    await adapter.chat(BASE_IR, { requestId: 'my-req-id', account: ACCOUNT, credential: CRED, sessionHint: 'some-hint' })

    expect(capturedEnvelopes[0].conversationState.conversationId).toBe('my-req-id')
  })

  it('无 cache + 无 requestId → 回退 "conv"', async () => {
    const { adapter, capturedEnvelopes } = makeAdapter({ cache: undefined })

    await adapter.chat(BASE_IR, { account: ACCOUNT, credential: CRED })

    expect(capturedEnvelopes[0].conversationState.conversationId).toBe('conv')
  })
})
