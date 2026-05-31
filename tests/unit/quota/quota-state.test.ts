import { describe, it, expect } from 'vitest'
import { ModelQuota, QuotaInfo } from '../../../src/main/contexts/quota/domain/quota'
import {
  AccountQuotaState,
  fromAccountProfile,
  fromFetchResultForPlatform,
  sanitizeProviderPayload,
} from '../../../src/main/contexts/quota/domain/quota-state'
import type { QuotaFetchResult } from '../../../src/main/contexts/quota/domain/capabilities'

// Mirrors the Rust quota_state.rs unit tests, plus the per-platform parser cases.

describe('AccountQuotaState.fromLegacyQuota', () => {
  it('converts legacy quota info to primary warning metric', () => {
    const quota = new QuotaInfo('acc', [
      new ModelQuota('flash', 10, 100),
      new ModelQuota('pro', 95, 100),
    ], new Date())
    const state = AccountQuotaState.fromLegacyQuota(quota)
    expect(state.status).toBe('warning')
    expect(state.primaryMetricKey).toBe('pro')
    expect(state.metrics.length).toBe(2)
    expect(state.metrics[1].percentUsed).toBe(95)
  })

  it('clamps remaining to zero when used exceeds total', () => {
    const state = AccountQuotaState.fromLegacyQuota(
      new QuotaInfo('acc', [new ModelQuota('pro', 120, 100)], new Date()),
    )
    expect(state.metrics[0].remaining).toBe(0)
    expect(state.metrics[0].status).toBe('exhausted')
  })
})

describe('summary', () => {
  it('uses primary metric display fields', () => {
    const state = new AccountQuotaState({
      version: 1,
      status: 'ok',
      primaryMetricKey: 'total_usage',
      metrics: [
        {
          key: 'total_usage',
          label: 'Total Usage',
          kind: 'usage',
          unit: 'percent',
          used: 40,
          total: 100,
          remaining: undefined,
          percentUsed: 40,
          percentRemaining: 60,
          displayValue: '40%',
          window: 'billing_cycle',
          resetAt: undefined,
          status: 'ok',
        },
      ],
      fetchedAt: new Date(),
      error: undefined,
      providerPayload: { plan: 'pro' },
    })
    const summary = state.summary('acc')
    expect(summary.quotaStatus).toBe('ok')
    expect(summary.primaryMetricKey).toBe('total_usage')
    expect(summary.primaryLabel).toBe('Total Usage')
    expect(summary.primaryValue).toBe('40%')
    expect(summary.primaryPercent).toBe(40)
    expect(summary.primaryUnit).toBe('percent')
  })
})

describe('sanitizeProviderPayload', () => {
  it('strips sensitive keys recursively (normalised key matching)', () => {
    const raw = {
      plan: 'pro',
      password: 'secret',
      api_key: 'secret',
      access_token: 'secret',
      nested: {
        apiKey: 'secret',
        refreshToken: 'secret',
        quota: 20,
        'id token': 'secret',
        'session key': 'secret',
        headers: {
          authorization: 'Bearer secret',
          'session secret': 'secret',
          'code verifier': 'secret',
          'oauth state': 'secret',
          state: 'secret',
        },
      },
    }
    const out = sanitizeProviderPayload(raw) as Record<string, any>
    expect(out.plan).toBe('pro')
    expect(out.nested.quota).toBe(20)
    expect(out.password).toBeUndefined()
    expect(out.api_key).toBeUndefined()
    expect(out.access_token).toBeUndefined()
    expect(out.nested.apiKey).toBeUndefined()
    expect(out.nested.refreshToken).toBeUndefined()
    expect(out.nested['id token']).toBeUndefined()
    expect(out.nested['session key']).toBeUndefined()
    expect(out.nested.headers.authorization).toBeUndefined()
    expect(out.nested.headers['session secret']).toBeUndefined()
    expect(out.nested.headers['code verifier']).toBeUndefined()
    expect(out.nested.headers['oauth state']).toBeUndefined()
    expect(out.nested.headers.state).toBeUndefined()
  })
})

