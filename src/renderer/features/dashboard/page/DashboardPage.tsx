import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  CircleSlash,
  Folder,
  Gauge,
  Server,
  Sparkles,
  Users,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { useAccountStore } from '@/stores/accountStore';
import { usageService } from '@/services/tauri';
import { cn } from '@/lib/utils';
import type { Account, PlatformId } from '@/types';
import { ActivityHeatmap } from '../components/ActivityHeatmap';
import { KpiCard } from '../components/KpiCard';
import DashboardMacosDesign from './DashboardMacosDesign';
import { isDashboardDesignFixtureEnabled } from './dashboardDesignFixture';

const DASHBOARD_PLATFORMS: PlatformId[] = [
  'cursor',
  'windsurf',
  'kiro',
  'github-copilot',
  'codex',
  'gemini-cli',
  'codebuddy',
  'codebuddy-cn',
  'qoder',
  'trae',
  'zed',
];

const HEATMAP_WEEKS = 26;

function buildPlaceholderHeatmap(): number[] {
  // Stable seed-based pseudo random for SSR-free render. Pure visual placeholder.
  const length = HEATMAP_WEEKS * 7;
  const out: number[] = [];
  for (let i = 0; i < length; i++) {
    // Mostly zeros with sparse activity, biased toward recent weeks
    const recency = i / length;
    const r = Math.abs(Math.sin(i * 12.9898 + 78.233)) % 1;
    if (r < 0.55 - recency * 0.15) {
      out.push(0);
    } else {
      out.push(Math.floor((r - 0.4) * 10));
    }
  }
  return out;
}

interface HealthRowSpec {
  labelKey: string;
  status: 'ok' | 'missing' | 'syncError';
  detail: string;
}

function statusBadgeClass(status: HealthRowSpec['status']): string {
  switch (status) {
    case 'ok':
      return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400';
    case 'missing':
      return 'bg-amber-500/15 text-amber-600 dark:text-amber-400';
    case 'syncError':
      return 'bg-red-500/15 text-red-600 dark:text-red-400';
  }
}

function statusIcon(status: HealthRowSpec['status']) {
  if (status === 'ok') return CheckCircle2;
  return CircleSlash;
}

