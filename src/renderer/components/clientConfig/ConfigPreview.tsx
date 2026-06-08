// 配置预览:用表单草稿值防抖调后端 dry-render,展示将写入客户端的真实配置。
// JSON 文件(如 Claude settings.json)用 Monaco 可编辑,编辑后经 onApplyEdit 解析回写表单字段;
// 非 JSON(TOML/YAML)保持只读展示。
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { bridge } from '../../services/bridge';
import { JsonEditor } from '@/components/ui/json-editor';
import type { ClientConfigClientId, ClientConfigDiffFile } from '@shared/api-types';

/** 语义相等(忽略空白/格式差异);任一非法 JSON → 视为不等。 */
function jsonEqual(a: string, b: string): boolean {
  try {
    return JSON.stringify(JSON.parse(a)) === JSON.stringify(JSON.parse(b));
  } catch {
    return false;
  }
}
function isJson(s: string | null | undefined): boolean {
  if (s == null) return false;
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
}

export function ConfigPreview({
  clientId,
  name,
  baseUrl,
  apiKey,
  model,
  settings,
  footNote,
  onApplyEdit,
}: {
  clientId: ClientConfigClientId;
  name: string;
  baseUrl: string;
  apiKey?: string;
  model?: string;
  settings?: Record<string, unknown>;
  /** 可选脚注(如:启用后地址将改写为经本机反代)。 */
  footNote?: string;
  /** 直接编辑配置源码后回写表单;返回 true 表示已应用。提供时 JSON 文件可编辑。 */
  onApplyEdit?: (text: string) => boolean;
}) {
  const { t } = useTranslation('nav');
  const [files, setFiles] = useState<ClientConfigDiffFile[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
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
    // settingsKey 代表 settings 内容;eslint 无法静态判断对象依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, name, baseUrl, apiKey, model, settingsKey]);

  // 单文件且为 JSON 且提供了回写函数 → 可编辑。
  const editable = onApplyEdit != null && files != null && files.length === 1 && isJson(files[0].after);
  const editTarget = editable ? (files![0].after ?? '') : '';

  // dry-render 变化时同步到编辑器;但与当前编辑文本"语义相等"则保持不变(避免打字时光标跳动)。
  useEffect(() => {
    if (!editable) return;
    setEditText((cur) => (jsonEqual(cur, editTarget) ? cur : editTarget));
  }, [editable, editTarget]);

  return (
    <div>
      <div className="mb-1.5 text-[12px] font-medium text-muted-foreground">{t('clientConfigPage.form.previewTitle')}</div>
      {err ? (
        <div className="rounded-[8px] border border-destructive/40 bg-destructive/[0.05] p-2 font-mono text-[11px] text-destructive">{err}</div>
      ) : files && files.length > 0 ? (
        editable ? (
          <div>
            <div className="mb-0.5 font-mono text-[10px] text-muted-foreground/60">{files[0].file}</div>
            <JsonEditor
              value={editText}
              onChange={(v) => {
                setEditText(v);
                onApplyEdit?.(v);
              }}
              height={200}
              ariaLabel={t('clientConfigPage.form.previewTitle')}
            />
          </div>
        ) : (
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
        )
      ) : (
        <div className="rounded-[8px] border border-dashed border-border/60 p-2 text-[11px] text-muted-foreground/60">
          {t('clientConfigPage.form.previewHint')}
        </div>
      )}
      {footNote && <p className="mt-1.5 text-[11px] text-muted-foreground/70">{footNote}</p>}
    </div>
  );
}
