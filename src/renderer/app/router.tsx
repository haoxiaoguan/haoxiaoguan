import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import Dashboard from '../pages/Dashboard';
import Accounts from '../pages/Accounts';
import Skills from '../pages/Skills';
import Mcp from '../pages/Mcp';
import Analytics from '../pages/Analytics';
import Settings from '../pages/Settings';
import GeneralSettings from '../components/settings/pages/GeneralSettings';
import AgentSettings from '../components/settings/pages/AgentSettings';
import SyncSettings from '../components/settings/pages/SyncSettings';
import AdvancedSettings from '../components/settings/pages/AdvancedSettings';
import AboutSettings from '../components/settings/pages/AboutSettings';
import { AppShell } from './AppShell';

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AppShell />}>
          <Route index element={<Dashboard />} />
          <Route path="accounts/:platform?" element={<Accounts />} />
          <Route path="skills" element={<Skills />} />
          <Route path="mcp" element={<Mcp />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="settings" element={<Settings />}>
            <Route index element={<Navigate to="general" replace />} />
            <Route path="general" element={<GeneralSettings />} />
            <Route path="agent" element={<AgentSettings />} />
            <Route path="sync" element={<SyncSettings />} />
            <Route path="advanced" element={<AdvancedSettings />} />
            <Route path="about" element={<AboutSettings />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
