// Codex 模型列表：菜单显示名 / 实际请求模型 / 上下文窗口 / 删除。
// 生成 model_catalog_json 供 Codex /model 菜单显示；修改后需重启 Codex 生效。
// 风格对齐 ClaudeModelMapFields.tsx（受控、inline grid）。
import { useTranslation } from 'react-i18next';
import { Trash2, Plus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ModelCombobox } from './ModelCombobox';

export interface CodexModelItem {
  id: string;
  name?: string;
  contextWindow?: number;
}

export const EMPTY_CODEX_MODEL_ITEM: CodexModelItem = { id: '', name: undefined, contextWindow: undefined };

export function CodexModelListFields({
  value,
  options,
  onChange,
}: {
  value: CodexModelItem[];
  /** 「获取模型列表」拉到的可选模型，供下拉。 */
  options: string[];
  onChange: (items: CodexModelItem[]) => void;
}) {
  const { t } = useTranslation('nav');

  const addRow = () => {
    onChange([...value, { ...EMPTY_CODEX_MODEL_ITEM }]);
  };

  const removeRow = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  const updateRow = (index: number, patch: Partial<CodexModelItem>) => {
    onChange(value.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  return (
    <div className="rounded-[8px] border border-border/60 px-3 py-3">
      <div className="flex items-center justify-between">
        <div className="text-[12px] font-medium text-foreground">{t('clientConfigPage.form.codexModelListTitle')}</div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 gap-1 text-[11px]"
          onClick={addRow}
        >
          <Plus className="size-3" aria-hidden />
          {t('clientConfigPage.form.codexModelListAdd')}
        </Button>
      </div>
      <p className="mb-2.5 mt-0.5 text-[11px] text-muted-foreground/70">{t('clientConfigPage.form.codexModelListHint')}</p>
      {value.length > 0 && (
        <div className="grid grid-cols-[1.1fr_1.3fr_90px_auto] items-center gap-x-2.5 gap-y-2">
          {/* 表头 */}
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground/60">{t('clientConfigPage.form.codexModelListName')}</span>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground/60">{t('clientConfigPage.form.codexModelListId')}</span>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground/60">{t('clientConfigPage.form.codexModelListCtx')}</span>
          <span />
          {value.map((item, i) => (
            <div key={i} className="contents">
              <Input
                className="text-[12px]"
                value={item.name ?? ''}
                onChange={(e) => updateRow(i, { name: e.target.value || undefined })}
                placeholder={t('clientConfigPage.form.codexModelListNamePlaceholder')}
              />
              <ModelCombobox
                value={item.id}
                options={options}
                placeholder="deepseek-chat"
                onChange={(v) => updateRow(i, { id: v })}
              />
              <Input
                className="text-[12px]"
                type="number"
                min={1}
                step={1}
                value={item.contextWindow ?? ''}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  updateRow(i, { contextWindow: Number.isFinite(n) && n > 0 ? n : undefined });
                }}
                placeholder="200000"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-destructive"
                onClick={() => removeRow(i)}
                aria-label={t('clientConfigPage.form.codexModelListRemove')}
              >
                <Trash2 className="size-3.5" aria-hidden />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
