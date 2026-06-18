import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../../../stores';
import { SettingsLayout } from '../SettingsLayout';

export default function AdvancedSettings() {
  const { t } = useTranslation();
  const { terminalLaunchTemplate, setTerminalLaunchTemplate } = useSettingsStore();

  const presets: Array<{ label: string; tpl: string }> = [
    { label: 'macOS Terminal', tpl: 'osascript -e \'tell application "Terminal" to do script "cd {cwd} && {command}"\'' },
    { label: 'Windows Terminal', tpl: 'wt -d "{cwd}" cmd /k "{command}"' },
    { label: 'Linux gnome-terminal', tpl: 'gnome-terminal --working-directory="{cwd}" -- bash -c \'{command}; exec bash\'' },
  ];

  return (
    <SettingsLayout
      title={t('settings.advanced.title', '高级')}
      description={t('settings.advanced.desc', '开发者选项。')}
    >
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
