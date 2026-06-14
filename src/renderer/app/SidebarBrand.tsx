import { useTranslation } from 'react-i18next';
import brandLogo from '@/assets/brand/logo.png';
import type { PlatformShell } from './platform-shell';

interface SidebarBrandProps {
  shell: PlatformShell;
}

/**
 * Sidebar brand block — AiMaMi visual pattern, Haoxiaoguan branding.
 *
 * Collapsed (icon-only) state: shows the avatar centered.
 * Expanded state: avatar with green online dot + brand name + tagline subtitle.
 *
 * Shell-aware top safe area:
 *   - macOS: 28px lane to clear the traffic lights drawn by the OS over the webview.
 *   - Windows / Linux: title bar buttons live on the right side of the window,
 *     so the sidebar can start at y=0.
 */
export function SidebarBrand({ shell }: SidebarBrandProps) {
  const { t } = useTranslation();

  return (
    <div data-testid="app-shell-brand" className="!p-0">
      {shell === 'macos' ? (
        <div
          data-testid="shell-sidebar-safe-area"
          className="h-7 shrink-0"
          data-tauri-drag-region
          aria-hidden="true"
        />
      ) : (
        // Windows/Linux：无红绿灯，但留一段顶部留白把 logo 下移，与右侧 header 行对齐;
        // 同时作为标题栏拖拽区。
        <div
          data-testid="shell-sidebar-safe-area"
          className="h-7 shrink-0"
          data-tauri-drag-region
          aria-hidden="true"
        />
      )}

      {/* Collapsed state: just the avatar centered. The wrapper is a drag
          region so empty space around the avatar still drags the window;
          the avatar itself opts out via .no-drag so it stays clickable. */}
      <div
        data-tauri-drag-region
        className="hidden justify-center pt-1 group-data-[collapsible=icon]/sidebar:flex"
      >
        <div className="no-drag">
          <BrandAvatar online />
        </div>
      </div>

      {/* Expanded state: avatar + name + tagline. Same drag-region pattern. */}
      <div
        data-tauri-drag-region
        className="group/header flex w-full items-center gap-3 rounded-[10px] pl-2.5 pr-3 py-1 text-left transition-colors group-data-[collapsible=icon]/sidebar:hidden"
      >
        <div className="no-drag">
          <BrandAvatar online />
        </div>
        <div className="no-drag flex min-w-0 flex-col leading-tight">
          <span className="truncate text-[15px] font-semibold text-sidebar-foreground">
            {t('common:brand.name')}
          </span>
          <span className="truncate text-[11px] text-sidebar-foreground/60">
            {t('common:brand.tagline')}
          </span>
        </div>
      </div>
    </div>
  );
}

function BrandAvatar({ online = false }: { online?: boolean }) {
  return (
    <div className="relative h-[35px] w-[35px] shrink-0">
      <img
        src={brandLogo}
        alt=""
        aria-hidden
        draggable={false}
        className="h-full w-full select-none rounded-full object-cover shadow-bento-light"
      />
      {online ? (
        <span
          aria-hidden
          className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-sidebar"
        />
      ) : null}
    </div>
  );
}
