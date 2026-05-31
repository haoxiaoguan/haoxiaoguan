import { dashboardDesignFixture } from './dashboardDesignFixture';

export type DashboardVisualPresetName = 'macos';

const DASHBOARD_VISUAL_PRESET_QUERY_KEY = 'dashboardPreset';
const DASHBOARD_VISUAL_PRESET_STORAGE_KEY = 'dashboardPreset';
const DASHBOARD_VISUAL_PRESET_GLOBAL_KEY = '__HAOXIAOGUAN_DASHBOARD_PRESET__';

function isMacosPreset(value: string | null | undefined): value is DashboardVisualPresetName {
  return value === 'macos';
}

function readDashboardVisualPresetFromRuntime(): DashboardVisualPresetName | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const localStorageValue = window.localStorage.getItem(DASHBOARD_VISUAL_PRESET_STORAGE_KEY);
    if (isMacosPreset(localStorageValue)) {
      return localStorageValue;
    }
  } catch {
    // ignore storage access errors
  }

  const globalPreset = (window as typeof window & { [DASHBOARD_VISUAL_PRESET_GLOBAL_KEY]?: unknown })[
    DASHBOARD_VISUAL_PRESET_GLOBAL_KEY
  ];
  if (typeof globalPreset === 'string' && isMacosPreset(globalPreset)) {
    return globalPreset;
  }

  const params = new URLSearchParams(window.location.search);
  const queryPreset = params.get(DASHBOARD_VISUAL_PRESET_QUERY_KEY);
  return isMacosPreset(queryPreset) ? queryPreset : null;
}

export function getDashboardVisualPresetName() {
  return readDashboardVisualPresetFromRuntime();
}

export function isDashboardVisualPresetEnabled() {
  return readDashboardVisualPresetFromRuntime() !== null;
}

export const dashboardVisualPreset = {
  macos: {
    ...dashboardDesignFixture,
    platformUsage: {
      title: '平台 Token 来源',
      subtitle: '统一按 Token 口径展示主要平台来源分布',
    },
    quotaRisk: {
      title: '配额风险',
      subtitle: '优先展示高风险账号，帮助快速关注异常配额。',
      periodLabel: '本周',
    },
  },
} as const;

export function getDashboardVisualPreset() {
  const presetName = readDashboardVisualPresetFromRuntime();
  return presetName ? dashboardVisualPreset[presetName] : null;
}
