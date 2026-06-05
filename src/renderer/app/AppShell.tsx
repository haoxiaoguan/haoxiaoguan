import {
  ArrowLeft,
  Bell,
  BookOpen,
  Headphones,
  History,
  Info,
  LayoutGrid,
  Plug,
  Puzzle,
  RefreshCw,
  Server,
  SlidersHorizontal,
  type LucideIcon,
  Users,
  Wrench,
} from 'lucide-react';
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
} from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useLocation, useMatch, useNavigate } from 'react-router-dom';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { ManagementHeaderTabs } from '@/components/management/ManagementControls';
import { cn } from '@/lib/utils';
import { SidebarBrand } from './SidebarBrand';
import { SidebarUserCard } from './SidebarUserCard';
import { detectPlatformShell, type PlatformShell } from './platform-shell';
import { SupportPopover } from './shell-utility/SupportPopover';
import { FaqPopover } from './shell-utility/FaqPopover';
import { NotificationPopover } from './shell-utility/NotificationPopover';
import { UpdaterIndicator } from './shell-utility/UpdaterIndicator';

interface AppShellProps {
  shell?: PlatformShell;
}

interface NavItem {
  to: string;
  labelKey: string;
  icon: LucideIcon;
  end?: boolean;
}

const MAIN_NAV_ITEMS: NavItem[] = [
  { to: '/', labelKey: 'nav:dashboard', icon: LayoutGrid, end: true },
  { to: '/accounts', labelKey: 'nav:accounts', icon: Users },
  { to: '/skills', labelKey: 'nav:skills', icon: Puzzle },
  { to: '/mcp', labelKey: 'nav:mcp', icon: Server },
  { to: '/api-service', labelKey: 'nav:apiService', icon: Plug },
  { to: '/sessions', labelKey: 'nav:sessions', icon: History },
];

const SETTINGS_NAV_ITEMS: NavItem[] = [
  { to: '/settings/general', labelKey: 'nav:settings.menu.general', icon: SlidersHorizontal },
  { to: '/settings/sync', labelKey: 'nav:settings.menu.sync', icon: RefreshCw },
  { to: '/settings/advanced', labelKey: 'nav:settings.menu.advanced', icon: Wrench },
  { to: '/settings/about', labelKey: 'nav:settings.menu.about', icon: Info },
];

const SIDEBAR_EXPANDED_WIDTH_PX = 220;
const SIDEBAR_COLLAPSED_WIDTH_PX = 64;

const navButtonClassName =
  'group-data-[state=expanded]:!h-9 group-data-[state=expanded]:!rounded-[8px] group-data-[state=expanded]:!px-3 group-data-[state=expanded]:!py-2 group-data-[state=expanded]:gap-2.5 group-data-[state=expanded]:!text-sm group-data-[state=expanded]:[&>svg]:!size-[18px] md:group-data-[collapsible=icon]/sidebar:!translate-x-0';

type SkillsHeaderTab = 'installed' | 'discover';
type AccountsHeaderTab = 'accounts' | 'groups' | 'proxies';
type ApiServiceHeaderTab = 'service' | 'keys' | 'health';

function getRouteTitleKey(pathname: string) {
  if (pathname.startsWith('/accounts')) return 'accounts:title';
  if (pathname.startsWith('/skills')) return 'nav:skills';
  if (pathname.startsWith('/mcp')) return 'nav:mcp';
  if (pathname.startsWith('/api-service')) return 'nav:apiService';
  if (pathname.startsWith('/analytics')) return 'nav:analytics';
  if (pathname.startsWith('/sessions')) return 'nav:sessions';
  if (pathname.startsWith('/settings/sync')) return 'nav:settings.menu.sync';
  if (pathname.startsWith('/settings/advanced')) return 'nav:settings.menu.advanced';
  if (pathname.startsWith('/settings/about')) return 'nav:settings.menu.about';
  if (pathname.startsWith('/settings')) return 'nav:settings.menu.general';
  return 'nav:dashboard';
}

