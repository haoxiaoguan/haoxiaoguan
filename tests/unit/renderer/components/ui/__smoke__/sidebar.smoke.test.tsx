import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
} from '@/components/ui/sidebar';

describe('sidebar smoke', () => {
  it('renders provider/sidebar/inset shell without throwing', () => {
    const { container } = render(
      <SidebarProvider>
        <Sidebar>
          <SidebarHeader>brand</SidebarHeader>
          <SidebarContent>nav</SidebarContent>
          <SidebarFooter>user</SidebarFooter>
        </Sidebar>
        <SidebarInset>main</SidebarInset>
      </SidebarProvider>,
    );
    expect(container.textContent).toContain('brand');
    expect(container.textContent).toContain('main');
  });
});