describe('fromAccountProfile — per platform', () => {
  it('kiro builds credit metrics', () => {
    const state = fromAccountProfile(
      'kiro',
      { creditsTotal: 100, creditsUsed: 25, bonusTotal: 20, bonusUsed: 5, usageResetAt: 1_779_888_000 },
      undefined,
    )!
    expect(state.primaryMetricKey).toBe('credits')
    expect(state.metrics.length).toBe(2)
    expect(state.metrics[0].used).toBe(25)
    expect(state.metrics[0].total).toBe(100)
    expect(state.metrics[0].remaining).toBe(75)
    expect(state.metrics[0].percentUsed).toBe(25)
    expect(state.metrics[1].key).toBe('bonus_credits')
    expect((state.providerPayload as any).creditsTotal).toBe(100)
  })

  it('cursor builds usage metrics from usage object', () => {
    const state = fromAccountProfile(
      'cursor',
      {
        planName: 'PRO',
        usage: {
          totalUsage: { used: 8, total: 20, unit: 'usd' },
          composer: { percentUsed: 51 },
          api: { percentUsed: 1 },
        },
      },
      undefined,
    )!
    expect(state.primaryMetricKey).toBe('total_usage')
    expect(state.metrics.length).toBe(3)
    expect(state.metrics[0].unit).toBe('usd')
    expect(state.metrics[0].used).toBe(8)
    expect(state.metrics[0].total).toBe(20)
    expect(state.metrics[0].percentUsed).toBe(40)
    expect(state.metrics[0].displayValue).toBe('40%')
    expect(state.metrics[1].key).toBe('auto_composer')
    expect(state.metrics[1].percentUsed).toBe(51)
    expect(state.metrics[2].key).toBe('api_usage')
    expect(state.metrics[2].percentUsed).toBe(1)
  })

  it('cursor reference usage_raw prefers total percent', () => {
    const state = fromAccountProfile(
      'cursor',
      {
        membershipType: 'pro',
        cursor_usage_raw: {
          individualUsage: {
            plan: { used: 2000, limit: 2000, totalPercentUsed: 73, autoPercentUsed: 94.3, apiPercentUsed: 1 },
          },
        },
      },
      undefined,
    )!
    expect(state.metrics[0].key).toBe('total_usage')
    expect(state.metrics[0].percentUsed).toBe(73)
    expect(state.metrics[0].displayValue).toBe('73%')
    expect(state.metrics[0].used).toBeUndefined()
    expect(state.metrics[1].percentUsed).toBe(94.3)
    expect(state.metrics[2].percentUsed).toBe(1)
  })

  it('gemini builds remaining metrics with exhausted status', () => {
    const state = fromAccountProfile(
      'gemini_cli',
      { quota: { pro: { remainingPercent: 0 }, flash: { remainingPercent: 100 } } },
      undefined,
    )!
    expect(state.primaryMetricKey).toBe('pro')
    expect(state.status).toBe('exhausted')
    expect(state.metrics[0].kind).toBe('remaining')
    expect(state.metrics[0].percentRemaining).toBe(0)
    expect(state.metrics[0].displayValue).toBe('0% 剩余')
    expect(state.metrics[1].percentRemaining).toBe(100)
  })

  it('gemini reference buckets build remaining metrics', () => {
    const state = fromAccountProfile(
      'gemini_cli',
      {
        gemini_usage_raw: {
          buckets: [
            { modelId: 'gemini-2.5-pro', remainingFraction: 0.25, resetTime: 1779888000 },
            { modelId: 'gemini-2.5-flash', remainingFraction: 0.8, resetTime: 1779888000 },
          ],
        },
      },
      undefined,
    )!
    expect(state.metrics[0].key).toBe('pro')
    expect(state.metrics[0].percentRemaining).toBe(25)
    expect(state.metrics[1].key).toBe('flash')
    expect(state.metrics[1].percentRemaining).toBeCloseTo(80)
  })

  it('codex without window quota has no usage metric', () => {
    const state = fromAccountProfile('codex', { planName: 'Plus', api: { usageUsd: 3.2, limitUsd: 20 } }, undefined)
    expect(state).toBeUndefined()
  })

  it('codex reference quota builds remaining window metrics', () => {
    const state = fromAccountProfile(
      'codex',
      {
        quota: {
          hourly_percentage: 35,
          hourly_reset_time: 1779888000,
          hourly_window_minutes: 300,
          hourly_window_present: true,
          weekly_percentage: 80,
          weekly_reset_time: 1780406400,
          weekly_window_minutes: 10080,
          weekly_window_present: true,
        },
      },
      undefined,
    )!
    expect(state.metrics.length).toBe(2)
    expect(state.metrics[0].key).toBe('codex_hourly')
    expect(state.metrics[0].label).toBe('5小时额度')
    expect(state.metrics[0].kind).toBe('remaining')
    expect(state.metrics[0].percentRemaining).toBe(35)
    expect(Math.trunc(state.metrics[0].resetAt!.getTime() / 1000)).toBe(1779888000)
    expect(state.metrics[1].key).toBe('codex_weekly')
    expect(state.metrics[1].label).toBe('周额度')
    expect(state.metrics[1].percentRemaining).toBe(80)
  })

  it('copilot profile builds entitlement metric', () => {
    const state = fromAccountProfile(
      'github_copilot',
      { loginProvider: 'GitHub', planName: 'Team', deviceCode: true },
      undefined,
    )!
    expect(state.primaryMetricKey).toBe('entitlement')
    expect(state.metrics[0].kind).toBe('entitlement')
    expect(state.metrics[0].displayValue).toBe('Team')
  })

  it('copilot reference snapshots build usage metrics', () => {
    const state = fromAccountProfile(
      'github_copilot',
      {
        copilotPlan: 'Individual',
        copilot_quota_snapshots: {
          completions: { entitlement: 100, remaining: 75 },
          chat: { entitlement: 50, remaining: 20 },
          premium_interactions: { percent_remaining: 40 },
        },
        copilot_limited_user_reset_date: 1779888000,
      },
      undefined,
    )!
    expect(state.metrics.length).toBe(3)
    expect(state.metrics[0].key).toBe('inline_suggestions')
    expect(state.metrics[0].percentUsed).toBe(25)
    expect(state.metrics[1].key).toBe('chat_messages')
    expect(state.metrics[1].percentUsed).toBe(60)
    expect(state.metrics[2].key).toBe('premium_requests')
    expect(state.metrics[2].percentRemaining).toBe(40)
  })

  it('windsurf reference quota builds copilot metrics', () => {
    const state = fromAccountProfile(
      'windsurf',
      {
        copilot_limited_user_quotas: { completions: 25, chat: 10 },
        copilot_quota_snapshots: {
          completions: { entitlement: 100, remaining: 25 },
          chat: { entitlement: 20, remaining: 10 },
        },
      },
      undefined,
    )!
    expect(state.metrics[0].key).toBe('inline_suggestions')
    expect(state.metrics[0].percentRemaining).toBe(25)
    expect(state.metrics[1].key).toBe('chat_messages')
    expect(state.metrics[1].percentRemaining).toBe(50)
  })

  it('codebuddy reference quota_raw builds resource metrics', () => {
    const state = fromAccountProfile(
      'codebuddy',
      { planType: 'team', quota_raw: { userResource: { used: 12, total: 100 }, resourcePackage: { used: 3, total: 10 } } },
      undefined,
    )!
    expect(state.metrics[0].key).toBe('user_resource')
    expect(state.metrics[0].used).toBe(12)
    expect(state.metrics[1].key).toBe('resource_package')
    expect(state.metrics[1].used).toBe(3)
  })

  it('qoder reference credits build multiple metrics', () => {
    const state = fromAccountProfile(
      'qoder',
      {
        creditsUsed: 40,
        creditsTotal: 100,
        creditsRemaining: 60,
        creditsUsagePercent: 40,
        auth_credit_usage_raw: { addOnQuota: { used: 5, total: 25 }, resourcePackage: { used: 3 } },
      },
      undefined,
    )!
    expect(state.metrics.length).toBe(3)
    expect(state.metrics[0].key).toBe('credits')
    expect(state.metrics[0].remaining).toBe(60)
    expect(state.metrics[1].key).toBe('addon_credits')
    expect(state.metrics[1].percentUsed).toBe(20)
    expect(state.metrics[2].key).toBe('shared_package')
    expect(state.metrics[2].displayValue).toBe('3')
  })

  it('trae reference usage_raw builds usd quota metric', () => {
    const state = fromAccountProfile(
      'trae',
      {
        planResetAt: 1779888000,
        trae_usage_raw: {
          code: 0,
          user_entitlement_pack_list: [
            {
              product_type: 1,
              usage: { basic_usage_amount: 5.5 },
              entitlement_base_info: { identity_str: 'Pro', end_time: 1779888000, quota: { basic_usage_limit: 20 } },
            },
          ],
        },
      },
      undefined,
    )!
    expect(state.primaryMetricKey).toBe('trae_quota')
    expect(state.metrics[0].unit).toBe('usd')
    expect(state.metrics[0].used).toBe(5.5)
    expect(state.metrics[0].total).toBe(20)
    expect(state.metrics[0].percentUsed).toBe(27.5)
  })

  it('zed reference usage fields build spend + prediction metrics', () => {
    const state = fromAccountProfile(
      'zed',
      {
        tokenSpendUsedCents: 1250,
        tokenSpendLimitCents: 5000,
        tokenSpendRemainingCents: 3750,
        editPredictionsUsed: 12,
        editPredictionsLimitRaw: '100',
        editPredictionsRemainingRaw: '88',
      },
      undefined,
    )!
    expect(state.metrics.length).toBe(2)
    expect(state.metrics[0].key).toBe('token_spend')
    expect(state.metrics[0].unit).toBe('usd')
    expect(state.metrics[0].used).toBe(12.5)
    expect(state.metrics[0].total).toBe(50)
    expect(state.metrics[0].percentRemaining).toBe(75)
    expect(state.metrics[1].key).toBe('edit_predictions')
    expect(state.metrics[1].remaining).toBe(88)
  })

  it('generic profile builds common usage metric', () => {
    const state = fromAccountProfile('qoder', { usage: { used: 12, total: 30 } }, undefined)!
    expect(state.primaryMetricKey).toBe('usage')
    expect(state.metrics[0].used).toBe(12)
    expect(state.metrics[0].total).toBe(30)
    expect(state.metrics[0].percentUsed).toBe(40)
  })

  it('antigravity returns undefined (unsupported)', () => {
    expect(fromAccountProfile('antigravity', { creditsUsed: 1, creditsTotal: 2 }, undefined)).toBeUndefined()
  })
})

describe('fromFetchResultForPlatform', () => {
  it('builds platform state from live provider payload', () => {
    const result: QuotaFetchResult = {
      outcome: 'success',
      source: 'live',
      freshness: 'fresh',
      fetchedAt: new Date(),
      models: [],
      providerPayload: {
        cursor_usage_raw: { individualUsage: { plan: { used: 30, limit: 100, autoPercentUsed: 20 } } },
      },
      updatedCredential: undefined,
      error: undefined,
    }
    const state = fromFetchResultForPlatform('cursor', result, undefined)
    expect(state.primaryMetricKey).toBe('total_usage')
    expect(state.metrics[0].used).toBe(30)
    expect(state.metrics[0].total).toBe(100)
    expect((state.providerPayload as any).cursor_usage_raw.individualUsage.plan.used).toBe(30)
  })

  it('marks unsupported outcome as unsupported status', () => {
    const result: QuotaFetchResult = {
      outcome: 'unsupported',
      source: 'none',
      freshness: 'unknown',
      fetchedAt: new Date(),
      models: [],
      providerPayload: null,
      updatedCredential: undefined,
      error: undefined,
    }
    const state = fromFetchResultForPlatform('antigravity', result, undefined)
    expect(state.status).toBe('unsupported')
  })
})
