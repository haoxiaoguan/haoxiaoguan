import { Outlet, NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

/** Navigation items for the sidebar */
const NAV_ITEMS = [
  { path: '/', icon: '📊', labelKey: 'nav.dashboard' },
  { path: '/accounts', icon: '👤', labelKey: 'nav.accounts' },
  { path: '/settings', icon: '⚙️', labelKey: 'nav.settings' },
] as const;

export default function Layout() {
  const { t } = useTranslation();

  return (
    <div className="flex h-screen bg-base-100">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 bg-base-200 border-r border-base-300 flex flex-col">
        {/* App branding */}
        <div className="p-4 border-b border-base-300">
          <h1 className="text-xl font-bold text-primary">Haoxiaoguan</h1>
          <p className="text-xs text-base-content/50 mt-0.5">{t('app.description')}</p>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-2 space-y-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-base-content/70 hover:bg-base-300 hover:text-base-content'
                }`
              }
            >
              <span className="text-base">{item.icon}</span>
              <span>{t(item.labelKey)}</span>
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="p-3 border-t border-base-300">
          <p className="text-xs text-base-content/40 text-center">v0.1.0</p>
        </div>
      </aside>

      {/* Main content area */}
      <main className="flex-1 overflow-y-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
