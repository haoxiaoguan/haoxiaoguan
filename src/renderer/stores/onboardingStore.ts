/**
 * onboardingStore — 账号导入向导的全局状态。
 *
 * 不直接管理 OAuth callback；那个由 Tauri 后端负责，前端通过事件订阅得到结果后
 * 调用 `setMaterial` 把标准化的 ImportedCredentialMaterial 注入。
 */
import { create } from 'zustand';
import type { ImportedCredentialMaterial, OAuthPending } from '../services/tauri';
import type { PlatformId } from '../types';

export type OnboardingMethod = 'oauth' | 'token_json' | 'token_batch' | 'local_scan';

export type OnboardingStep =
  | 'idle'
  | 'method_select'
  | 'oauth_pending'
  | 'collecting_input'
  | 'reviewing'
  | 'committing'
  | 'completed'
  | 'failed';

interface OnboardingState {
  step: OnboardingStep;
  provider: PlatformId | null;
  method: OnboardingMethod | null;
  pending: OAuthPending | null;
  material: ImportedCredentialMaterial | null;
  error: string | null;

  start: (provider: PlatformId, method: OnboardingMethod) => void;
  setPending: (pending: OAuthPending) => void;
  setMaterial: (material: ImportedCredentialMaterial) => void;
  fail: (error: string) => void;
  finish: () => void;
  reset: () => void;
}

export const useOnboardingStore = create<OnboardingState>((set) => ({
  step: 'idle',
  provider: null,
  method: null,
  pending: null,
  material: null,
  error: null,

  start: (provider, method) =>
    set({
      step: method === 'oauth' ? 'oauth_pending' : 'collecting_input',
      provider,
      method,
      pending: null,
      material: null,
      error: null,
    }),
  setPending: (pending) => set({ pending, step: 'oauth_pending' }),
  setMaterial: (material) => set({ material, step: 'reviewing' }),
  fail: (error) => set({ step: 'failed', error }),
  finish: () => set({ step: 'completed' }),
  reset: () =>
    set({
      step: 'idle',
      provider: null,
      method: null,
      pending: null,
      material: null,
      error: null,
    }),
}));
