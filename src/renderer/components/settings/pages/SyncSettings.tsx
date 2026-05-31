import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  Check,
  CloudUpload,
  CloudDownload,
  Pencil,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { localBackupService, syncService } from '../../../services/tauri';
import type { LocalBackupConfig, LocalBackupEntry, RemoteInfo, WebdavConfig } from '../../../types';
import { cn, formatBytes, formatRelativeTime } from '@/lib/utils';
import { SettingsLayout } from '../SettingsLayout';

const RESTORE_GUARD_KEY = 'restore-guard-enabled';
const MAX_VISIBLE_BACKUPS = 5;

const BACKUP_INTERVAL_OPTIONS = [0, 1, 6, 12, 24] as const;

const DEFAULT_BACKUP_CONFIG: LocalBackupConfig = { intervalHours: 6, retainCount: 12 };

/** 从备份文件名解析可读的显示名（时间格式）。 */
function getDisplayName(filename: string): string {
  const m = filename.match(/^db_backup_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})(?:_\d+)?\.db$/);
  if (m) {
    const [, y, mo, d, hh, mm, ss] = m;
    return `${y}-${mo}-${d} ${hh}:${mm}:${ss}`;
  }
  return filename.replace(/\.db$/, '');
}

/** 服务商预设：选中后填充 baseUrl 模板（自定义不填）。 */
const PROVIDER_PRESETS: { id: string; labelKey: string; urlTemplate: string }[] = [
  { id: 'jianguoyun', labelKey: 'settings.sync.webdav.providerJianguoyun', urlTemplate: 'https://dav.jianguoyun.com/dav/' },
  { id: 'nextcloud', labelKey: 'settings.sync.webdav.providerNextcloud', urlTemplate: 'https://your-nextcloud.com/remote.php/dav/files/USERNAME/' },
  { id: 'nas', labelKey: 'settings.sync.webdav.providerNas', urlTemplate: '' },
  { id: 'custom', labelKey: 'settings.sync.webdav.providerCustom', urlTemplate: '' },
];

const DEFAULT_CONFIG: WebdavConfig = {
  enabled: false,
  baseUrl: '',
  username: '',
  remoteRoot: 'haoxiaoguan-sync',
  profile: 'default',
  autoSync: false,
  status: {},
};

