import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { bridge } from '../../../services/bridge';
import { toast } from 'sonner';
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  Download,
  FolderOpen,
  Github,
  Loader2,
  MessageCircle,
  type LucideIcon,
} from 'lucide-react';
import brandLogo from '@/assets/brand/logo.png';
import { Button } from '@/components/ui/button';
import { useUpdaterStore } from '@/stores/updaterStore';
import { systemService } from '../../../services/tauri';
import type { AppDirs } from '../../../types';
import { SettingsLayout } from '../SettingsLayout';

const getVersion = () => bridge().getVersion();
const shellOpen = (target: string) => bridge().shellOpen(target);


const FALLBACK_VERSION = '0.3.0';
const DOCS_URL = 'https://github.com/haoxiaoguan/haoxiaoguan';
const ISSUES_URL = 'https://github.com/haoxiaoguan/haoxiaoguan/issues';
const GITHUB_URL = 'https://github.com/haoxiaoguan/haoxiaoguan';
const CHANGELOG_URL = 'https://github.com/haoxiaoguan/haoxiaoguan/releases';

export default function AboutSettings() {
  const { t } = useTranslation();
  const [version, setVersion] = useState(FALLBACK_VERSION);
  const [dirs, setDirs] = useState<AppDirs | null>(null);

  const updState = useUpdaterStore((s) => s.status.state);
  const updVersion = useUpdaterStore((s) => s.status.version);
  const initUpd = useUpdaterStore((s) => s.init);
  const checkUpdate = useUpdaterStore((s) => s.check);
  const openUpdDialog = useUpdaterStore((s) => s.openDialog);

  useEffect(() => {
    getVersion()
      .then((v) => setVersion(v || FALLBACK_VERSION))
      .catch(() => setVersion(FALLBACK_VERSION));
    systemService
      .getAppDirs()
      .then(setDirs)
      .catch(() => setDirs(null));
  }, []);

  // 订阅更新状态：store.init 内部按引用计数与顶栏 UpdaterIndicator 复用同一 IPC 订阅，
  // 重复 init 不会注册多余监听器；箭头函数返回 init() 的取消函数，卸载时递减引用计数。
  useEffect(() => initUpd(), [initUpd]);

  const onCheck = async () => {
    await checkUpdate();
    // dev 未打包时主进程 check 为 no-op，状态停在 idle，UI 仍显示「已是最新版本」。
    if (!import.meta.env.PROD) {
      toast.info(t('settings.about.devNoUpdate', '开发模式不检查更新（仅打包版生效）'));
    }
  };

  const hasUpdate =
    updState === 'available' || updState === 'downloading' || updState === 'downloaded';

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
          {updState === 'checking' ? (
            <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t('settings.about.checking', '正在检查更新…')}
            </p>
          ) : hasUpdate ? (
            <button
              type="button"
              onClick={openUpdDialog}
              className="mt-0.5 flex items-center gap-1.5 text-sm text-primary hover:underline"
            >
              <Download className="size-4" />
              {t('settings.about.found', '发现新版本')}
              {updVersion ? ` v${updVersion}` : ''}
            </button>
          ) : updState === 'error' ? (
            <button
              type="button"
              onClick={() => void onCheck()}
              className="mt-0.5 flex items-center gap-1.5 text-sm text-destructive hover:underline"
            >
              <AlertCircle className="size-4" />
              {t('settings.about.checkFailed', '检查失败，点击重试')}
            </button>
          ) : (
            <p className="mt-0.5 flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-500">
              <CheckCircle2 className="size-4" />
              {t('settings.about.latest', '已是最新版本')}
            </p>
          )}
        </div>
        <div className="ml-auto flex shrink-0 gap-2.5">
          <Button
            onClick={() => (hasUpdate ? openUpdDialog() : void onCheck())}
            disabled={updState === 'checking'}
          >
            {updState === 'checking' ? <Loader2 className="size-4 animate-spin" /> : null}
            {hasUpdate
              ? t('settings.about.viewUpdate', '查看更新')
              : t('settings.about.checkUpdate', '检查更新')}
          </Button>
          <Button variant="outline" onClick={() => openUrl(CHANGELOG_URL)}>
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
        {t('settings.about.footer', '© 2026 Haoxiaoguan · 基于 Electron / React / TypeScript 构建')}
      </p>
    </SettingsLayout>
  );
}
