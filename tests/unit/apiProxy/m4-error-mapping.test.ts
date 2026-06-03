// tests/unit/apiProxy/m4-error-mapping.test.ts
import { describe, it, expect } from 'vitest'
import { classifyToHttp } from '../../../src/main/contexts/apiProxy/application/api-proxy-service'
import { KiroUpstreamAuthError, KiroUpstreamError } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/kiro/kiro-upstream-client'
import { KiroUpstreamSuspendedError } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/kiro/kiro-error'
import { NoHealthyAccountError } from '../../../src/main/contexts/apiProxy/domain/account-selection/failover-adapter'

const cases: Array<[unknown, number]> = [
  [new KiroUpstreamSuspendedError('x', 403), 403],
  [new KiroUpstreamAuthError('x', 401), 401],
  [new KiroUpstreamError('x', 429), 429],
  [new KiroUpstreamError('x', 502), 502],
  [new KiroUpstreamError('x', 400), 400],
  [new KiroUpstreamError('x', 422), 422],
  [new NoHealthyAccountError('x'), 503],
  [new Error('weird'), 500],
]

describe('classifyToHttp', () => {
  it.each(cases)('%o → %i', (err, status) => {
    expect(classifyToHttp(err, 'openai').status).toBe(status)
  })
})
