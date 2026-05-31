import type { ReactNode } from 'react';

interface SettingsLayoutProps {
  /** 页面标题。顶部 AppShell header 已展示路由标题，这里不再重复渲染，仅保留作语义参数。 */
  title?: string;
  description?: string;
  children: ReactNode;
}

/** 设置子页统一外壳：描述 + 内容区（标题由顶部 header 统一展示，避免重复）。 */
export function SettingsLayout({ description, children }: SettingsLayoutProps) {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-8 py-7">
      {description ? (
        <p className="text-sm text-muted-foreground">{description}</p>
      ) : null}
      <div className="space-y-5">{children}</div>
    </div>
  );
}
