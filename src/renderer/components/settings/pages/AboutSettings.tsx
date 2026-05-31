import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { bridge } from '../../../services/bridge';
import { toast } from 'sonner';
import {
  BookOpen,
  CheckCircle2,
  Download,
  FolderOpen,
  Github,
  MessageCircle,
  type LucideIcon,
} from 'lucide-react';
import brandLogo from '@/assets/brand/logo.png';
import { Button } from '@/components/ui/button';
import { systemService } from '../../../services/tauri';
import type { AppDirs } from '../../../types';
import { SettingsLayout } from '../SettingsLayout';

const getVersion = () => bridge().getVersion();
const shellOpen = (target: string) => bridge().shellOpen(target);


const FALLBACK_VERSION = '0.3.0';
const DOCS_URL = 'https://github.com/haoxiaoguan/haoxiaoguan';
const ISSUES_URL = 'https://github.com/haoxiaoguan/haoxiaoguan/issues';
const GITHUB_URL = 'https://github.com/haoxiaoguan/haoxiaoguan';

export default function AboutSettings() {
  const { t } = useTranslation();
  const [version, setVersion] = useState(FALLBACK_VERSION);
  const [dirs, setDirs] = useState<AppDirs | null>(null);

  useEffect(() => {
    getVersion()
      .then((v) => setVersion(v || FALLBACK_VERSION))
      .catch(() => setVersion(FALLBACK_VERSION));
    systemService
      .getAppDirs()
      .then(setDirs)
      .catch(() => setDirs(null));
  }, []);

  const openUrl = async (url: string) => {
    try {
      await shellOpen(url);
    } catch {
      toast.error(t('settings.about.openFailed', '无法打开链接'));
    }
  };

  const openDir = async (path: string) => {
    try {
      await shellOpen(path);
    } catch {
      toast.error(t('settings.about.openFailed', '无法打开目录'));
    }
  };

  const dirRows: { labelKey: string; fallback: string; value?: string }[] = [
    { labelKey: 'settings.about.dataDir', fallback: '数据目录', value: dirs?.dataDir },
    { labelKey: 'settings.about.configDir', fallback: '配置目录', value: dirs?.configDir },
    { labelKey: 'settings.about.logDir', fallback: '日志目录', value: dirs?.logDir },
  ];

  const supportButtons: { labelKey: string; fallback: string; icon: LucideIcon; onClick: () => void }[] = [
    { labelKey: 'settings.about.docs', fallback: '使用文档', icon: BookOpen, onClick: () => openUrl(DOCS_URL) },
    { labelKey: 'settings.about.feedback', fallback: '问题反馈', icon: MessageCircle, onClick: () => openUrl(ISSUES_URL) },
    {
      labelKey: 'settings.about.diagnostics',
      fallback: '导出诊断信息',
      icon: Download,
      onClick: () => toast.info(t('settings.about.comingSoon', '即将推出')),
    },
    { labelKey: 'settings.about.github', fallback: 'GitHub 项目', icon: Github, onClick: () => openUrl(GITHUB_URL) },
  ];

  return (
    <SettingsLayout
      title={t('settings.about.title', '关于')}
      description={t('settings.about.desc', '查看应用版本与支持信息。')}
    >
      {/* 应用卡片 */}
      <section className="flex items-center gap-5 rounded-xl border border-border/70 bg-card px-5 py-5">
        <img src={brandLogo} alt="" className="size-14 rounded-2xl" />
        <div className="min-w-0">
          <p className="text-lg font-semibold leading-tight">{t('common:brand.name', '号小管')}</p>
          <p className="text-sm text-muted-foreground">{t('common:brand.tagline', '多平台账号助手')}</p>
        </div>
        <div className="ml-2 min-w-0">
          <p className="text-base font-medium">{t('settings.about.version', '版本')} {version}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-500">
            <CheckCircle2 className="size-4" />
            {t('settings.about.latest', '已是最新版本')}
          </p>
        </div>
        <div className="ml-auto flex shrink-0 gap-2.5">
          <Button onClick={() => toast.info(t('settings.about.comingSoon', '即将推出'))}>
            {t('settings.about.checkUpdate', '检查更新')}
          </Button>
          <Button variant="outline" onClick={() => toast.info(t('settings.about.comingSoon', '即将推出'))}>
            {t('settings.about.changelog', '更新日志')}
          </Button>
        </div>
      </section>

      {/* 应用位置 */}
      <section className="rounded-xl border border-border/70 bg-card">
        <header className="px-5 py-3.5 text-sm font-semibold">
          {t('settings.about.location', '应用位置')}
        </header>
        <div className="divide-y divide-border/50 border-t border-border/60">
          {dirRows.map((row) => (
            <div key={row.labelKey} className="flex items-center gap-4 px-5 py-3.5">
              <span className="w-20 shrink-0 text-sm text-foreground/80">{t(row.labelKey, row.fallback)}</span>
              <code className="min-w-0 flex-1 truncate font-mono text-[13px] text-muted-foreground">
                {row.value ?? '—'}
              </code>
              <Button
                variant="outline"
                size="icon-sm"
                disabled={!row.value}
                aria-label={t('settings.about.openFolder', '打开文件夹')}
                onClick={() => row.value && openDir(row.value)}
              >
                <FolderOpen className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      </section>

      {/* 支持 */}
      <section className="rounded-xl border border-border/70 bg-card p-5">
        <p className="mb-4 text-sm font-semibold">{t('settings.about.support', '支持')}</p>
        <div className="grid grid-cols-2 gap-3">
          {supportButtons.map((b) => {
            const Icon = b.icon;
            return (
              <Button
                key={b.labelKey}
                variant="outline"
                className="h-11 justify-center gap-2"
                onClick={b.onClick}
              >
                <Icon className="size-4" />
                {t(b.labelKey, b.fallback)}
              </Button>
            );
          })}
        </div>
      </section>

      {/* 页脚 */}
      <p className="pt-1 text-center text-xs text-muted-foreground">
        {t('settings.about.footer', '© 2026 Haoxiaoguan · 基于 Tauri / React / Rust 构建')}
      </p>
    </SettingsLayout>
  );
}
