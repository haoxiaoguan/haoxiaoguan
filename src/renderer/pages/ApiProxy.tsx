import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Plug, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { useApiProxyStore } from '../stores/apiProxyStore';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export default function ApiProxy() {
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

  const copyBaseUrl = async () => {
    if (!baseUrl) return;
    try {
      await navigator.clipboard.writeText(baseUrl);
      toast.success(baseUrl);
    } catch {
      toast.error(baseUrl);
    }
  };

  return (
    <div className="flex flex-col gap-4 px-6 py-5" data-testid="api-proxy-page">
      <div className="rounded-[10px] border border-border/80 bg-card p-5">
        <div className="flex items-center gap-3">
          <Plug className="size-5 text-primary" strokeWidth={1.85} aria-hidden />
          <div className="flex-1">
            <div className="text-[15px] font-semibold text-foreground">{t('apiService')}</div>
            <div className="text-[12px] text-muted-foreground">127.0.0.1</div>
          </div>
          <StatusBadge running={running} />
          <Switch
            checked={running}
            disabled={loading}
            onCheckedChange={onToggle}
            aria-label={t('apiService')}
          />
        </div>

        {running && baseUrl ? (
          <div className="mt-4 flex items-center gap-2">
            <span className="text-[12px] text-muted-foreground">Base URL</span>
            <code className="rounded bg-muted px-2 py-1 font-mono text-[12px]">{baseUrl}</code>
            <Button variant="outline" size="sm" onClick={() => void copyBaseUrl()}>
              <Copy className="mr-1 size-3.5" aria-hidden />
              {t('apiService')}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function StatusBadge({ running }: { running: boolean }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'rounded-[6px] text-[11px]',
        running
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600'
          : 'border-slate-400/30 bg-slate-400/10 text-slate-500',
      )}
    >
      {running ? 'running' : 'stopped'}
    </Badge>
  );
}
