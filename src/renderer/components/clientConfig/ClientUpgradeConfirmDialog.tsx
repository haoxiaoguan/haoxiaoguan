import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { ClientLogo } from '@/components/clientConfig/ClientLogo';
import type { ClientConfigClientId, ClientConfigUpgradePlan } from '@shared/api-types';

/**
 * 升级前的「多处安装确认」（对称移植 cc-switch ToolUpgradeConfirmDialog）。仅当某客户端检测到
 * ≥2 处安装时弹出：展示命令行实际命中哪处（标「默认」=升级目标）、各处版本，以及锚定后将执行的
 * 命令，让用户在「升级只动其中一处、其余不动」这件事上知情后再确认。单处安装不会走到这里。
 */
export function ClientUpgradeConfirmDialog({
  open,
  plans,
  displayName,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  plans: ClientConfigUpgradePlan[];
  displayName: (clientId: ClientConfigClientId) => string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation('nav');

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[15px]">
            <AlertTriangle className="size-[18px] text-amber-500" aria-hidden />
            {t('clientManage.upgradeConfirmTitle')}
          </DialogTitle>
          <DialogDescription className="text-[12.5px] leading-relaxed">
            {t('clientManage.upgradeConfirmHint')}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[50vh] space-y-3 overflow-y-auto">
          {plans.map((plan) => (
            <div
              key={plan.clientId}
              className="space-y-2 rounded-[10px] border border-amber-500/25 bg-amber-500/5 p-3"
            >
              <div className="flex items-center gap-2">
                <ClientLogo clientId={plan.clientId} />
                <span className="text-[12.5px] font-medium text-foreground">{displayName(plan.clientId)}</span>
              </div>
              {!plan.anchored && (
                <div className="text-[11px] leading-snug text-amber-600 dark:text-amber-400">
                  {t('clientManage.upgradeUnanchoredHint')}
                </div>
              )}
              <ul className="flex flex-col gap-1">
                {plan.installs.map((inst) => (
                  <li key={inst.path} className="flex items-center gap-2 text-[11px]">
                    {inst.isPathDefault && (
                      <span className="shrink-0 rounded-[5px] bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                        {t('clientManage.pathDefault')}
                      </span>
                    )}
                    <span className="shrink-0 rounded-[5px] bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {inst.source}
                    </span>
                    <span className="shrink-0 tabular-nums text-foreground">
                      {inst.version !== undefined ? `v${inst.version}` : t('clientManage.notRunnable')}
                    </span>
                    <span className="truncate font-mono text-[10.5px] text-muted-foreground" title={inst.path}>
                      {inst.path}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="space-y-1">
                <div className="text-[10.5px] text-muted-foreground">{t('clientManage.upgradeWillRun')}</div>
                <code
                  className="block truncate rounded-[6px] bg-background/80 px-2 py-1 font-mono text-[10.5px] text-foreground"
                  title={plan.command}
                >
                  {plan.command}
                </code>
              </div>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" className="h-8 text-[12px]" onClick={onCancel}>
            {t('clientManage.cancel')}
          </Button>
          <Button size="sm" className="h-8 text-[12px]" onClick={onConfirm}>
            {t('clientManage.upgradeConfirmBtn')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
