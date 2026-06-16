import {
  ArrowLeft,
  Bell,
  BookOpen,
  Cable,
  Headphones,
  History,
  Info,
  LayoutGrid,
  Puzzle,
  RefreshCw,
  Route,
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
import { NavLink, useLocation, useMatch, useNavigate } from 'react-router-dom';
import { KeepAliveOutlet } from './KeepAliveOutlet';
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
import { detectPlatformShell, isWindowsChrome, type PlatformShell } from './platform-shell';
import { SupportPopover } from './shell-utility/SupportPopover';
import { FaqPopover } from './shell-utility/FaqPopover';
import { systemService } from '../services/tauri';
import { useQuotaStateStore } from '../stores';
import { NotificationPopover } from './shell-utility/NotificationPopover';
import { UpdaterIndicator } from './shell-utility/UpdaterIndicator';
import { WindowControls } from './shell-utility/WindowControls';
import { useThemeValue } from '../hooks/use-theme';
import { bridge } from '../services/bridge';

interface AppShellProps {
  shell?: PlatformShell;
}

interface NavItem {
  to: string;
  labelKey: string;
  icon: LucideIcon;
  end?: boolean;
  /** 额外保持高亮的路由前缀（子功能路由不在 to 之下时用，如 API 服务并入客户端接入）。 */
  alsoMatch?: string;
}

const MAIN_NAV_ITEMS: NavItem[] = [
  { to: '/', labelKey: 'nav:dashboard', icon: LayoutGrid, end: true },
  { to: '/accounts', labelKey: 'nav:accounts', icon: Users },
  // 路由服务（本地反代）：路由服务 / 客户端 Key / 账号池监控三个 tab，排在账号管理后。
  { to: '/api-service/service', labelKey: 'nav:apiService', icon: Route, alsoMatch: '/api-service' },
  // 客户端管理（版本/升级/诊断）+ 供应商管理（接入配置）两个 tab。
  { to: '/client-config', labelKey: 'nav:clientManage.title', icon: Cable },
  { to: '/sessions', labelKey: 'nav:sessions', icon: History },
  { to: '/skills', labelKey: 'nav:skills', icon: Puzzle },
  { to: '/mcp', labelKey: 'nav:mcp', icon: Server },
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
type ClientConfigHeaderTab = 'manage' | 'access';
type RouteServiceHeaderTab = 'service' | 'combos' | 'keys' | 'health' | 'logs';

function getRouteTitleKey(pathname: string) {
  if (pathname.startsWith('/accounts')) return 'accounts:title';
  if (pathname.startsWith('/skills')) return 'nav:skills';
  if (pathname.startsWith('/mcp')) return 'nav:mcp';
  if (pathname.startsWith('/api-service')) return 'nav:apiService';
  if (pathname.startsWith('/client-config')) return 'nav:clientManage.title';
  if (pathname.startsWith('/analytics')) return 'nav:analytics';
  if (pathname.startsWith('/sessions')) return 'nav:sessions';
  if (pathname.startsWith('/settings/sync')) return 'nav:settings.menu.sync';
  if (pathname.startsWith('/settings/advanced')) return 'nav:settings.menu.advanced';
  if (pathname.startsWith('/settings/about')) return 'nav:settings.menu.about';
  if (pathname.startsWith('/settings')) return 'nav:settings.menu.general';
  return 'nav:dashboard';
}

function SidebarNavItem({ to, labelKey, icon: ItemIcon, end, alsoMatch }: NavItem) {
  const { t } = useTranslation();
  const match = useMatch({ path: to, end: end ?? false });
  // alsoMatch 未配置时用一个永不命中的占位路径，保证 hook 调用次数稳定。
  const alsoMatched = useMatch({ path: alsoMatch ?? '/__never__', end: false });
  const isActive = !!match || (alsoMatch !== undefined && !!alsoMatched);

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
  // Windows：系统原生标题栏覆盖按钮 + 内容贴边(去上/下/右间距、去右圆角) + 更矮 header。
  // Linux 同属 windows_like 但不支持 titleBarOverlay，仍走 header 自绘按钮 + 浮动卡片(保持原状)。
  const isWindowsNative = resolvedShell === 'windows_like' && isWindowsChrome();
  const isLinuxLike = resolvedShell === 'windows_like' && !isWindowsNative;
  const themeValue = useThemeValue();
  // 记住进入设置前的主路由，供「返回」使用。
  useEffect(() => {
    if (!location.pathname.startsWith('/settings')) {
      sessionStorage.setItem('haoxiaoguan:last-main-route', location.pathname);
    }
  }, [location.pathname]);

  // 调度器每轮额度刷新后主进程推 quota:updated;这里全局重拉对应账号的
  // quota state(store 的 ensure 有缓存即跳过,不接这条卡片会一直停在旧数据)。
  useEffect(() => {
    const unsub = systemService.onQuotaUpdated((accountIds) => {
      void useQuotaStateStore.getState().pull(accountIds);
    });
    return unsub;
  }, []);

  // 仅 Windows：应用明暗主题变化时，同步系统原生覆盖按钮(min/max/close)的图标颜色。
  useEffect(() => {
    if (!isWindowsNative) return;
    void bridge().windowControls.setOverlayTheme(themeValue === 'dark');
  }, [isWindowsNative, themeValue]);

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
  // 路由服务（/api-service：路由服务/客户端 Key/账号池监控）与客户端管理（/client-config：客户端管理/供应商管理）
  // 各自一组顶部 tabs。
  const isRouteServiceRoute = location.pathname.startsWith('/api-service');
  const isClientConfigRoute = location.pathname.startsWith('/client-config');
  const activeRouteServiceTab: RouteServiceHeaderTab = location.pathname.startsWith('/api-service/combos')
    ? 'combos'
    : location.pathname.startsWith('/api-service/keys')
      ? 'keys'
      : location.pathname.startsWith('/api-service/health')
        ? 'health'
        : location.pathname.startsWith('/api-service/logs')
          ? 'logs'
          : 'service';
  const activeClientConfigTab: ClientConfigHeaderTab = location.pathname.startsWith('/client-config/access')
    ? 'access'
    : 'manage'; // /client-config 默认进客户端管理

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
          className={cn(
            'relative flex min-w-0 flex-1 flex-col overflow-hidden border border-border/80 !bg-card shadow-sm [scrollbar-gutter:auto] md:peer-data-[state=collapsed]:peer-data-[variant=inset]:!ml-0',
            // Windows：去掉上/下/右间距 + 右侧圆角，内容贴窗口边(类原生窗口/Zed)；左侧保留圆角与侧栏留白。
            isWindowsNative &&
              'md:peer-data-[variant=inset]:!mt-0 md:peer-data-[variant=inset]:!mb-0 md:peer-data-[variant=inset]:!mr-0 md:peer-data-[variant=inset]:!rounded-r-none',
          )}
        >
          <header
            data-testid="app-shell-header"
            data-tauri-drag-region
            className={cn(
              'flex shrink-0 items-center border-b border-border/80 bg-card px-4',
              // Windows：header 略矮(48px)，与系统原生覆盖按钮的标题栏高度一致(见 main 的
              // WINDOWS_TITLEBAR_HEIGHT)；其余平台 58px。
              isWindowsNative ? 'h-[48px]' : 'h-[58px]',
            )}
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
            ) : isRouteServiceRoute ? (
              <ManagementHeaderTabs
                ariaLabel={t('nav:apiService')}
                value={activeRouteServiceTab}
                tabs={[
                  { value: 'service', label: t('nav:apiService'), to: '/api-service/service' },
                  { value: 'combos', label: t('nav:service.combos.title'), to: '/api-service/combos' },
                  { value: 'keys', label: t('nav:clientKeys.title'), to: '/api-service/keys' },
                  { value: 'health', label: t('nav:poolHealth.title'), to: '/api-service/health' },
                  { value: 'logs', label: t('nav:routingLog.title'), to: '/api-service/logs' },
                ]}
              />
            ) : isClientConfigRoute ? (
              <ManagementHeaderTabs
                ariaLabel={t('nav:clientManage.title')}
                value={activeClientConfigTab}
                tabs={[
                  { value: 'manage', label: t('nav:clientManage.title'), to: '/client-config' },
                  { value: 'access', label: t('nav:clientConfig'), to: '/client-config/access' },
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
            {isLinuxLike ? <WindowControls /> : null}
            {isWindowsNative ? (
              // Windows：为系统原生覆盖按钮(min/max/close)预留右上角空间(贴窗口右边缘)，
              // 避免工具图标被盖住。-mr-4 抵消 header 的 px-4，使预留区贴到窗口右边缘。
              <div
                aria-hidden="true"
                data-tauri-drag-region
                className="-mr-4 ml-1 h-full w-[140px] shrink-0"
              />
            ) : null}
          </header>

          <ScrollArea
            data-testid="app-shell-content-scroll"
            className="relative min-h-0 min-w-0 flex-1"
            type="auto"
          >
            <div className="min-h-full min-w-0">
              {/* 路由级 KeepAlive：缓存已访问页面、切换不丢状态（settings 自带嵌套 Outlet，排除）。 */}
              <KeepAliveOutlet exclude={(p) => p.startsWith('/settings')} />
            </div>
          </ScrollArea>
        </SidebarInset>
      </SidebarProvider>
    </div>
  );
}
