import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import Skills from './Skills';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock('../components/skills/UnifiedSkillsPanel', () => ({
  UnifiedSkillsPanel: () => <div>skills-panel</div>,
}));

describe('Skills 页面', () => {
  it('内容区不再重复渲染大标题和页内 tab', () => {
    render(
      <MemoryRouter>
        <Skills />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('heading', { name: 'Skills 管理' })).not.toBeInTheDocument();
    expect(screen.getByText('skills-panel')).toBeInTheDocument();
  });
});
