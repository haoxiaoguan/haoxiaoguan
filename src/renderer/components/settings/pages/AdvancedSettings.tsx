import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../../../stores';
import { wsService } from '../../../services/tauri';
import { SettingsLayout } from '../SettingsLayout';
import type { WsStatus } from '../../../types';

export default function AdvancedSettings() {
  const { t } = useTranslation();
  const { wsPort, setWsPort, allowStaleKiroImport, setAllowStaleKiroImport, terminalLaunchTemplate, setTerminalLaunchTemplate } = useSettingsStore();
  const [wsStatus, setWsStatus] = useState<WsStatus | null>(null);
  const [toggling, setToggling] = useState(false);

  const presets: Array<{ label: string; tpl: string }> = [
    { label: 'macOS Terminal', tpl: 'osascript -e \'tell application "Terminal" to do script "cd {cwd} && {command}"\'' },
    { label: 'Windows Terminal', tpl: 'wt -d "{cwd}" cmd /k "{command}"' },
    { label: 'Linux gnome-terminal', tpl: 'gnome-terminal --working-directory="{cwd}" -- bash -c \'{command}; exec bash\'' },
  ];

  const fetchStatus = async () => {
    try { setWsStatus(await wsService.getWsStatus()); } catch { /* noop */ }
  };

  useEffect(() => { fetchStatus(); }, []);

  const handleToggle = async () => {
    if (!wsStatus) return;
    setToggling(true);
    try { await wsService.toggleWs(!wsStatus.running); await fetchStatus(); }
    finally { setToggling(false); }
  };

  return (
    <SettingsLayout
      title={t('settings.advanced.title', '高级')}
      description={t('settings.advanced.desc', 'WebSocket 服务与开发者选项。')}
    >
      <section className="rounded-xl border border-border/70 bg-card p-5 space-y-3">
        <h3 className="text-sm font-semibold">{t('settings.websocket')}</h3>
        <div className="flex items-center gap-4">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox" className="toggle toggle-primary"
              checked={wsStatus?.running ?? false}
              onChange={handleToggle} disabled={toggling}
            />
            <span className="text-sm">
              {wsStatus?.running ? t('settings.wsEnabled') : t('settings.wsDisabled')}
            </span>
          </label>
          <div className="flex items-center gap-2">
            <span className="text-sm">{t('settings.wsPort')}:</span>
            <input
              type="number" min={1024} max={65535} value={wsPort}
              className="input input-bordered input-sm w-24"
              aria-label={t('settings.wsPort')}
              onChange={(e) => {
                const p = Number(e.target.value);
                if (p >= 1024 && p <= 65535) setWsPort(p);
              }}
            />
          </div>
        </div>
        {wsStatus?.running && (
          <p className="text-xs text-muted-foreground">
            Port: {wsStatus.port} | Connections: {wsStatus.connectionCount}
          </p>
        )}
      </section>

      <section className="rounded-xl border border-border/70 bg-card p-5 space-y-3">
        <h3 className="text-sm font-semibold">
          {t('settings.advanced.kiroImport.title', 'Kiro 账号导入')}
        </h3>
        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="checkbox" className="toggle toggle-primary mt-0.5"
            checked={allowStaleKiroImport}
            onChange={(e) => void setAllowStaleKiroImport(e.target.checked)}
          />
          <span className="text-sm">
            {t('settings.advanced.kiroImport.allowStale', '允许在无法联网确认身份时导入')}
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {t(
                'settings.advanced.kiroImport.allowStaleDesc',
                '默认关闭：导入 Kiro 账号时必须联网确认真实身份，否则阻止导入以免使用本地残留的旧账号信息。开启后将以占位身份导入，可稍后在账号详情刷新。',
              )}
            </span>
          </span>
        </label>
      </section>

      <section className="rounded-xl border border-border/70 bg-card p-5 space-y-3">
        <h3 className="text-sm font-semibold">
          {t('settings.advanced.terminalLaunch.title', '终端启动配置')}
        </h3>
        <p className="text-xs text-muted-foreground">
          {t('settings.advanced.terminalLaunch.desc', '用于「会话历史」中一键恢复 AI 对话。占位符 {cwd} 为项目目录，{command} 为恢复命令。留空时点「恢复」将降级为复制命令。')}
        </p>
        <input
          className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
          value={terminalLaunchTemplate}
          placeholder="终端启动模板，占位符 {cwd}/{command}"
          onChange={(e) => void setTerminalLaunchTemplate(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          {presets.map((p) => (
            <button
              key={p.label}
              className="rounded border px-2 py-1 text-xs"
              onClick={() => void setTerminalLaunchTemplate(p.tpl)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </section>
    </SettingsLayout>
  );
}
