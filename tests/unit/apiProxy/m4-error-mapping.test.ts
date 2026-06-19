// tests/unit/apiProxy/m4-error-mapping.test.ts
import { describe, it, expect } from 'vitest'
import { classifyToHttp } from '../../../src/main/contexts/apiProxy/application/api-proxy-service'
import { KiroUpstreamAuthError, KiroUpstreamError, KiroTokenPermanentError } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/kiro/kiro-upstream-client'
import { KiroUpstreamSuspendedError } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/kiro/kiro-error'
import { NoHealthyAccountError } from '../../../src/main/contexts/apiProxy/domain/account-selection/failover-adapter'
import { RelayHttpError } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/relay/relay-upstream-client'

const cases: Array<[unknown, number]> = [
  [new KiroUpstreamSuspendedError('x', 403), 403],
  [new KiroUpstreamAuthError('x', 401), 401],
  [new KiroTokenPermanentError('x', 403), 401],
  [new KiroUpstreamError('x', 402), 402],
  [new KiroUpstreamError('x', 429), 429],
  [new KiroUpstreamError('x', 502), 502],
  [new KiroUpstreamError('x', 400), 400],
  [new KiroUpstreamError('x', 422), 422],
  [new NoHealthyAccountError('x'), 503],
  [new Error('weird'), 500],
  // relay（第三方）上游错误：4xx 原状态透传，5xx → 502 网关错误（不再笼统落 500）。
  [new RelayHttpError('x', 400), 400],
  [new RelayHttpError('x', 401), 401],
  [new RelayHttpError('x', 402), 402],
  [new RelayHttpError('x', 403), 403],
  [new RelayHttpError('x', 404), 404],
  [new RelayHttpError('x', 422), 422],
  [new RelayHttpError('x', 429), 429],
  [new RelayHttpError('x', 500), 502],
  [new RelayHttpError('x', 502), 502],
  [new RelayHttpError('x', 503), 502],
]

describe('classifyToHttp', () => {
  it.each(cases)('%o → %i', (err, status) => {
    expect(classifyToHttp(err, 'openai').status).toBe(status)
  })

  it('保留 relay 上游原始错误消息（不被 "Internal server error" 覆盖）', () => {
    const err = new RelayHttpError('relay upstream HTTP 400: model not found', 400)
    expect(classifyToHttp(err, 'openai-responses').message).toBe(
      'relay upstream HTTP 400: model not found',
    )
  })
})
