import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ApiProxyLogs from '@/pages/ApiProxyLogs';
import { useRoutingObsStore } from '@/stores/routingObsStore';

// 回归：实时模式下「统计与日志不同步」。实时事件到达时，明细 tail 立即更新（pushLive），
// 但 KPI/趋势/下钻只在切范围或手动刷新时拉取 —— 导致 tail 在动、统计停在旧值。
// 修复后：实时事件到达应节流重拉 overview(summary/trend/topErrors)+breakdown，统计跟随 DB。

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: { defaultValue?: string }) => params?.defaultValue ?? key,
  }),
}));

type LiveCb = (batch: unknown[]) => void;
let liveCb: LiveCb | null = null;

function installBridge() {
  const summary = vi.fn(async () => ({
    requests: 0, success: 0, failed: 0, successRate: 0, errorRate: 0,
    avgDurationMs: 0, p95DurationMs: 0, avgTtfbMs: 0,
    inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
    totalTokens: 0, fallbackRequests: 0, comboRequests: 0, peakRpm: 0,
  }));
  const trend = vi.fn(async () => []);
  const breakdown = vi.fn(async () => []);
  const topErrors = vi.fn(async () => []);
  const search = vi.fn(async () => ({ rows: [] }));
  const clear = vi.fn(async () => {});
  const accountStats = vi.fn(async () => []);
  const detail = vi.fn(async () => undefined);
  const onEvent = vi.fn((cb: LiveCb) => {
    liveCb = cb;
    return () => {
      liveCb = null;
    };
  });
  (globalThis as unknown as { api: unknown }).api = {
    routingObs: { summary, trend, breakdown, topErrors, search, clear, accountStats, detail, onEvent },
  };
  return { summary, trend, breakdown, topErrors, search, onEvent };
}

function makeEvent(seq: number) {
  return {
    seq,
    tsMs: Date.now(),
    method: 'POST',
    path: '/v1/chat/completions',
    format: 'openai',
    action: 'chat',
    stream: true,
    status: 200,
    ok: true,
    errorKind: 'none',
    durationMs: 12,
    attempts: 1,
  };
}

describe('ApiProxyLogs 实时模式统计刷新', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    liveCb = null;
    useRoutingObsStore.setState({
      summary: null, trend: [], breakdown: [], errors: [], rows: [],
      cursor: undefined, hasMore: false, searching: false, detail: null,
      live: true, loading: false, error: null,
    });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('实时事件到达时，明细 tail 立即更新且节流重拉统计', async () => {
    const fns = installBridge();

    await act(async () => {
      render(<ApiProxyLogs />);
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    // 实时模式下应订阅 onEvent
    expect(fns.onEvent).toHaveBeenCalled();
    expect(typeof liveCb).toBe('function');

    // 忽略初次概览拉取
    fns.summary.mockClear();
    fns.trend.mockClear();
    fns.breakdown.mockClear();

    // 实时事件到达：tail 立即更新（log 侧）。
    await act(async () => {
      liveCb!([makeEvent(1)]);
    });
    expect(useRoutingObsStore.getState().rows.length).toBe(1);
    // 节流窗口内统计还不应重拉。
    expect(fns.summary).not.toHaveBeenCalled();

    // 过了节流间隔后：统计随 DB 重拉（修复点）。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2600);
    });
    expect(fns.summary).toHaveBeenCalledTimes(1);
    expect(fns.trend).toHaveBeenCalledTimes(1);
    expect(fns.breakdown).toHaveBeenCalledTimes(1);
  });
});
