import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import Dashboard from '../pages/Dashboard';
import Accounts from '../pages/Accounts';
import Skills from '../pages/Skills';
import Mcp from '../pages/Mcp';
import ApiProxyService from '../pages/ApiProxyService';
import ApiProxyCombos from '../pages/ApiProxyCombos';
import ApiProxyKeys from '../pages/ApiProxyKeys';
import ApiProxyHealth from '../pages/ApiProxyHealth';
import ClientConfig from '../pages/ClientConfig';
import ClientManage from '../pages/ClientManage';
import Proxies from '../pages/Proxies';
import Groups from '../pages/Groups';
import Analytics from '../pages/Analytics';
import Sessions from '../pages/Sessions';
import Settings from '../pages/Settings';
import GeneralSettings from '../components/settings/pages/GeneralSettings';
import SyncSettings from '../components/settings/pages/SyncSettings';
import AdvancedSettings from '../components/settings/pages/AdvancedSettings';
import AboutSettings from '../components/settings/pages/AboutSettings';
import { AppShell } from './AppShell';

export function AppRouter() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<AppShell />}>
          <Route index element={<Dashboard />} />
          {/* Groups and Proxies are children of accounts so the sidebar
              "Accounts" entry stays active under them. The static "groups" /
              "proxies" segments out-rank the optional :platform?, so
              /accounts/groups → Groups, /accounts/proxies → Proxies, and
              /accounts(/:platform) → Accounts. */}
          <Route path="accounts">
            <Route path="groups" element={<Groups />} />
            <Route path="proxies" element={<Proxies />} />
            <Route path=":platform?" element={<Accounts />} />
          </Route>
          <Route path="skills" element={<Skills />} />
          <Route path="mcp" element={<Mcp />} />
          <Route path="api-service">
            <Route path="service" element={<ApiProxyService />} />
            <Route path="combos" element={<ApiProxyCombos />} />
            <Route path="keys" element={<ApiProxyKeys />} />
            <Route path="health" element={<ApiProxyHealth />} />
            <Route index element={<Navigate to="service" replace />} />
          </Route>
          {/* /client-config 默认进「客户端管理」（版本/升级/诊断）；接入配置移到 /access。 */}
          <Route path="client-config" element={<ClientManage />} />
          <Route path="client-config/access" element={<ClientConfig />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="sessions" element={<Sessions />} />
          <Route path="settings" element={<Settings />}>
            <Route index element={<Navigate to="general" replace />} />
            <Route path="general" element={<GeneralSettings />} />
            <Route path="sync" element={<SyncSettings />} />
            <Route path="advanced" element={<AdvancedSettings />} />
            <Route path="about" element={<AboutSettings />} />
          </Route>
        </Route>
      </Routes>
    </HashRouter>
  );
}