function SidebarNavItem({ to, labelKey, icon: ItemIcon, end }: NavItem) {
  const { t } = useTranslation();
  const match = useMatch({ path: to, end: end ?? false });
  const isActive = !!match;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={isActive}
        tooltip={{ children: t(labelKey), variant: 'translucent', sideOffset: 10 }}
        className={cn(
          navButtonClassName,
          // Custom haoxiaoguan active state: primary-tinted pill with
          // primary-colored text + icon. Overrides the sidebar primitive's
          // default gray accent.
          isActive &&
            'data-[active=true]:bg-primary/10 data-[active=true]:text-primary data-[active=true]:hover:bg-primary/15 data-[active=true]:hover:text-primary dark:data-[active=true]:bg-primary/20',
        )}
      >
        <NavLink to={to} end={end}>
          <ItemIcon
            strokeWidth={1.75}
            className={cn(
              'shrink-0',
              isActive
                ? 'text-primary'
                : 'text-sidebar-foreground/80 group-hover/menu-item:text-sidebar-accent-foreground',
            )}
          />
          <span className="truncate">{t(labelKey)}</span>
        </NavLink>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function ShellUtilityHoverItem({
  label,
  icon: Icon,
  children,
  contentClassName,
}: {
  label: string;
  icon: LucideIcon;
  children: ReactNode;
  contentClassName?: string;
}) {
  return (
    <HoverCard openDelay={120} closeDelay={120}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          title={label}
          aria-label={label}
          data-tauri-no-drag
          className="no-drag inline-flex size-8 shrink-0 items-center justify-center rounded-[8px] text-foreground/75 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring data-[state=open]:bg-accent data-[state=open]:text-foreground"
        >
          <Icon className="size-[17px]" strokeWidth={1.85} aria-hidden />
        </button>
      </HoverCardTrigger>
      <HoverCardContent className={contentClassName}>{children}</HoverCardContent>
    </HoverCard>
  );
}

export function AppShell({ shell }: AppShellProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const isSettingsRoute = location.pathname.startsWith('/settings');
  const resolvedShell = shell ?? detectPlatformShell(window.location.search, navigator.userAgent);
  // 记住进入设置前的主路由，供「返回」使用。
  useEffect(() => {
    if (!location.pathname.startsWith('/settings')) {
      sessionStorage.setItem('haoxiaoguan:last-main-route', location.pathname);
    }
  }, [location.pathname]);

  const handleBack = () => {
    const last = sessionStorage.getItem('haoxiaoguan:last-main-route') || '/';
    navigate(last);
  };

  // Just over the macOS traffic-light height. Lives above the rounded card
  // gutter so the OS chrome never overlaps content.
  const dragRegionHeight = resolvedShell === 'macos' ? 28 : 0;
  const isSkillsRoute = location.pathname.startsWith('/skills');
  const activeSkillsTab: SkillsHeaderTab =
    new URLSearchParams(location.search).get('tab') === 'discover' ? 'discover' : 'installed';
  // Accounts, Groups, and Proxies share one header: three tabs in place of the
  // title. Groups and Proxies are /accounts/* child routes, so the sidebar
  // "Accounts" entry stays highlighted underneath them. Mirrors the Skills header.
  const isAccountsRoute = location.pathname.startsWith('/accounts');
  const activeAccountsTab: AccountsHeaderTab = location.pathname.startsWith('/accounts/groups')
    ? 'groups'
    : location.pathname.startsWith('/accounts/proxies')
      ? 'proxies'
      : 'accounts';
  const isApiServiceRoute = location.pathname.startsWith('/api-service');
  const activeApiServiceTab: ApiServiceHeaderTab = location.pathname.startsWith('/api-service/keys')
    ? 'keys'
    : location.pathname.startsWith('/api-service/health')
      ? 'health'
      : 'service';

  return (
    <div
      data-testid="app-shell-frame"
      className="flex h-screen w-screen overflow-hidden bg-background text-foreground"
    >
      {/* Top-of-window drag region for macOS traffic lights — fixed full-width lane */}
      {dragRegionHeight > 0 ? (
        <div
          data-testid="shell-safe-area-left"
          className="fixed inset-x-0 top-0 z-[60]"
          style={{ height: dragRegionHeight }}
          data-tauri-drag-region
          aria-hidden="true"
        />
      ) : null}

      <SidebarProvider
        defaultOpen={true}
        style={
          {
            '--sidebar-width': `${SIDEBAR_EXPANDED_WIDTH_PX}px`,
            '--sidebar-width-icon': `${SIDEBAR_COLLAPSED_WIDTH_PX}px`,
          } as CSSProperties
        }
        className="flex min-h-0 flex-1 overflow-hidden"
      >
        <Sidebar
          data-testid="app-shell-sidebar"
          collapsible="icon"
          variant="inset"
        >
          <SidebarHeader className="!p-0">
            <SidebarBrand shell={resolvedShell} />
          </SidebarHeader>
          <SidebarContent className="pt-[18px]">
            <nav>
              <SidebarMenu>
                {isSettingsRoute ? (
                  <>
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        onClick={handleBack}
                        className={navButtonClassName}
                        tooltip={{ children: t('nav:settings.back'), variant: 'translucent', sideOffset: 10 }}
                      >
                        <ArrowLeft strokeWidth={1.75} className="shrink-0 text-sidebar-foreground/80" />
                        <span className="truncate">{t('nav:settings.back')}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    {SETTINGS_NAV_ITEMS.map((item) => (
                      <SidebarNavItem key={`${item.to}-${item.labelKey}`} {...item} />
                    ))}
                  </>
                ) : (
                  MAIN_NAV_ITEMS.map((item) => (
                    <SidebarNavItem key={`${item.to}-${item.labelKey}`} {...item} />
                  ))
                )}
              </SidebarMenu>
            </nav>
          </SidebarContent>
          <SidebarFooter className="px-1 pb-2">
            <SidebarUserCard />
          </SidebarFooter>
        </Sidebar>

        <SidebarInset
          data-testid="app-shell-stage"
          className="relative flex min-w-0 flex-1 flex-col overflow-hidden border border-border/80 !bg-card shadow-sm [scrollbar-gutter:auto] md:peer-data-[state=collapsed]:peer-data-[variant=inset]:!ml-0"
        >
          <header
            data-testid="app-shell-header"
            data-tauri-drag-region
            className="flex h-[58px] shrink-0 items-center border-b border-border/80 bg-card px-4"
          >
            <SidebarTrigger
              aria-label={t('common:sidebar.toggle')}
              className="no-drag size-6 rounded-none border-0 bg-transparent text-foreground/75 shadow-none hover:bg-transparent hover:text-foreground [&>svg]:size-4"
              data-tauri-no-drag
            />
            <div className="mx-2.5 h-6 w-px shrink-0 bg-border" aria-hidden="true" />
            {isSkillsRoute ? (
              <ManagementHeaderTabs
                ariaLabel="Skills 页面"
                value={activeSkillsTab}
                tabs={[
                  { value: 'installed', label: 'Skills 管理', to: '/skills' },
                  { value: 'discover', label: '发现技能', to: '/skills?tab=discover' },
                ]}
              />
            ) : isAccountsRoute ? (
              <ManagementHeaderTabs
                ariaLabel={t('nav:accounts')}
                value={activeAccountsTab}
                tabs={[
                  { value: 'accounts', label: t('nav:accounts'), to: '/accounts' },
                  { value: 'groups', label: t('nav:groups'), to: '/accounts/groups' },
                  { value: 'proxies', label: t('nav:proxies'), to: '/accounts/proxies' },
                ]}
              />
            ) : isApiServiceRoute ? (
              <ManagementHeaderTabs
                ariaLabel={t('nav:apiService')}
                value={activeApiServiceTab}
                tabs={[
                  { value: 'service', label: t('nav:apiService'), to: '/api-service/service' },
                  { value: 'keys', label: t('nav:clientKeys.title'), to: '/api-service/keys' },
                  { value: 'health', label: t('nav:poolHealth.title'), to: '/api-service/health' },
                ]}
              />
            ) : (
              <h1
                data-testid="app-shell-title"
                className="truncate text-[16px] font-semibold leading-none text-primary"
              >
                {t(getRouteTitleKey(location.pathname))}
              </h1>
            )}
            <div className="flex-1" data-tauri-drag-region />
            <div
              data-testid="app-shell-utility-actions"
              className="no-drag flex items-center gap-1"
              data-tauri-no-drag
            >
              <UpdaterIndicator />
              <ShellUtilityHoverItem
                icon={Headphones}
                label={t('nav:shell.support')}
                contentClassName="w-64"
              >
                <SupportPopover />
              </ShellUtilityHoverItem>
              <ShellUtilityHoverItem
                icon={BookOpen}
                label={t('nav:shell.docs')}
                contentClassName="w-72"
              >
                <FaqPopover />
              </ShellUtilityHoverItem>
              <ShellUtilityHoverItem
                icon={Bell}
                label={t('nav:shell.notifications')}
                contentClassName="w-72"
              >
                <NotificationPopover />
              </ShellUtilityHoverItem>
            </div>
            {resolvedShell === 'windows_like' ? (
              <div
                data-testid="shell-safe-area-right"
                className="h-full w-[140px] shrink-0"
                aria-hidden="true"
                data-tauri-drag-region
              />
            ) : null}
          </header>

          <ScrollArea
            data-testid="app-shell-content-scroll"
            className="relative min-h-0 min-w-0 flex-1"
            type="auto"
          >
            <div className="min-h-full min-w-0">
              <Outlet />
            </div>
          </ScrollArea>
        </SidebarInset>
      </SidebarProvider>
    </div>
  );
}
