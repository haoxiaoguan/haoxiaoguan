export function isDashboardDesignFixtureEnabled() {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    if (window.localStorage.getItem('dashboardFixture') === 'macos') {
      return true;
    }
  } catch {
    // ignore storage errors
  }

  const params = new URLSearchParams(window.location.search);
  return params.get('dashboardFixture') === 'macos';
}

export const dashboardDesignFixture = {
  summaryCards: [
    {
      accent: '#2563eb',
      title: '已接入平台',
      value: '10',
      hint: 'Cursor / Codex / Windsurf 等',
      iconTone: 'blue',
    },
    {
      accent: '#f59e0b',
      title: '本周 Token',
      value: '12.8M',
      hint: '输入 8.9M · 输出 3.9M',
      iconTone: 'amber',
    },
    {
      accent: '#22c55e',
      title: '活跃账号',
      value: '23',
      hint: '今日 18 · 本周 23',
      iconTone: 'emerald',
    },
    {
      accent: '#8b5cf6',
      title: '风险账号',
      value: '7',
      hint: '2 高危 · 5 需关注',
      iconTone: 'violet',
    },
  ],
  orchestration: {
    metrics: [
      { label: '可用账号', value: '23' },
      { label: '覆盖平台', value: '10' },
      { label: '今日切换', value: '38' },
      { label: '编排成功率', value: '98.6%', tone: 'success' },
    ],
    distribution: [
      { label: 'Cursor', value: '6', color: '#2563eb' },
      { label: 'Codex', value: '4', color: '#7c3aed' },
      { label: 'Windsurf', value: '3', color: '#06b6d4' },
      { label: 'Gemini', value: '3', color: '#22c55e' },
      { label: 'Copilot', value: '2', color: '#f59e0b' },
      { label: '其他', value: '5', color: '#d1d5db' },
    ],
  },
  health: {
    pending: '7 项待处理',
    rows: [
      {
        label: '账号凭证',
        value: '21/23',
        status: '正常',
        note: '',
        tone: 'emerald',
      },
      {
        label: '配额风险',
        value: '7',
        status: '7 个关注',
        note: '',
        tone: 'amber',
      },
      {
        label: '实例绑定',
        value: '18/20',
        status: '正常',
        note: '',
        tone: 'blue',
      },
      {
        label: '指纹隔离',
        value: '20/23',
        status: '正常',
        note: '',
        tone: 'violet',
      },
    ],
  },
  trend: {
    tabs: ['活跃趋势', '会话', 'Token', '工具', '配额'],
    rangeTabs: ['今日', '本周', '本月'],
    bars: [
      { label: '5/16', height: 122, pointY: 176 },
      { label: '5/17', height: 112, pointY: 154 },
      { label: '5/18', height: 138, pointY: 130 },
      { label: '5/19', height: 160, pointY: 104 },
      { label: '5/20', height: 182, pointY: 87 },
      { label: '5/21', height: 204, pointY: 70 },
      { label: '5/22', height: 167, pointY: 95 },
    ],
    legend: [
      { label: '总 Token', color: '#2563eb' },
      { label: '输入 Token', color: '#60a5fa' },
      { label: '输出 Token', color: '#22c55e' },
      { label: '缓存 Token', color: '#f59e0b' },
      { label: '累计总 Token', color: '#7c3aed' },
    ],
    donut: [
      { label: '输入 Token', ratio: '70%', value: '8.9M', color: '#2563eb' },
      { label: '输出 Token', ratio: '30%', value: '3.9M', color: '#22c55e' },
      { label: '缓存命中', ratio: '25%', value: '2.1M', color: '#f59e0b' },
    ],
  },
} as const;
