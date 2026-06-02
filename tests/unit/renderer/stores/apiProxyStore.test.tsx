import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiProxyStatus } from '@shared/api-types';
import { useApiProxyStore } from '@/stores/apiProxyStore';

// 用一个可控的 fake bridge 替换 window.api，断言 store 调用并落状态。
function installFakeApi(status: ApiProxyStatus) {
  const start = vi.fn(async (): Promise<ApiProxyStatus> => ({ state: 'running', port: 8788 }));
  const stop = vi.fn(async (): Promise<ApiProxyStatus> => ({ state: 'stopped' }));
  const getStatus = vi.fn(async (): Promise<ApiProxyStatus> => status);
  (globalThis as unknown as { api: unknown }).api = { apiProxy: { start, stop, getStatus } };
  return { start, stop, getStatus };
}

beforeEach(() => {
  // 重置 store 到初始态。
  useApiProxyStore.setState({ status: { state: 'stopped' }, loading: false, error: null });
});

describe('useApiProxyStore', () => {
  it('fetchStatus pulls status from the bridge', async () => {
    const fns = installFakeApi({ state: 'running', port: 9090 });
    await useApiProxyStore.getState().fetchStatus();
    expect(fns.getStatus).toHaveBeenCalledOnce();
    expect(useApiProxyStore.getState().status).toEqual({ state: 'running', port: 9090 });
  });

  it('start calls bridge.start and stores the returned running status', async () => {
    const fns = installFakeApi({ state: 'stopped' });
    await useApiProxyStore.getState().start();
    expect(fns.start).toHaveBeenCalledOnce();
    expect(useApiProxyStore.getState().status.state).toBe('running');
    expect(useApiProxyStore.getState().status.port).toBe(8788);
  });

  it('stop calls bridge.stop and stores the returned stopped status', async () => {
    const fns = installFakeApi({ state: 'running', port: 8788 });
    await useApiProxyStore.getState().stop();
    expect(fns.stop).toHaveBeenCalledOnce();
    expect(useApiProxyStore.getState().status.state).toBe('stopped');
  });
});
