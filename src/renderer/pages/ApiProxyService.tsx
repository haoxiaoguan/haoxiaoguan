import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Plug, Terminal } from 'lucide-react';
import { toast } from 'sonner';
import { useApiProxyStore } from '../stores/apiProxyStore';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';

// ─── status badge ────────────────────────────────────────────────────────────

function StatusBadge({ running }: { running: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1 rounded-[6px] px-1.5 text-[11px] font-medium',
        running
          ? 'bg-emerald-500/10 text-emerald-600'
          : 'bg-zinc-500/10 text-zinc-500',
      )}
    >
      <span
        className={cn(
          'size-1.5 rounded-full',
          running ? 'bg-emerald-500' : 'bg-zinc-400',
        )}
        aria-hidden
      />
      {running ? 'running' : 'stopped'}
    </span>
  );
}

// ─── endpoint rows ────────────────────────────────────────────────────────────

interface EndpointRow {
  path: string;
  descKey: string;
}

const ENDPOINTS: EndpointRow[] = [
  { path: '/v1/chat/completions', descKey: 'chatCompletions' },
  { path: '/v1/messages', descKey: 'messages' },
  { path: '/v1/responses', descKey: 'responses' },
  { path: '/v1/models', descKey: 'models' },
  { path: '/{platform}/v1/chat/completions', descKey: 'platformChat' },
  { path: '/{platform}/v1/messages', descKey: 'platformMessages' },
];

// ─── main page ────────────────────────────────────────────────────────────────

export default function ApiProxyService() {
  const { t } = useTranslation('nav');
  const { status, loading, error, fetchStatus, start, stop } = useApiProxyStore();

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

  const running = status.state === 'running';
  const baseUrl = useMemo(
    () => (status.port ? `http://127.0.0.1:${status.port}` : ''),
    [status.port],
  );

  const onToggle = (next: boolean) => {
    if (loading) return;
    if (next) void start();
    else void stop();
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(text);
    } catch {
      toast.error(text);
    }
  };

  const curlExample = useMemo(
    () =>
      baseUrl
        ? `curl ${baseUrl}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer <你的Key>" \\
  -d '{
    "model": "kiro",
    "messages": [{"role": "user", "content": "Hello"}]
  }'`
        : '',
    [baseUrl],
  );

  return (
    <div className="flex flex-col gap-6 px-6 py-5">
      {/* ── service control row ─────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-[9px] bg-primary/10">
          <Plug className="size-4.5 text-primary" strokeWidth={1.85} aria-hidden />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-semibold text-foreground leading-5">
            {t('apiService')}
          </div>
          <div className="mt-0.5 text-[12px] text-muted-foreground">
            127.0.0.1{status.port ? `:${status.port}` : ''}
          </div>
        </div>
        <StatusBadge running={running} />
        <Switch
          checked={running}
          disabled={loading}
          onCheckedChange={onToggle}
          aria-label={t('apiService')}
        />
      </div>

      {/* ── base url ────────────────────────────────────────────────── */}
      <div>
        <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {t('service.baseUrlLabel')}
        </div>
        {running && baseUrl ? (
          <div className="flex items-center gap-2 rounded-[8px] border border-border/60 bg-muted/40 px-3 py-2">
            <code className="flex-1 min-w-0 truncate font-mono text-[13px] font-medium text-foreground">
              {baseUrl}
            </code>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 gap-1.5 text-[12px] text-muted-foreground hover:text-foreground"
              onClick={() => void copyText(baseUrl)}
            >
              <Copy className="size-3.5" aria-hidden />
              {t('copy')}
            </Button>
          </div>
        ) : (
          <div className="flex h-10 items-center rounded-[8px] border border-border/40 bg-muted/20 px-3">
            <span className="text-[12px] text-muted-foreground/60">
              {t('service.disabledHint')}
            </span>
          </div>
        )}
      </div>

      {/* ── endpoints ───────────────────────────────────────────────── */}
      <div>
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {t('service.endpointsTitle')}
        </div>
        <div
          className={cn(
            'overflow-hidden rounded-[8px] border border-border/60',
            !running && 'opacity-50',
          )}
        >
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="px-3 py-2 text-[11.5px] font-medium text-muted-foreground w-[320px]">
                  {t('service.colPath')}
                </TableHead>
                <TableHead className="px-3 py-2 text-[11.5px] font-medium text-muted-foreground">
                  {t('service.colDesc')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ENDPOINTS.map((row) => (
                <TableRow
                  key={row.path}
                  className="border-b border-border/60 hover:bg-muted/30"
                >
                  <TableCell className="px-3 py-2 w-[320px]">
                    <code className="font-mono text-[12px] text-foreground truncate block">
                      {row.path}
                    </code>
                  </TableCell>
                  <TableCell className="px-3 py-2 text-[12px] text-muted-foreground">
                    {t(`service.endpoints.${row.descKey}`)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* ── curl example ────────────────────────────────────────────── */}
      <div>
        <div className="mb-2 flex items-center gap-2">
          <Terminal className="size-3.5 text-muted-foreground" strokeWidth={1.85} aria-hidden />
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t('service.curlTitle')}
          </span>
        </div>
        {running && curlExample ? (
          <div className="relative rounded-[8px] border border-border/60 bg-muted/40">
            <pre className="overflow-x-auto px-4 py-3 font-mono text-[12px] leading-relaxed text-foreground">
              {curlExample}
            </pre>
            <Button
              variant="ghost"
              size="sm"
              className="absolute right-2 top-2 h-7 gap-1.5 text-[12px] text-muted-foreground hover:text-foreground"
              onClick={() => void copyText(curlExample)}
            >
              <Copy className="size-3.5" aria-hidden />
              {t('service.curlCopy')}
            </Button>
          </div>
        ) : (
          <div className="flex h-10 items-center rounded-[8px] border border-border/40 bg-muted/20 px-3">
            <span className="text-[12px] text-muted-foreground/60">
              {t('service.disabledHint')}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
