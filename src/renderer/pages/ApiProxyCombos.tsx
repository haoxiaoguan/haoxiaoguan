import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Pencil, Trash2, ArrowUp, ArrowDown, X, Workflow, GitFork } from 'lucide-react';
import { toast } from 'sonner';
import { useApiProxyStore } from '../stores/apiProxyStore';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import type { ComboStepDto, RouteComboDto } from '@shared/api-types';

interface Draft {
  id?: string;
  name: string;
  description: string;
  steps: ComboStepDto[];
}

const blankDraft = (): Draft => ({ name: '', description: '', steps: [{ model: '', enabled: true }] });

function toDraft(c: RouteComboDto): Draft {
  return {
    id: c.id,
    name: c.name,
    description: c.description ?? '',
    steps: c.steps.length > 0 ? c.steps.map((s) => ({ ...s })) : [{ model: '', enabled: true }],
  };
}

export default function ApiProxyCombos() {
  const { t } = useTranslation('nav');
  const {
    error,
    combos,
    routableModels,
    fetchCombos,
    fetchRoutableModels,
    createCombo,
    updateCombo,
    deleteCombo,
  } = useApiProxyStore();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<RouteComboDto | null>(null);

  useEffect(() => {
    void fetchCombos();
    void fetchRoutableModels();
  }, [fetchCombos, fetchRoutableModels]);

  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

  // 步骤模型下拉项：可路由模型 ∪ 草稿里已填的模型（保留已删平台的旧值，编辑不丢）。
  const modelOptions = useMemo(() => {
    const set = new Set<string>(routableModels);
    draft?.steps.forEach((s) => s.model.trim() && set.add(s.model.trim()));
    return [...set];
  }, [routableModels, draft]);

  const patchStep = (i: number, patch: Partial<ComboStepDto>) =>
    setDraft((d) => (d ? { ...d, steps: d.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) } : d));
  const addStep = () => setDraft((d) => (d ? { ...d, steps: [...d.steps, { model: '', enabled: true }] } : d));
  const removeStep = (i: number) =>
    setDraft((d) => (d ? { ...d, steps: d.steps.filter((_, j) => j !== i) } : d));
  const moveStep = (i: number, dir: -1 | 1) =>
    setDraft((d) => {
      if (!d) return d;
      const j = i + dir;
      if (j < 0 || j >= d.steps.length) return d;
      const steps = [...d.steps];
      [steps[i], steps[j]] = [steps[j], steps[i]];
      return { ...d, steps };
    });

  const canSave = useMemo(() => {
    if (!draft) return false;
    if (draft.name.trim().length === 0) return false;
    return draft.steps.some((s) => s.model.trim().length > 0);
  }, [draft]);

  const save = async () => {
    if (!draft || !canSave) return;
    setSaving(true);
    const input = {
      name: draft.name.trim(),
      description: draft.description.trim() || undefined,
      steps: draft.steps
        .filter((s) => s.model.trim().length > 0)
        .map((s) => ({ model: s.model.trim(), enabled: s.enabled })),
    };
    const ok = draft.id ? await updateCombo(draft.id, input) : await createCombo(input);
    setSaving(false);
    if (ok) setDraft(null);
  };

  return (
    <div className="flex flex-col gap-5 px-6 py-5">
      {/* ── header ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-[9px] bg-primary/10">
          <Workflow className="size-4.5 text-primary" strokeWidth={1.85} aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold leading-5 text-foreground">
            {t('service.combos.title')}
          </div>
          <div className="mt-0.5 text-[12px] text-muted-foreground">{t('service.combos.desc')}</div>
        </div>
        <Button size="sm" className="h-8 gap-1.5" onClick={() => setDraft(blankDraft())}>
          <Plus className="size-3.5" strokeWidth={2.25} aria-hidden />
          {t('service.combos.new')}
        </Button>
      </div>

      {/* ── list / empty ────────────────────────────────────────────── */}
      {combos.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-[8px] border border-border bg-card py-14">
          <div className="flex size-10 items-center justify-center rounded-full bg-muted">
            <GitFork className="size-5 text-muted-foreground" strokeWidth={1.85} aria-hidden />
          </div>
          <p className="text-sm text-muted-foreground">{t('service.combos.empty')}</p>
          <Button size="sm" className="gap-1.5" onClick={() => setDraft(blankDraft())}>
            <Plus className="size-3.5" strokeWidth={2.25} aria-hidden />
            {t('service.combos.new')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {combos.map((c) => (
            <div
              key={c.id}
              className="flex items-center gap-3 rounded-[8px] border border-border/60 bg-card px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <code className="font-mono text-[13px] font-medium text-foreground">{c.name}</code>
                  {!c.enabled && (
                    <span className="rounded-[4px] bg-zinc-500/10 px-1.5 py-0.5 text-[10px] text-zinc-500">
                      {t('service.combos.disabled')}
                    </span>
                  )}
                </div>
                {c.description && (
                  <div className="mt-0.5 truncate text-[12px] text-muted-foreground">{c.description}</div>
                )}
                <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground/80">
                  {c.steps.map((s) => (s.enabled === false ? `(${s.model})` : s.model)).join('  →  ') || '—'}
                </div>
              </div>
              <Switch
                checked={c.enabled}
                onCheckedChange={(v) => void updateCombo(c.id, { enabled: v })}
                aria-label={c.name}
              />
              <Button variant="ghost" size="icon" className="size-7" onClick={() => setDraft(toDraft(c))} aria-label={t('service.combos.edit')}>
                <Pencil className="size-3.5" aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-destructive"
                onClick={() => setDeleteTarget(c)}
                aria-label={t('service.combos.delete')}
              >
                <Trash2 className="size-3.5" aria-hidden />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* ── create / edit dialog ────────────────────────────────────── */}
      <Dialog open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="flex max-h-[88vh] max-w-xl flex-col gap-4">
          <DialogHeader className="shrink-0">
            <DialogTitle>
              {draft?.id ? t('service.combos.editTitle') : t('service.combos.createTitle')}
            </DialogTitle>
            <DialogDescription>{t('service.combos.desc')}</DialogDescription>
          </DialogHeader>

          {draft !== null && (
            // px/py 给 focus ring（ring-2 + ring-offset-2≈4px）留出空间，避免被 overflow 滚动容器裁切；
            // 等量 -mx 抵消水平内边距，保持输入框与头/脚对齐。
            <div className="-mx-1.5 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-1.5 py-1.5">
              <Input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder={t('service.combos.namePlaceholder')}
                autoFocus
              />
              <Textarea
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder={t('service.combos.descPlaceholder')}
                rows={2}
              />

              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {t('service.combos.steps')}
              </div>
              <div className="flex flex-col gap-1.5">
                {draft.steps.map((s, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <span className="w-4 shrink-0 text-center text-[11px] tabular-nums text-muted-foreground">
                      {i + 1}
                    </span>
                    <Select value={s.model || undefined} onValueChange={(v) => patchStep(i, { model: v })}>
                      <SelectTrigger className="h-8 flex-1 font-mono text-[12px]">
                        <SelectValue placeholder={t('service.combos.stepPlaceholder')} />
                      </SelectTrigger>
                      <SelectContent>
                        {modelOptions.map((m) => (
                          <SelectItem key={m} value={m} className="font-mono text-[12px]">
                            {m}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <label className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                      <Checkbox
                        checked={s.enabled !== false}
                        onCheckedChange={(v) => patchStep(i, { enabled: v === true })}
                      />
                      {t('service.combos.stepEnabled')}
                    </label>
                    <Button variant="ghost" size="icon" className="size-7" onClick={() => moveStep(i, -1)} disabled={i === 0} aria-label="up">
                      <ArrowUp className="size-3.5" aria-hidden />
                    </Button>
                    <Button variant="ghost" size="icon" className="size-7" onClick={() => moveStep(i, 1)} disabled={i === draft.steps.length - 1} aria-label="down">
                      <ArrowDown className="size-3.5" aria-hidden />
                    </Button>
                    <Button variant="ghost" size="icon" className="size-7 text-muted-foreground hover:text-destructive" onClick={() => removeStep(i)} disabled={draft.steps.length === 1} aria-label="remove">
                      <X className="size-3.5" aria-hidden />
                    </Button>
                  </div>
                ))}
              </div>
              <Button variant="outline" size="sm" className="h-7 w-fit gap-1.5 text-[12px]" onClick={addStep}>
                <Plus className="size-3.5" aria-hidden />
                {t('service.combos.addStep')}
              </Button>
            </div>
          )}

          <DialogFooter className="shrink-0">
            <DialogClose asChild>
              <Button variant="outline" size="sm">
                {t('service.combos.cancel')}
              </Button>
            </DialogClose>
            <Button size="sm" disabled={!canSave || saving} onClick={() => void save()}>
              {t('service.combos.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── delete confirm ──────────────────────────────────────────── */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('service.combos.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('service.combos.deleteDesc', { name: deleteTarget?.name ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('service.combos.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteTarget) void deleteCombo(deleteTarget.id);
                setDeleteTarget(null);
              }}
            >
              {t('service.combos.confirmDelete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
