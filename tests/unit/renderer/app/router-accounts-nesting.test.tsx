import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

// Mirrors the nesting in app/router.tsx: Groups is a child of /accounts, sitting
// next to the optional :platform? segment. These tests pin the matching
// precedence the whole "Groups lives under Accounts" design relies on — the
// static "groups" segment must out-rank the dynamic :platform? so that
// /accounts/groups renders Groups, never Accounts with platform="groups".

function AccountsProbe() {
  const { platform } = useParams();
  return <div>accounts:{platform ?? 'none'}</div>;
}

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="accounts">
          <Route path="groups" element={<div>groups-page</div>} />
          <Route path=":platform?" element={<AccountsProbe />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('accounts route nesting', () => {
  it('renders Accounts (no platform) at /accounts', () => {
    renderAt('/accounts');
    expect(screen.getByText('accounts:none')).toBeInTheDocument();
  });

  it('renders Accounts with the platform param at /accounts/:platform', () => {
    renderAt('/accounts/kiro');
    expect(screen.getByText('accounts:kiro')).toBeInTheDocument();
  });

  it('renders Groups (not Accounts) at /accounts/groups — static segment wins', () => {
    renderAt('/accounts/groups');
    expect(screen.getByText('groups-page')).toBeInTheDocument();
    expect(screen.queryByText(/^accounts:/)).not.toBeInTheDocument();
  });
});
