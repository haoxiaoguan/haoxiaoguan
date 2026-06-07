// 配置预览:用表单草稿值防抖调后端 dry-render,展示将写入客户端的真实配置(settings.json / config.toml 片段)。
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { bridge } from '../../services/bridge';
import type { ClientConfigClientId, ClientConfigDiffFile } from '@shared/api-types';

export function ConfigPreview({
  clientId,
  name,
  baseUrl,
  apiKey,
  model,
  settings,
  footNote,
}: {
  clientId: ClientConfigClientId;
  name: string;
  baseUrl: string;
  apiKey?: string;
  model?: string;
  settings?: Record<string, unknown>;
  /** 可选脚注(如:启用后地址将改写为经本机反代)。 */
  footNote?: string;
}) {
  const { t } = useTranslation('nav');
  const [files, setFiles] = useState<ClientConfigDiffFile[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const settingsKey = JSON.stringify(settings ?? {});

  useEffect(() => {
    if (baseUrl.trim().length === 0) {
      setFiles(null);
      setErr(null);
      return;
    }
    // preload 较旧(dev 改 preload 未重启)时 previewDraft 不存在:显示提示而非报错。
    if (typeof bridge().clientConfig.previewDraft !== 'function') {
      setFiles(null);
      setErr(null);
      return;
    }
    let alive = true;
    const handle = setTimeout(() => {
      void (async () => {
        try {
          const r = await bridge().clientConfig.previewDraft({
            clientId,
            name,
            baseUrl,
            ...(apiKey ? { apiKey } : {}),
            ...(model ? { model } : {}),
            ...(settings ? { settings } : {}),
          });
          if (alive) {
            setFiles(r);
            setErr(null);
          }
        } catch (e) {
          if (alive) {
            setErr(e instanceof Error ? e.message : String(e));
            setFiles(null);
          }
        }
      })();
    }, 300);
    return () => {
      alive = false;
      clearTimeout(handle);
    };
    // settingsKey 代表 settings 的内容变化;eslint 对对象依赖无法静态判断。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, name, baseUrl, apiKey, model, settingsKey]);

  return (
    <div>
      <div className="mb-1.5 text-[12px] font-medium text-muted-foreground">{t('clientConfigPage.form.previewTitle')}</div>
      {err ? (
        <div className="rounded-[8px] border border-destructive/40 bg-destructive/[0.05] p-2 font-mono text-[11px] text-destructive">{err}</div>
      ) : files && files.length > 0 ? (
        <div className="space-y-2">
          {files.map((f) => (
            <div key={f.file}>
              <div className="mb-0.5 font-mono text-[10px] text-muted-foreground/60">{f.file}</div>
              <pre className="max-h-44 overflow-auto rounded-[8px] border border-border/60 bg-muted/30 p-2 font-mono text-[11px] leading-relaxed">
                {f.after ?? t('clientConfigPage.diff.empty')}
              </pre>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-[8px] border border-dashed border-border/60 p-2 text-[11px] text-muted-foreground/60">
          {t('clientConfigPage.form.previewHint')}
        </div>
      )}
      {footNote && <p className="mt-1.5 text-[11px] text-muted-foreground/70">{footNote}</p>}
    </div>
  );
}
