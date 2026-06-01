import { describe, it, expect } from 'vitest'
import { profileFromImportMaterial } from '../../../src/main/contexts/account/domain/platform-profile'

// Ported 1:1 from the source platform_profile.rs test module. These pin the
// derived identity_key, display_identifier, plan/status fields, sensitive-key
// stripping, and the codex md5-based identity keys.

function payload(p: ReturnType<typeof profileFromImportMaterial>): Record<string, unknown> {
  return p.profilePayload as Record<string, unknown>
}

describe('profileFromImportMaterial', () => {
  it('kiro prefers user id and flattens usage fields', () => {
    const raw = {
      accessToken: 'secret',
      userInfo: { userId: 'D-9067C98495.449' },
      login_option: 'github',
      planName: 'Kiro Pro',
      planTier: 'pro',
      creditsTotal: 100,
      creditsUsed: 25,
      bonusTotal: 20,
      bonusUsed: 5,
    }
    const p = profileFromImportMaterial('kiro', 'fallback@example.com', raw, 'token')
    expect(p.identityKey).toBe('d-9067c98495.449')
    expect(p.displayIdentifier).toBe('D-9067C98495.449')
    expect(p.loginProvider).toBe('Github')
    expect(p.planName).toBe('Kiro Pro')
    expect(payload(p).creditsTotal).toBe(100)
    expect(payload(p).accessToken).toBeUndefined()
  })

  it('kiro pins explicit region + profileArn onto the payload', () => {
    const raw = {
      accessToken: 'secret',
      region: 'us-east-1',
      profileArn: 'arn:aws:codewhisperer:us-east-1:607416644019:profile/74G7G3NXYGXY',
      userInfo: { userId: 'ent-user' },
    }
    const p = profileFromImportMaterial('kiro', 'e@x.com', raw, 'token')
    expect(payload(p).region).toBe('us-east-1')
    expect(payload(p).profileArn).toBe(
      'arn:aws:codewhisperer:us-east-1:607416644019:profile/74G7G3NXYGXY',
    )
  })

  it('kiro derives region from the profile ARN when no explicit region is set', () => {
    const raw = {
      accessToken: 'secret',
      kiro_profile_raw: { arn: 'arn:aws:codewhisperer:eu-central-1:111122223333:profile/ABCDEF' },
      userInfo: { userId: 'eu-user' },
    }
    const p = profileFromImportMaterial('kiro', 'e@x.com', raw, 'token')
    expect(payload(p).region).toBe('eu-central-1')
    expect(payload(p).profileArn).toBe(
      'arn:aws:codewhisperer:eu-central-1:111122223333:profile/ABCDEF',
    )
  })

  it('kiro takes identity + plan from usage.userInfo for enterprise accounts', () => {
    // Enterprise: profile.json has only arn/name, token is opaque, identity is
    // in the usage telemetry's userInfo. Regression for the "kiro-user" bug.
    const raw = {
      accessToken: 'aoaAAAAA-opaque',
      kiro_profile_raw: {
        arn: 'arn:aws:codewhisperer:us-east-1:607416644019:profile/74G7G3NXYGXY',
        name: 'KiroProfile-us-east-1',
      },
      kiro_usage_raw: {
        userInfo: { email: 'galardo@example.com', userId: 'd-9067c98495.4498b488' },
        subscriptionInfo: { subscriptionTitle: 'KIRO FREE' },
      },
    }
    const p = profileFromImportMaterial('kiro', 'galardo@example.com', raw, 'token')
    expect(p.displayIdentifier).toBe('d-9067c98495.4498b488')
    expect(p.identityKey).toBe('d-9067c98495.4498b488')
    expect(p.planName).toBe('KIRO FREE')
    expect(p.displayIdentifier).not.toMatch(/^kiro-[0-9a-f]+$/)
  })

  it('cursor uses auth user id and keeps usage payload', () => {
    const raw = {
      user: { id: 'auth0|user_abc123', email: 'cursor@example.com' },
      membershipType: 'pro',
      plan: 'PRO',
      usage: {
        totalUsage: { used: 8, total: 20, unit: 'usd' },
        composer: { percentUsed: 51 },
        api: { percentUsed: 1 },
      },
      accessToken: 'secret',
    }
    const p = profileFromImportMaterial('cursor', 'fallback@example.com', raw, 'token')
    expect(p.identityKey).toBe('auth0-user_abc123')
    expect(p.displayIdentifier).toBe('cursor@example.com')
    expect(p.planName).toBe('PRO')
    expect(p.planTier).toBe('pro')
    expect(payload(p).userId).toBe('auth0|user_abc123')
    expect(((payload(p).usage as Record<string, Record<string, unknown>>).composer).percentUsed).toBe(51)
    expect(payload(p).accessToken).toBeUndefined()
  })

  it('gemini extracts account and quota', () => {
    const raw = {
      account: { id: 'gemini-user-1', email: 'gemini@example.com' },
      quota: {
        pro: { remainingPercent: 0, resetIn: 'soon' },
        flash: { remainingPercent: 100, resetIn: '24h' },
      },
    }
    const p = profileFromImportMaterial('gemini_cli', 'fallback@example.com', raw, 'token')
    expect(p.identityKey).toBe('gemini-user-1')
    expect(p.displayIdentifier).toBe('gemini@example.com')
    expect(((payload(p).quota as Record<string, Record<string, unknown>>).flash).remainingPercent).toBe(100)
  })

  it('codex uses account_id + plan and md5 storage identity', () => {
    const raw = { account_id: 'org-user-123', email: 'openai@example.com', plan: 'Plus', api: { usageUsd: 3.2, limitUsd: 20 } }
    const p = profileFromImportMaterial('codex', 'fallback@example.com', raw, 'token')
    expect(p.identityKey).toBe('codex_d05fb2f68a48c44f1ff541632c707185')
    expect(p.displayIdentifier).toBe('openai@example.com')
    expect(p.planName).toBe('Plus')
    expect(((payload(p).api as Record<string, unknown>)).limitUsd).toBe(20)
  })

  it('codex uses reference storage identity (email|account|org md5)', () => {
    const raw = {
      email: 'openai@example.com',
      account_id: 'acct-reference',
      organization_id: 'org-reference',
      plan_type: 'plus',
    }
    const p = profileFromImportMaterial('codex', 'fallback@example.com', raw, 'token')
    expect(p.identityKey).toBe('codex_d0d6364fdfc7ea6e7c21e59616c0d2ed')
    expect(payload(p).codexStorageId).toBe('codex_d0d6364fdfc7ea6e7c21e59616c0d2ed')
  })

  it('github copilot prefers login for display', () => {
    const raw = { user: { login: 'octocat', id: 12345, email: 'team@github.com' }, plan: { name: 'Team' }, deviceCode: true }
    const p = profileFromImportMaterial('github_copilot', 'fallback@example.com', raw, 'token')
    expect(p.identityKey).toBe('12345')
    expect(p.displayIdentifier).toBe('octocat')
    expect(p.planName).toBe('Team')
    expect(p.loginProvider).toBe('GitHub')
  })

  it('windsurf aligns reference account fields and strips secrets', () => {
    const raw = {
      id: 'windsurf-octocat',
      github_login: 'octocat',
      github_id: 12345,
      github_email: 'octo@example.com',
      github_access_token: 'secret',
      copilot_token: 'secret',
      copilot_plan: 'Pro',
      copilot_chat_enabled: true,
      copilot_limited_user_quotas: { chat: { used: 10, limit: 50 } },
      windsurf_user_status: { planStatus: { active: true } },
      windsurf_token_type: 'devin-session',
      devin_account_id: 'account-1',
      devin_org_id: 'org-1',
      quota_query_last_error: 'rate limited',
      usage_updated_at: 1_779_888_000,
    }
    const p = profileFromImportMaterial('windsurf', 'fallback@example.com', raw, 'token')
    expect(p.identityKey).toBe('12345')
    expect(p.displayIdentifier).toBe('octocat')
    expect(p.loginProvider).toBe('GitHub')
    expect(p.planName).toBe('Pro')
    expect(payload(p).githubLogin).toBe('octocat')
    expect(payload(p).githubId).toBe(12345)
    expect(payload(p).copilotPlan).toBe('Pro')
    expect(payload(p).windsurfTokenType).toBe('devin-session')
    expect(payload(p).devinAccountId).toBe('account-1')
    expect(payload(p).quotaQueryLastError).toBe('rate limited')
    expect(payload(p).github_access_token).toBeUndefined()
    expect(payload(p).copilot_token).toBeUndefined()
  })

  it('codebuddy aligns reference account fields', () => {
    const raw = {
      id: 'codebuddy-1',
      email: 'buddy@example.com',
      uid: 'uid-1',
      nickname: 'Buddy',
      enterprise_id: 'ent-1',
      enterprise_name: 'Example Inc',
      access_token: 'secret',
      plan_type: 'team',
      dosage_notify_code: 'normal',
      dosage_notify_zh: '额度正常',
      payment_type: 'paid',
      quota_raw: { userResource: { used: 12, total: 100 } },
      status: 'active',
      last_checkin_time: 1_779_888_000,
      checkin_streak: 3,
      checkin_rewards: { credits: 10 },
    }
    const p = profileFromImportMaterial('codebuddy', 'fallback@example.com', raw, 'token')
    expect(p.identityKey).toBe('uid-1')
    expect(p.displayIdentifier).toBe('buddy@example.com')
    expect(p.planTier).toBe('team')
    expect(p.status).toBe('active')
    expect(payload(p).uid).toBe('uid-1')
    expect(payload(p).nickname).toBe('Buddy')
    expect(payload(p).enterpriseName).toBe('Example Inc')
    expect(payload(p).planType).toBe('team')
    expect(((payload(p).quota_raw as Record<string, Record<string, unknown>>).userResource).total).toBe(100)
    expect(payload(p).access_token).toBeUndefined()
  })

  it('codebuddy_cn uses same fields with cn prefix', () => {
    const raw = {
      email: 'buddy-cn@example.com',
      uid: 'cn-uid-1',
      nickname: '腾讯云代码助手',
      domain: 'cloud.tencent.com',
      refresh_token: 'secret',
      plan_type: 'enterprise',
      quota_raw: { userResource: { used: 1, total: 10 } },
    }
    const p = profileFromImportMaterial('codebuddy_cn', 'fallback@example.com', raw, 'token')
    expect(p.identityKey).toBe('cn-uid-1')
    expect(p.displayIdentifier).toBe('buddy-cn@example.com')
    expect(p.planTier).toBe('enterprise')
    expect(payload(p).domain).toBe('cloud.tencent.com')
    expect(payload(p).planType).toBe('enterprise')
    expect(payload(p).refresh_token).toBeUndefined()
  })

  it('qoder aligns reference account fields', () => {
    const raw = {
      id: 'qoder-account',
      email: 'qoder@example.com',
      user_id: 'qoder-user-1',
      display_name: 'Qoder User',
      plan_type: 'pro',
      credits_used: 40,
      credits_total: 100,
      credits_remaining: 60,
      credits_usage_percent: 40,
      auth_credit_usage_raw: {
        userQuota: { used: 40, total: 100 },
        addOnQuota: { used: 5, total: 25 },
        resourcePackage: { used: 3 },
      },
    }
    const p = profileFromImportMaterial('qoder', 'fallback@example.com', raw, 'token')
    expect(p.identityKey).toBe('qoder-user-1')
    expect(p.displayIdentifier).toBe('qoder@example.com')
    expect(p.planTier).toBe('pro')
    expect(payload(p).displayName).toBe('Qoder User')
    expect(payload(p).creditsUsed).toBe(40)
    expect(payload(p).creditsTotal).toBe(100)
    expect(((payload(p).auth_credit_usage_raw as Record<string, Record<string, unknown>>).addOnQuota).total).toBe(25)
  })

  it('trae aligns reference account fields', () => {
    const raw = {
      id: 'trae-account',
      email: 'trae@example.com',
      user_id: 'trae-user-1',
      nickname: 'Trae User',
      access_token: 'secret',
      plan_type: 'pro',
      plan_reset_at: 1_779_888_000,
      trae_usage_raw: { code: 0 },
      status: 'active',
    }
    const p = profileFromImportMaterial('trae', 'fallback@example.com', raw, 'token')
    expect(p.identityKey).toBe('trae-user-1')
    expect(p.displayIdentifier).toBe('trae@example.com')
    expect(p.planTier).toBe('pro')
    expect(p.status).toBe('active')
    expect(payload(p).nickname).toBe('Trae User')
    expect(payload(p).planResetAt).toBe(1_779_888_000)
    expect(((payload(p).trae_usage_raw as Record<string, unknown>)).code).toBe(0)
    expect(payload(p).access_token).toBeUndefined()
  })

  it('zed aligns reference account fields', () => {
    const raw = {
      id: 'zed-account',
      user_id: 'zed-user-1',
      github_login: 'zedhub',
      display_name: 'Zed User',
      avatar_url: 'https://example.com/avatar.png',
      plan_raw: 'pro',
      subscription_status: 'active',
      token_spend_used_cents: 1250,
      token_spend_limit_cents: 5000,
      token_spend_remaining_cents: 3750,
      edit_predictions_used: 12,
      edit_predictions_limit_raw: '100',
      edit_predictions_remaining_raw: '88',
      access_token: 'secret',
    }
    const p = profileFromImportMaterial('zed', 'fallback@example.com', raw, 'token')
    expect(p.identityKey).toBe('zed-user-1')
    expect(p.displayIdentifier).toBe('zedhub')
    expect(p.planName).toBe('pro')
    expect(p.status).toBe('active')
    expect(payload(p).githubLogin).toBe('zedhub')
    expect(payload(p).displayName).toBe('Zed User')
    expect(payload(p).tokenSpendLimitCents).toBe(5000)
    expect(payload(p).editPredictionsRemainingRaw).toBe('88')
    expect(payload(p).access_token).toBeUndefined()
  })

  it('generic (non-special key) profile extracts common identity/plan fields', () => {
    const raw = {
      user: { id: 'zed-user-1', username: 'zed.dev' },
      subscription: { tier: 'plus' },
      status: 'active',
      refreshToken: 'secret',
    }
    const p = profileFromImportMaterial('zed', 'fallback@example.com', raw, 'token')
    expect(p.identityKey).toBe('zed-user-1')
    expect(p.displayIdentifier).toBe('zed.dev')
    expect(p.planTier).toBe('plus')
    expect(p.status).toBe('active')
    expect(payload(p).refreshToken).toBeUndefined()
  })
})