function LiveDashboardPage() {
  const { t } = useTranslation();
  const { accounts: accountsByPlatform, fetchAccounts } = useAccountStore();
  const [, setUsageRefreshKey] = useState(0);

  useEffect(() => {
    DASHBOARD_PLATFORMS.forEach((platform) => {
      void fetchAccounts(platform);
    });
  }, [fetchAccounts]);

  useEffect(() => {
    let cancelled = false;
    void usageService
      .syncUsageSources()
      .then(() => {
        if (!cancelled) setUsageRefreshKey((v) => v + 1);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const totalAccounts = useMemo(() => {
    let total = 0;
    accountsByPlatform.forEach((list) => {
      total += list.length;
    });
    return total;
  }, [accountsByPlatform]);

  const platformsCovered = useMemo(() => {
    let covered = 0;
    accountsByPlatform.forEach((list) => {
      if (list.length > 0) covered++;
    });
    return covered;
  }, [accountsByPlatform]);

  const activeAccount: Account | null = useMemo(() => {
    for (const list of accountsByPlatform.values()) {
      const found = list.find((a) => a.isActive);
      if (found) return found;
    }
    return null;
  }, [accountsByPlatform]);

  const healthRows: HealthRowSpec[] = useMemo(
    () => [
      {
        labelKey: 'dashboard:health.stores.accounts',
        status: 'ok',
        detail: `${totalAccounts}`,
      },
      {
        labelKey: 'dashboard:health.stores.platforms',
        status: 'ok',
        detail: `${platformsCovered}/${DASHBOARD_PLATFORMS.length}`,
      },
    ],
    [totalAccounts, platformsCovered],
  );

  const heatmapValues = useMemo(() => buildPlaceholderHeatmap(), []);

  return (
    <div data-testid="dashboard-page-scroll-container" className="h-full overflow-y-auto">
      <div className="flex flex-col gap-6 px-4 pb-6 pt-12 lg:px-6 lg:pt-14">
        <PageHeader title={t('dashboard:title')} subtitle={t('dashboard:subtitle')} />

        {/* Top KPI lane */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            accent="blue"
            icon={Users}
            label={t('dashboard:kpis.accounts')}
            value={totalAccounts}
            hint={`${platformsCovered}/${DASHBOARD_PLATFORMS.length} ${t('dashboard:kpis.platformsUnit')}`}
          />
          <KpiCard
            accent="emerald"
            icon={Server}
            label={t('dashboard:kpis.mcp')}
            value={0}
            hint={t('dashboard:kpis.comingSoon')}
          />
          <KpiCard
            accent="violet"
            icon={Sparkles}
            label={t('dashboard:kpis.skills')}
            value={0}
            hint={t('dashboard:kpis.comingSoon')}
          />
        </div>

        {/* Active account + Data health */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-7">
          <ActiveAccountCard className="lg:col-span-4" account={activeAccount} />
          <DataHealthCard className="lg:col-span-3" rows={healthRows} />
        </div>

        {/* Activity heatmap */}
        <div className="rounded-2xl border border-border bg-card p-5 shadow-bento-light dark:shadow-bento">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Gauge className="size-4 text-muted-foreground" strokeWidth={1.85} />
              <h2 className="text-[15px] font-semibold text-foreground">
                {t('dashboard:trend.title')}
              </h2>
            </div>
          </div>
          <ActivityHeatmap
            values={heatmapValues}
            lessLabel={t('dashboard:trend.less')}
            moreLabel={t('dashboard:trend.more')}
          />
        </div>
      </div>
    </div>
  );
}

interface ActiveAccountCardProps {
  account: Account | null;
  className?: string;
}

function ActiveAccountCard({ account, className }: ActiveAccountCardProps) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        'flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-bento-light dark:shadow-bento',
        className,
      )}
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[13px] font-medium text-muted-foreground">
            {t('dashboard:activeAccount.title')}
          </div>
          <div className="mt-1 truncate text-[18px] font-semibold text-foreground">
            {account?.email ?? t('dashboard:activeAccount.empty')}
          </div>
        </div>
        <Button variant="outline" size="sm">
          {t('dashboard:activeAccount.switch')}
        </Button>
      </div>

      <QuotaRow
        label={t('dashboard:activeAccount.fiveHour')}
        used={account ? 99 : 0}
        total={100}
      />
      <QuotaRow
        label={t('dashboard:activeAccount.weekly')}
        used={account ? 100 : 0}
        total={100}
      />
    </div>
  );
}

function QuotaRow({ label, used, total }: { label: string; used: number; total: number }) {
  const ratio = Math.min(1, total > 0 ? used / total : 0);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-[12px] text-muted-foreground">
        <span>{label}</span>
        <span>
          {used} / {total}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#2563eb] to-[#8b5cf6]"
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
    </div>
  );
}

interface DataHealthCardProps {
  rows: HealthRowSpec[];
  className?: string;
}

function DataHealthCard({ rows, className }: DataHealthCardProps) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        'flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-bento-light dark:shadow-bento',
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <div className="text-[13px] font-medium text-muted-foreground">
          {t('dashboard:health.title')}
        </div>
        <Button variant="ghost" size="sm" className="gap-1.5">
          <Folder className="size-3.5" strokeWidth={1.85} />
          <span>{t('dashboard:health.openFolder')}</span>
        </Button>
      </div>

      <ul className="flex flex-col gap-2">
        {rows.map((row) => {
          const Icon = statusIcon(row.status);
          return (
            <li
              key={row.labelKey}
              className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/30 px-3 py-2"
            >
              <span className="text-[13px] text-foreground">{t(row.labelKey)}</span>
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium',
                  statusBadgeClass(row.status),
                )}
              >
                <Icon className="size-3" strokeWidth={2} />
                {t(`dashboard:health.${row.status}`)}
                <span className="text-muted-foreground">· {row.detail}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function DashboardPage() {
  const [designFixtureEnabled, setDesignFixtureEnabled] = useState(() =>
    isDashboardDesignFixtureEnabled(),
  );

  useEffect(() => {
    const sync = () => {
      setDesignFixtureEnabled(isDashboardDesignFixtureEnabled());
    };
    window.addEventListener('haoxiaoguan-dashboard-fixture-change', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('haoxiaoguan-dashboard-fixture-change', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  if (designFixtureEnabled) {
    return <DashboardMacosDesign />;
  }

  return <LiveDashboardPage />;
}
