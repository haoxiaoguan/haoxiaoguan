import { Gauge, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * Sidebar user card — login-ready compact avatar block.
 *
 * Visual reference: AiMaMi user info chip (screenshot 1).
 *
 * Expanded layout: [avatar] [name / Pro subtitle] [gauge] [settings]
 * Collapsed layout: avatar on top, settings shortcut at the bottom
 *   (gauge action drops away when there is no horizontal room).
 *
 * The user data is hard-coded for now and will be sourced from the auth
 * session once login lands. The two right-hand icons are placeholders for
 * a quick-stats popover and a settings shortcut respectively.
 */
export function SidebarUserCard() {
  const { t } = useTranslation();
  const settingsLabel = t('common:user.menu.preferences');
  const statsLabel = t('common:user.menu.stats');

  const location = useLocation();
  const navigate = useNavigate();
  const isSettingsActive = location.pathname.startsWith('/settings');

  const goSettings = () => {
    if (isSettingsActive) {
      const last = sessionStorage.getItem('haoxiaoguan:last-main-route') || '/';
      navigate(last);
    } else {
      navigate('/settings/general');
    }
  };

  return (
    <>
      {/* Expanded: horizontal */}
      <div
        data-testid="app-shell-user-card"
        className="flex items-center gap-2 rounded-[10px] px-1 py-1.5 group-data-[collapsible=icon]/sidebar:hidden"
      >
        <UserAvatar />

        <div className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-[13px] font-semibold text-sidebar-foreground">
            RuffianLiu
          </span>
          <span className="truncate text-[11px] text-sidebar-foreground/60">Pro</span>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <GhostIcon icon={Gauge} aria-label={statsLabel} title={statsLabel} compact />
          <GhostIcon icon={Settings} aria-label={settingsLabel} title={settingsLabel} compact active={isSettingsActive} onClick={goSettings} />
        </div>
      </div>

      {/* Collapsed: vertical (avatar top, settings bottom) */}
      <div
        data-testid="app-shell-user-card-collapsed"
        className="hidden flex-col items-center gap-2 group-data-[collapsible=icon]/sidebar:flex"
      >
        <UserAvatar />
        <GhostIcon icon={Settings} aria-label={settingsLabel} title={settingsLabel} active={isSettingsActive} onClick={goSettings} />
      </div>
    </>
  );
}

function UserAvatar() {
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-[15px] font-semibold text-foreground/80">
      R
    </div>
  );
}

interface GhostIconProps {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  'aria-label': string;
  title: string;
  /** Compact mode is used inside the expanded user-card row (28x28). */
  compact?: boolean;
  active?: boolean;
  onClick?: () => void;
}

function GhostIcon({ icon: Icon, 'aria-label': ariaLabel, title, compact, active, onClick }: GhostIconProps) {
  const button = (
    <Button
      variant="ghost"
      size="icon"
      onClick={onClick}
      className={cn(
        'shrink-0',
        active
          ? 'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary dark:bg-primary/20'
          : 'text-sidebar-foreground/80 hover:text-sidebar-foreground',
        compact ? 'h-7 w-7' : 'h-9 w-9',
      )}
      aria-label={ariaLabel}
      data-active={active ? 'true' : undefined}
    >
      <Icon className={compact ? 'size-3.5' : 'size-4'} strokeWidth={1.85} />
    </Button>
  );

  // Compact buttons live inline next to a label — no tooltip.
  // The collapsed (icon-only) variant uses the AiMaMi-style right-side tooltip.
  if (compact) {
    return button;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right" align="center" variant="translucent" sideOffset={10}>
        {title}
      </TooltipContent>
    </Tooltip>
  );
}
