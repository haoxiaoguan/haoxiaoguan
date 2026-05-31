import { describe, expect, it } from 'vitest';
import type { Account, AccountQuotaState } from '../../types';
import { metricLines } from './quota-display';

const baseAccount: Account = {
  id: 'a1',
  platform: 'cursor',
  email: 'cursor-user',
  identityKey: 'cursor-user',
  displayIdentifier: 'cursor-user',
  profilePayload: {},
  tags: ['Cursor'],
  isActive: false,
  createdAt: '2026-05-01T10:00:00Z',
};

const codexAccount: Account = {
  ...baseAccount,
  id: 'codex-1',
  platform: 'codex',
  email: 'codex-user',
  identityKey: 'codex-user',
  displayIdentifier: 'codex-user',
  tags: ['Codex'],
};

describe('quota-display', () => {
  it('does not render null quota pairs from persisted metric data', () => {
    const state: AccountQuotaState = {
      version: 1,
      status: 'warning',
      primaryMetricKey: 'auto_composer',
      metrics: [
        {
          key: 'auto_composer',
          label: 'Auto + Composer',
          kind: 'usage',
          unit: 'percent',
          used: null as unknown as number,
          total: null as unknown as number,
          percentUsed: 94.3,
          displayValue: '94.3%',
          status: 'warning',
        },
      ],
      providerPayload: {},
    };

    const [line] = metricLines(baseAccount, state);

    expect(line.value).toBe('94.3%');
    expect(line.subLabel).toBeUndefined();
  });

  it('uses Codex remaining quota thresholds for warning and danger tones', () => {
    const state: AccountQuotaState = {
      version: 1,
      status: 'ok',
      metrics: [
        {
          key: 'codex_weekly',
          label: '周额度',
          kind: 'remaining',
          unit: 'percent',
          percentRemaining: 49,
          percentUsed: 51,
          displayValue: '49% 剩余',
          status: 'ok',
        },
        {
          key: 'codex_hourly',
          label: '5小时额度',
          kind: 'remaining',
          unit: 'percent',
          percentRemaining: 19,
          percentUsed: 81,
          displayValue: '19% 剩余',
          status: 'ok',
        },
        {
          key: 'codex_monthly',
          label: '月额度',
          kind: 'remaining',
          unit: 'percent',
          percentRemaining: 50,
          percentUsed: 50,
          displayValue: '50% 剩余',
          status: 'ok',
        },
      ],
      providerPayload: {},
    };

    const lines = metricLines(codexAccount, state);

    expect(lines.map((line) => line.tone)).toEqual(['warning', 'danger', 'success']);
  });
});
