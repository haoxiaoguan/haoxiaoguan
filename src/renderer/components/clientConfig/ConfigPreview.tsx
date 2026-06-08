// 配置预览:用表单草稿值防抖调后端 dry-render,展示将写入客户端的真实配置。
// 提供 onApplyEdit 时单文件可 Monaco 编辑(JSON 走 json 语言、其它如 Codex TOML 走纯文本),
// 编辑后经 onApplyEdit 解析回写表单字段;焦点守卫:编辑期间不被 dry-render 覆盖(防光标跳)。
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { bridge } from '../../services/bridge';
import { JsonEditor } from '@/components/ui/json-editor';
import type { ClientConfigClientId, ClientConfigDiffFile } from '@shared/api-types';

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
  const focusedRef = useRef(false);
  const editTargetRef = useRef('');
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

  // 单文件且提供了回写函数 → 可编辑(JSON 与 TOML/纯文本均可)。
  const editable = onApplyEdit != null && files != null && files.length === 1;
  const editTarget = editable ? (files![0].after ?? '') : '';
  const editLang = isJson(editTarget) ? 'json' : 'plaintext';
  editTargetRef.current = editTarget;

  // dry-render 变化时同步到编辑器;但编辑器获得焦点(用户正在改)时不覆盖,避免光标跳动。
  useEffect(() => {
    if (!editable) return;
    if (focusedRef.current) return;
    setEditText(editTarget);
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
              language={editLang}
              onChange={(v) => {
                setEditText(v);
                onApplyEdit?.(v);
              }}
              onFocusChange={(f) => {
                focusedRef.current = f;
                // 失焦后回到 dry-render 规范化结果(反映已回填的表单)。
                if (!f) setEditText(editTargetRef.current);
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
