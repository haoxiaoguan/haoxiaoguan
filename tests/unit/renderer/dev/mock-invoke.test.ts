import { afterEach, describe, expect, it } from 'vitest';
import { installAccountsMock } from '@/dev/mock-invoke';

describe('accounts mock invoke', () => {
  afterEach(() => {
    window.history.pushState({}, '', '/');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).__TAURI_INTERNALS__;
  });

  it('returns Codex 5 hour and weekly quota windows', async () => {
    window.history.pushState({}, '', '/?mock=accounts');
    installAccountsMock();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const quotaState = await (window as any).__TAURI_INTERNALS__.invoke('get_quota_state', {
      accountId: 'codex-api',
    });

    expect(quotaState.primaryMetricKey).toBe('codex_hourly');
    expect(quotaState.metrics).toHaveLength(2);
    expect(quotaState.metrics[0]).toMatchObject({
      key: 'codex_hourly',
      label: '5小时额度',
      kind: 'remaining',
      unit: 'percent',
    });
    expect(quotaState.metrics[0].resetAt).toBeTruthy();
    expect(quotaState.metrics[1]).toMatchObject({
      key: 'codex_weekly',
      label: '周额度',
      kind: 'remaining',
      unit: 'percent',
    });
    expect(quotaState.metrics[1].resetAt).toBeTruthy();
  });
});
