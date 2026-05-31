// Single typed accessor to the preload bridge. Service modules call this
// instead of Tauri's invoke. In dev outside Electron, window.api is undefined;
// callers should be inside Electron for real data.
import type { HxgApi } from '@shared/api-types';

export function bridge(): HxgApi {
  const api = (globalThis as unknown as { api?: HxgApi }).api;
  if (!api) throw new Error('window.api is not available (preload bridge not loaded)');
  return api;
}