export default function SyncSettings() {
  const { t } = useTranslation();

  // ---- WebDAV 配置/状态 ----
  const [config, setConfig] = useState<WebdavConfig | null>(null);
  const [form, setForm] = useState<WebdavConfig>(DEFAULT_CONFIG);
  const [provider, setProvider] = useState('custom');
  const [password, setPassword] = useState('');
  const [passwordDirty, setPasswordDirty] = useState(false);
  const [syncPassword, setSyncPassword] = useState('');
  const [syncPasswordDirty, setSyncPasswordDirty] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hasSavedPassword, setHasSavedPassword] = useState(false);
  const [hasSavedSyncPassword, setHasSavedSyncPassword] = useState(false);

  // ---- 配置弹窗 / 二次确认 / 重启提示 ----
  const [configOpen, setConfigOpen] = useState(false);
  const [confirmKind, setConfirmKind] = useState<'upload' | 'download' | null>(null);
  const [remoteInfo, setRemoteInfo] = useState<RemoteInfo | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [showRestart, setShowRestart] = useState(false);
  const [showAutoSyncConfirm, setShowAutoSyncConfirm] = useState(false);

  // ---- 本地备份区（DB 快照）----
  const [backups, setBackups] = useState<LocalBackupEntry[]>([]);
  const [backupsExpanded, setBackupsExpanded] = useState(false);
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [backupSettingsOpen, setBackupSettingsOpen] = useState(false);
  const [backupConfig, setBackupConfig] = useState<LocalBackupConfig>(DEFAULT_BACKUP_CONFIG);
  const [savingBackupConfig, setSavingBackupConfig] = useState(false);
  const [restoreGuard, setRestoreGuard] = useState(() => {
    try {
      return localStorage.getItem(RESTORE_GUARD_KEY) !== 'false';
    } catch {
      return true;
    }
  });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingFilename, setEditingFilename] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  useEffect(() => {
    loadConfig();
    loadBackups();
  }, []);

  const loadConfig = async () => {
    try {
      const data = await syncService.getConfig();
      setConfig(data);
      setForm(data);
      setHasSavedPassword(Boolean(data.baseUrl));
      setHasSavedSyncPassword(Boolean(data.enabled));
    } catch {
      setConfig(null);
      setForm(DEFAULT_CONFIG);
    }
  };

  const loadBackups = async () => {
    try {
      setBackups(await localBackupService.list());
    } catch {
      setBackups([]);
    }
  };

  const isConfigured = Boolean(config?.baseUrl);
  const remotePathPreview = `/${form.remoteRoot || 'haoxiaoguan-sync'}/v1/${form.profile || 'default'}`;
  const lastSyncAt = config?.status?.lastSyncAt;
  const showAutoError = config?.status?.lastErrorSource === 'auto' && config?.status?.lastError;

  // ---- 打开配置弹窗：以当前 config 填充表单，清空密码框 ----
  const openConfig = () => {
    setForm(config ?? DEFAULT_CONFIG);
    setProvider('custom');
    setPassword('');
    setPasswordDirty(false);
    setSyncPassword('');
    setSyncPasswordDirty(false);
    setConfigOpen(true);
  };

  const patchForm = (patch: Partial<WebdavConfig>) => setForm((f) => ({ ...f, ...patch }));

  const applyProvider = (id: string) => {
    setProvider(id);
    const preset = PROVIDER_PRESETS.find((p) => p.id === id);
    if (preset && preset.urlTemplate) {
      patchForm({ baseUrl: preset.urlTemplate });
    }
  };

  // ---- 测试连接 ----
  const handleTest = async () => {
    setTesting(true);
    try {
      await syncService.testConnection(form, passwordDirty ? password : undefined, passwordDirty);
      toast.success(t('settings.sync.testSuccess', '连接成功'));
    } catch (e) {
      toast.error(`${t('settings.sync.testFailed', '连接失败')}: ${String(e)}`);
    } finally {
      setTesting(false);
    }
  };

  // ---- 保存配置 ----
  const handleSave = async () => {
    setSaving(true);
    try {
      await syncService.saveConfig({
        config: form,
        password: passwordDirty ? password : undefined,
        passwordTouched: passwordDirty,
        syncPassword: syncPasswordDirty ? syncPassword : undefined,
        syncPasswordTouched: syncPasswordDirty,
      });
      toast.success(t('settings.sync.saveSuccess', '已保存'));
      setConfigOpen(false);
      await loadConfig();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSaving(false);
    }
  };

  // ---- 自动上传开关：首次开启二次确认 ----
  const handleAutoSyncToggle = (next: boolean) => {
    if (next && !form.autoSync) {
      setShowAutoSyncConfirm(true);
    } else {
      patchForm({ autoSync: next });
    }
  };

  // ---- 打开上传/下载确认弹窗（先拉远端信息）----
  const openConfirm = async (kind: 'upload' | 'download') => {
    setConfirmKind(kind);
    setRemoteInfo(null);
    setConfirmLoading(true);
    try {
      setRemoteInfo(await syncService.fetchRemoteInfo());
    } catch (e) {
      toast.error(String(e));
      setConfirmKind(null);
    } finally {
      setConfirmLoading(false);
    }
  };

  const closeConfirm = () => {
    setConfirmKind(null);
    setRemoteInfo(null);
  };

  const runUpload = async () => {
    setBusy(true);
    closeConfirm();
    try {
      await syncService.syncUpload();
      toast.success(t('settings.sync.uploadSuccess', '上传成功'));
      await loadConfig();
    } catch (e) {
      toast.error(`${t('settings.sync.syncFailed', '同步失败')}: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const runDownload = async () => {
    setBusy(true);
    closeConfirm();
    try {
      const result = await syncService.syncDownload();
      toast.success(t('settings.sync.downloadSuccess', '下载成功'));
      await loadConfig();
      if (result.needsRestart) setShowRestart(true);
    } catch (e) {
      toast.error(`${t('settings.sync.syncFailed', '同步失败')}: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  // ---- 本地备份区操作（DB 快照）----
  const handleCreateBackup = async () => {
    setCreatingBackup(true);
    try {
      const entry = await localBackupService.create();
      toast.success(t('settings.sync.createBackupSuccess', '备份已创建：{{filename}}', { filename: entry.filename }));
      await loadBackups();
    } catch (e) {
      toast.error(`${t('settings.sync.createBackupFailed', '创建备份失败')}: ${String(e)}`);
    } finally {
      setCreatingBackup(false);
    }
  };

  const handleRestore = async (filename: string) => {
    setBusyId(filename);
    try {
      const safety = await localBackupService.restore(filename);
      toast.success(t('settings.sync.restoreSuccess', '已从 {{filename}} 还原，安全备份：{{safety}}', { filename, safety }));
      await loadBackups();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusyId(null);
    }
  };

  const handleStartRename = (filename: string) => {
    setEditingFilename(filename);
    setEditValue(getDisplayName(filename));
  };

  const handleCancelRename = () => {
    setEditingFilename(null);
    setEditValue('');
  };

  const handleConfirmRename = async () => {
    if (!editingFilename || !editValue.trim()) return;
    setBusyId(editingFilename);
    try {
      await localBackupService.rename(editingFilename, editValue.trim());
      setEditingFilename(null);
      setEditValue('');
      await loadBackups();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (filename: string) => {
    setBusyId(filename);
    try {
      await localBackupService.remove(filename);
      await loadBackups();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusyId(null);
    }
  };

  const openBackupSettings = async () => {
    try {
      setBackupConfig(await localBackupService.getConfig());
    } catch {
      setBackupConfig(DEFAULT_BACKUP_CONFIG);
    }
    setBackupSettingsOpen(true);
  };

  const saveBackupConfig = async () => {
    setSavingBackupConfig(true);
    try {
      await localBackupService.saveConfig(backupConfig);
      toast.success(t('settings.sync.backupSettingsSaved', '备份设置已保存'));
      setBackupSettingsOpen(false);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSavingBackupConfig(false);
    }
  };

  const toggleGuard = (next: boolean) => {
    setRestoreGuard(next);
    try {
      localStorage.setItem(RESTORE_GUARD_KEY, String(next));
    } catch {
      // ignore
    }
  };

  const visibleBackups = backupsExpanded ? backups : backups.slice(0, MAX_VISIBLE_BACKUPS);

  return (
    <SettingsLayout
      title={t('settings.sync.title', '同步与备份')}
      description={t('settings.sync.desc', '管理配置同步、本地备份与恢复。')}
    >
      {/* WebDAV 同步状态 */}
      <section className="rounded-xl border border-border/70 bg-card p-5">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">{t('settings.sync.webdav.sectionTitle', 'WebDAV 云同步')}</p>
          <Button size="sm" variant="outline" onClick={openConfig}>
            <Settings2 className="size-3.5" />
            {t('settings.sync.configure', '配置')}
          </Button>
        </div>
        <div className="mt-3 flex items-start justify-between gap-4">
          <div className="flex items-start gap-2.5">
            <span
              className={cn(
                'mt-1 size-2.5 shrink-0 rounded-full',
                isConfigured ? 'bg-emerald-500' : 'bg-muted-foreground/40',
              )}
            />
            <div>
              <p className="text-sm font-medium">
                {isConfigured
                  ? t('settings.sync.statusConfigured', '已配置')
                  : t('settings.sync.statusNotConfigured', '未配置 WebDAV')}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {isConfigured
                  ? `${t('settings.sync.lastSync', '最近同步')}：${
                      lastSyncAt ? formatRelativeTime(lastSyncAt) : t('settings.sync.neverSynced', '从未同步')
                    }`
                  : t('settings.sync.statusNotConfiguredDesc', '点击右上角「配置」填写 WebDAV 服务器信息以启用云同步。')}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 gap-2.5">
            <Button size="sm" disabled={!isConfigured || busy} onClick={() => openConfirm('upload')}>
              <CloudUpload className="size-3.5" />
              {t('settings.sync.uploadNow', '立即上传')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!isConfigured || busy}
              onClick={() => openConfirm('download')}
            >
              <CloudDownload className="size-3.5" />
              {t('settings.sync.downloadNow', '立即下载')}
            </Button>
          </div>
        </div>
        {showAutoError ? (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-xs text-destructive">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            <div>
              <p className="font-medium">{t('settings.sync.autoErrorTitle', '自动同步失败')}</p>
              <p className="mt-0.5">{config?.status?.lastError}</p>
            </div>
          </div>
        ) : null}
      </section>

      {/* 本地备份（DB 快照） */}
      <section className="rounded-xl border border-border/70 bg-card p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold">{t('settings.sync.localBackup', '本地备份')}</span>
            <span className="text-xs text-muted-foreground">
              {t('settings.sync.retainHintN', '保留最近 {{count}} 个快照', { count: backupConfig.retainCount })}
            </span>
          </div>
          <div className="flex gap-2.5">
            <Button size="sm" disabled={creatingBackup} onClick={handleCreateBackup}>
              {t('settings.sync.createBackup', '创建备份')}
            </Button>
            <Button size="sm" variant="outline" onClick={openBackupSettings}>
              {t('settings.sync.backupSettings', '备份设置')}
            </Button>
          </div>
        </div>

        <div className="mt-4">
          {visibleBackups.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t('settings.sync.noBackups', '暂无备份')}
            </p>
          ) : (
            <div className="space-y-1.5">
              {visibleBackups.map((b) => (
                <div
                  key={b.filename}
                  className="flex items-center justify-between gap-2 rounded-lg bg-muted/30 px-3 py-2 transition-colors hover:bg-muted/50"
                >
                  <div className="min-w-0 flex-1">
                    {editingFilename === b.filename ? (
                      <div className="flex items-center gap-1.5">
                        <Input
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleConfirmRename();
                            if (e.key === 'Escape') handleCancelRename();
                          }}
                          className="h-7 text-xs"
                          autoFocus
                          disabled={busyId === b.filename}
                        />
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={handleConfirmRename}
                          disabled={busyId === b.filename || !editValue.trim()}
                        >
                          <Check className="size-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon-sm" onClick={handleCancelRename}>
                          <X className="size-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <>
                        <p className="truncate font-mono text-sm">{getDisplayName(b.filename)}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(b.createdAt * 1000).toLocaleString()} · {formatBytes(b.sizeBytes)}
                        </p>
                      </>
                    )}
                  </div>
                  {editingFilename !== b.filename && (
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleStartRename(b.filename)}
                        disabled={!!busyId}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-destructive hover:text-destructive"
                        disabled={!!busyId}
                        onClick={() => handleDelete(b.filename)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        disabled={!!busyId}
                        onClick={() => handleRestore(b.filename)}
                      >
                        <RotateCcw className="size-3 mr-1" />
                        {t('settings.sync.restore', '恢复')}
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {backups.length > MAX_VISIBLE_BACKUPS ? (
            <button
              type="button"
              onClick={() => setBackupsExpanded((v) => !v)}
              className="mt-2 w-full border-t border-border/50 pt-3 text-center text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {backupsExpanded
                ? t('settings.sync.collapseBackups', '收起')
                : `${t('settings.sync.viewAllBackups', '查看全部备份')} ›`}
            </button>
          ) : null}
        </div>
      </section>

      {/* 恢复保护（保留现状） */}
      <section className="flex items-center justify-between rounded-xl border border-border/70 bg-card p-5">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <ShieldCheck className="size-5" />
          </span>
          <div>
            <p className="text-sm font-semibold">{t('settings.sync.restoreGuard', '恢复保护')}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('settings.sync.restoreGuardDesc', '还原前自动创建安全快照，防止误覆盖。')}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <span className="text-sm text-muted-foreground">
            {t('settings.sync.autoBackupBeforeRestore', '还原前自动备份')}
          </span>
          <Switch
            checked={restoreGuard}
            onCheckedChange={toggleGuard}
            aria-label={t('settings.sync.restoreGuard', '恢复保护')}
          />
        </div>
      </section>

      {/* 备份设置弹窗 */}
      <Dialog open={backupSettingsOpen} onOpenChange={setBackupSettingsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('settings.sync.backupSettingsTitle', '备份设置')}</DialogTitle>
            <DialogDescription>
              {t('settings.sync.backupSettingsDesc', '配置自动备份频率与本地保留的快照数量。')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                {t('settings.sync.backupIntervalLabel', '自动备份间隔')}
              </label>
              <Select
                value={String(backupConfig.intervalHours)}
                onValueChange={(v) => setBackupConfig((c) => ({ ...c, intervalHours: Number(v) }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BACKUP_INTERVAL_OPTIONS.map((h) => (
                    <SelectItem key={h} value={String(h)}>
                      {h === 0
                        ? t('settings.sync.backupIntervalDisabled', '禁用')
                        : t('settings.sync.backupIntervalHours', '每 {{count}} 小时', { count: h })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                {t('settings.sync.backupRetainLabel', '保留快照数量')}
              </label>
              <Input
                type="number"
                min={1}
                max={50}
                value={backupConfig.retainCount}
                onChange={(e) =>
                  setBackupConfig((c) => ({
                    ...c,
                    retainCount: Math.min(50, Math.max(1, Number(e.target.value) || 1)),
                  }))
                }
              />
              <p className="text-xs text-muted-foreground">
                {t('settings.sync.backupRetainHint', '范围 1–50，超出最旧的会被自动清理。')}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setBackupSettingsOpen(false)}>
              {t('common.cancel', '取消')}
            </Button>
            <Button disabled={savingBackupConfig} onClick={saveBackupConfig}>
              {t('common.save', '保存')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* WebDAV 配置弹窗：头部 + footer 固定，中间表单区滚动 */}
      <Dialog open={configOpen} onOpenChange={setConfigOpen}>
        <DialogContent className="grid max-h-[85vh] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 p-0 sm:max-w-lg">
          <DialogHeader className="border-b border-border/60 px-6 pb-4 pt-6">
            <DialogTitle>{t('settings.sync.webdav.sectionTitle', 'WebDAV 云同步')}</DialogTitle>
            <DialogDescription>
              {t('settings.sync.webdav.sectionDesc', '将全量配置端到端加密后同步到自建或第三方 WebDAV。')}
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="h-full min-h-0">
            <div className="space-y-4 px-6 py-5">
              {/* 启用开关 */}
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{t('settings.sync.webdav.enabled', '启用 WebDAV 同步')}</span>
                <Switch
                  checked={form.enabled}
                  onCheckedChange={(v) => patchForm({ enabled: v })}
                  aria-label={t('settings.sync.webdav.enabled', '启用 WebDAV 同步')}
                />
              </div>

              {/* 服务商预设 */}
              <Field label={t('settings.sync.webdav.provider', '服务商')}>
                <Select value={provider} onValueChange={applyProvider}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDER_PRESETS.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{t(p.labelKey, p.id)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              {/* Server URL */}
              <Field label={t('settings.sync.webdav.baseUrl', '服务器地址')}>
                <Input
                  value={form.baseUrl}
                  onChange={(e) => patchForm({ baseUrl: e.target.value })}
                  placeholder={t('settings.sync.webdav.baseUrlPlaceholder', 'https://dav.jianguoyun.com/dav/')}
                  autoComplete="off"
                  spellCheck={false}
                />
              </Field>

              {/* 用户名 */}
              <Field label={t('settings.sync.webdav.username', '用户名')}>
                <Input
                  value={form.username}
                  onChange={(e) => patchForm({ username: e.target.value })}
                  placeholder={t('settings.sync.webdav.usernamePlaceholder', 'your@email.com')}
                  autoComplete="off"
                  spellCheck={false}
                />
              </Field>

              {/* 密码 */}
              <Field label={t('settings.sync.webdav.password', '密码 / 应用密码')}>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setPasswordDirty(true);
                  }}
                  placeholder={
                    hasSavedPassword
                      ? t('settings.sync.webdav.passwordPlaceholderSet', '已保存（留空则不修改）')
                      : t('settings.sync.webdav.passwordPlaceholderEmpty', '请输入密码')
                  }
                  autoComplete="off"
                />
              </Field>

              {/* 同步密码 */}
              <Field
                label={t('settings.sync.webdav.syncPassword', '同步密码')}
                hint={t('settings.sync.webdav.syncPasswordHint', '用于加密凭据，换设备时需输入相同密码才能解密。')}
              >
                <Input
                  type="password"
                  value={syncPassword}
                  onChange={(e) => {
                    setSyncPassword(e.target.value);
                    setSyncPasswordDirty(true);
                  }}
                  placeholder={
                    hasSavedSyncPassword
                      ? t('settings.sync.webdav.syncPasswordPlaceholderSet', '已保存（留空则不修改）')
                      : t('settings.sync.webdav.syncPasswordPlaceholderEmpty', '请输入同步密码')
                  }
                  autoComplete="off"
                />
              </Field>

              {/* Remote Root + Profile */}
              <div className="grid grid-cols-2 gap-3">
                <Field label={t('settings.sync.webdav.remoteRoot', '远端根目录')}>
                  <Input
                    value={form.remoteRoot}
                    onChange={(e) => patchForm({ remoteRoot: e.target.value })}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </Field>
                <Field label={t('settings.sync.webdav.profile', '配置档')}>
                  <Input
                    value={form.profile}
                    onChange={(e) => patchForm({ profile: e.target.value })}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </Field>
              </div>

              {/* 路径预览 */}
              <p className="text-xs text-muted-foreground">
                {t('settings.sync.webdav.pathPreview', '远端路径')}：
                <code className="ml-1 rounded bg-muted px-1.5 py-0.5 font-mono">{remotePathPreview}</code>
              </p>

              {/* 自动上传开关 */}
              <div className="flex items-center justify-between border-t border-border/50 pt-4">
                <span className="text-sm">{t('settings.sync.webdav.autoSync', '配置变更后自动上传')}</span>
                <Switch
                  checked={form.autoSync}
                  onCheckedChange={handleAutoSyncToggle}
                  aria-label={t('settings.sync.webdav.autoSync', '配置变更后自动上传')}
                />
              </div>
            </div>
          </ScrollArea>

          <DialogFooter className="border-t border-border/60 px-6 py-4">
            <Button variant="outline" disabled={testing || saving} onClick={handleTest}>
              {testing
                ? t('settings.sync.webdav.testing', '测试中…')
                : t('settings.sync.webdav.testConnection', '测试连接')}
            </Button>
            <Button disabled={saving} onClick={handleSave}>
              {saving ? t('settings.sync.webdav.saving', '保存中…') : t('settings.sync.webdav.save', '保存')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 上传/下载二次确认 */}
      <AlertDialog open={confirmKind !== null} onOpenChange={(o) => !o && closeConfirm()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmKind === 'upload'
                ? t('settings.sync.confirmUploadTitle', '确认上传')
                : t('settings.sync.confirmDownloadTitle', '确认下载')}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                {confirmLoading ? (
                  <p className="text-sm text-muted-foreground">…</p>
                ) : remoteInfo?.empty ? (
                  <p className="text-sm">{t('settings.sync.remoteEmpty', '远端暂无数据，本次为首次上传。')}</p>
                ) : remoteInfo ? (
                  <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-xs">
                    <p className="font-medium text-foreground">{t('settings.sync.remoteSnapshot', '远端快照')}</p>
                    <p className="mt-1">
                      {t('settings.sync.remoteDevice', '设备')}：{remoteInfo.deviceName ?? '-'}
                    </p>
                    <p>
                      {t('settings.sync.remoteTime', '时间')}：
                      {remoteInfo.createdAt ? formatRelativeTime(remoteInfo.createdAt) : '-'}
                    </p>
                    <p>
                      {t('settings.sync.remoteVersion', '协议版本')}：{remoteInfo.version ?? '-'}
                    </p>
                  </div>
                ) : null}

                {confirmKind === 'upload' && remoteInfo && !remoteInfo.empty ? (
                  <p className="flex items-start gap-1.5 text-sm text-amber-600 dark:text-amber-500">
                    <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                    {t('settings.sync.uploadOverwriteWarning', '远端已有数据，本次上传将覆盖远端快照。')}
                  </p>
                ) : null}
                {confirmKind === 'download' ? (
                  remoteInfo?.empty ? (
                    <p className="text-sm text-destructive">
                      {t('settings.sync.downloadEmptyBlock', '远端没有可下载的数据。')}
                    </p>
                  ) : remoteInfo && !remoteInfo.compatible ? (
                    <p className="flex items-start gap-1.5 text-sm text-destructive">
                      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                      {t('settings.sync.incompatibleWarning', '远端数据的协议版本与当前应用不兼容，无法下载。')}
                    </p>
                  ) : (
                    <p className="flex items-start gap-1.5 text-sm text-amber-600 dark:text-amber-500">
                      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                      {t('settings.sync.downloadReplaceWarning', '下载将替换本地的账号、MCP、Skills 配置，本机专属数据保留。')}
                    </p>
                  )
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel', '取消')}</AlertDialogCancel>
            {confirmKind === 'upload' ? (
              <AlertDialogAction onClick={runUpload} disabled={confirmLoading}>
                {t('settings.sync.uploadNow', '立即上传')}
              </AlertDialogAction>
            ) : (
              <AlertDialogAction
                onClick={runDownload}
                disabled={confirmLoading || remoteInfo?.empty || (remoteInfo ? !remoteInfo.compatible : true)}
              >
                {t('settings.sync.downloadNow', '立即下载')}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 下载后重启提示 */}
      <AlertDialog open={showRestart} onOpenChange={setShowRestart}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settings.sync.restartTitle', '凭据已更新，请重启应用')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('settings.sync.restartDesc', '已从远端恢复加密密钥并写入本机。请重启应用后，账号凭据方可正常解密使用。')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setShowRestart(false)}>
              {t('settings.sync.restartAck', '知道了')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 自动上传首次开启确认 */}
      <AlertDialog open={showAutoSyncConfirm} onOpenChange={setShowAutoSyncConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settings.sync.webdav.autoSyncConfirmTitle', '开启自动上传？')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('settings.sync.webdav.autoSyncConfirmDesc', '开启后，账号、MCP、Skills 等配置变更将自动上传到 WebDAV。')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel', '取消')}</AlertDialogCancel>
            <AlertDialogAction
              className={cn(buttonVariants())}
              onClick={() => {
                patchForm({ autoSync: true });
                setShowAutoSyncConfirm(false);
              }}
            >
              {t('common.confirm', '确认')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsLayout>
  );
}

/** 配置弹窗内单字段：label + 可选 hint + 控件。 */
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">{label}</label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
