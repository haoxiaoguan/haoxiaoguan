import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Key, KeyRound, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useApiProxyStore } from '../stores/apiProxyStore';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';

export default function ApiProxyKeys() {
  const { t } = useTranslation('nav');
  const {
    error,
    keys,
    newPlaintext,
    fetchKeys,
    createKey,
    setKeyActive,
    deleteKey,
    clearNewPlaintext,
  } = useApiProxyStore();

  const [createOpen, setCreateOpen] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    void fetchKeys();
  }, [fetchKeys]);

  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

  const handleCreateKey = async () => {
    const name = keyName.trim();
    if (!name) return;
    setCreating(true);
    try {
      await createKey(name);
      setCreateOpen(false);
      setKeyName('');
    } finally {
      setCreating(false);
    }
  };

  const handleCopyPlaintext = async () => {
    if (!newPlaintext) return;
    try {
      await navigator.clipboard.writeText(newPlaintext);
      toast.success(t('clientKeys.copyKey'));
    } catch {
      toast.error(newPlaintext);
    }
  };

  return (
    <div className="flex flex-col gap-5 px-6 py-5">
      {/* ── header row ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-[9px] bg-primary/10">
          <Key className="size-4.5 text-primary" strokeWidth={1.85} aria-hidden />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-semibold text-foreground leading-5">
            {t('clientKeys.title')}
          </div>
          {keys.length > 0 && (
            <div className="mt-0.5 text-[12px] text-muted-foreground">
              {t('clientKeys.count', { count: keys.length })}
            </div>
          )}
        </div>
        <Button
          size="sm"
          className="h-8 gap-1.5"
          onClick={() => {
            setKeyName('');
            setCreateOpen(true);
          }}
        >
          <Plus className="size-3.5" strokeWidth={2.25} aria-hidden />
          {t('clientKeys.create')}
        </Button>
      </div>

      {/* ── key list or empty state ──────────────────────────────────── */}
      {keys.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-[8px] border border-border bg-card py-14">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted">
            <KeyRound className="size-5 text-muted-foreground" strokeWidth={1.85} />
          </div>
          <div className="space-y-1 text-center">
            <p className="text-sm font-medium text-foreground">{t('clientKeys.empty')}</p>
            <p className="text-xs text-muted-foreground">{t('clientKeys.emptyHint')}</p>
          </div>
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => {
              setKeyName('');
              setCreateOpen(true);
            }}
          >
            <Plus className="size-3.5" strokeWidth={2.25} aria-hidden />
            {t('clientKeys.create')}
          </Button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[8px] border border-border/60">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="px-3 py-2 text-[11.5px] font-medium text-muted-foreground">
                  {t('clientKeys.colName')}
                </TableHead>
                <TableHead className="px-3 py-2 text-[11.5px] font-medium text-muted-foreground">
                  {t('clientKeys.colPrefix')}
                </TableHead>
                <TableHead className="px-3 py-2 text-[11.5px] font-medium text-muted-foreground">
                  {t('clientKeys.colStatus')}
                </TableHead>
                <TableHead className="px-3 py-2 text-right text-[11.5px] font-medium text-muted-foreground">
                  {t('clientKeys.colActions')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((k) => (
                <TableRow
                  key={k.id}
                  className="border-b border-border/60 hover:bg-muted/30"
                >
                  <TableCell className="px-3 py-2 text-[13px] font-medium text-foreground">
                    {k.name}
                  </TableCell>
                  <TableCell className="px-3 py-2 font-mono text-[12px] text-muted-foreground">
                    {k.keyPrefix}…
                  </TableCell>
                  <TableCell className="px-3 py-2">
                    <Switch
                      checked={k.isActive}
                      onCheckedChange={(v) => void setKeyActive(k.id, v)}
                      aria-label={k.name}
                    />
                  </TableCell>
                  <TableCell className="px-3 py-2 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => void deleteKey(k.id)}
                      aria-label={t('clientKeys.delete')}
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* ── Create Key dialog ─────────────────────────────────────────── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('clientKeys.createTitle')}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2 py-2">
            <label className="text-[13px] text-muted-foreground">{t('clientKeys.nameLabel')}</label>
            <Input
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
              placeholder={t('clientKeys.namePlaceholder')}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleCreateKey();
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" size="sm">
                {t('clientKeys.cancel')}
              </Button>
            </DialogClose>
            <Button
              size="sm"
              disabled={!keyName.trim() || creating}
              onClick={() => void handleCreateKey()}
            >
              {t('clientKeys.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── One-time plaintext reveal dialog ─────────────────────────── */}
      <Dialog
        open={newPlaintext !== null}
        onOpenChange={(open) => {
          if (!open) clearNewPlaintext();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('clientKeys.plaintextTitle')}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <p className="text-[13px] text-amber-600 dark:text-amber-400">
              {t('clientKeys.plaintextWarning')}
            </p>
            <code className="break-all rounded bg-muted px-3 py-2 font-mono text-[12px] text-foreground select-all">
              {newPlaintext}
            </code>
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => void handleCopyPlaintext()}
            >
              <Copy className="mr-1 size-3.5" aria-hidden />
              {t('clientKeys.copyKey')}
            </Button>
          </div>
          <DialogFooter>
            <Button size="sm" onClick={clearNewPlaintext}>
              {t('clientKeys.close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
