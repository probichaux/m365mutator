import { useCallback, useEffect, useState } from 'react';
import { FluentProvider } from '@fluentui/react-components';
import { mutatorTheme } from './theme';
import { api } from './api';
import { ToastProvider } from './components/ToastProvider';
import Layout from './components/Layout';
import SettingsFlyout from './components/SettingsFlyout';
import HelpFlyout from './components/HelpFlyout';
import DashboardPage from './pages/DashboardPage';
import TargetsPage from './pages/TargetsPage';
import UsersPage from './pages/UsersPage';
import MailPage from './pages/MailPage';
import CalendarPage from './pages/CalendarPage';
import FilesPage from './pages/FilesPage';

export type PageId = 'dashboard' | 'targets' | 'users' | 'mail' | 'calendar' | 'files';

const PAGE_IDS: PageId[] = ['dashboard', 'targets', 'users', 'mail', 'calendar', 'files'];

/** Enabled state of each target category, as persisted by the Targets page. */
interface TargetsEnabled {
  identities: boolean;
  mail: boolean;
  calendar: boolean;
  onedrive: boolean;
  sharepoint: boolean;
}

function pageFromHash(hash: string): PageId {
  const id = hash.replace(/^#/, '');
  return (PAGE_IDS as string[]).includes(id) ? (id as PageId) : 'dashboard';
}

function AppShell() {
  const [page, setPage] = useState<PageId>(() => pageFromHash(window.location.hash));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [enabled, setEnabled] = useState<TargetsEnabled | null>(null);

  const refreshTargets = useCallback(() => {
    api<Record<string, { enabled?: boolean }>>('GET', '/api/targets').then(r => {
      if (r.status !== 200) return;
      setEnabled({
        identities: !!r.data.identities?.enabled,
        mail: !!r.data.mail?.enabled,
        calendar: !!r.data.calendar?.enabled,
        onedrive: !!r.data.onedrive?.enabled,
        sharepoint: !!r.data.sharepoint?.enabled,
      });
    });
  }, []);

  useEffect(() => { refreshTargets(); }, [refreshTargets]);

  // Dashboard and Targets are always reachable; the mutation tabs follow their
  // matching target category. Files covers both OneDrive and SharePoint. Until
  // the config loads (enabled === null) every tab stays enabled to avoid a flash
  // of disabled tabs on first paint.
  const isTabEnabled = useCallback((id: PageId): boolean => {
    if (id === 'dashboard' || id === 'targets' || enabled === null) return true;
    switch (id) {
      case 'users': return enabled.identities;
      case 'mail': return enabled.mail;
      case 'calendar': return enabled.calendar;
      case 'files': return enabled.onedrive || enabled.sharepoint;
    }
  }, [enabled]);

  useEffect(() => {
    const onHashChange = () => setPage(pageFromHash(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = useCallback((next: PageId) => {
    if (!isTabEnabled(next)) return;
    window.location.hash = next;
    setPage(next);
  }, [isTabEnabled]);

  // If the active page's category gets disabled (here or in another tab), fall
  // back to the dashboard rather than leaving a dead page on screen.
  useEffect(() => {
    if (!isTabEnabled(page)) {
      window.location.hash = 'dashboard';
      setPage('dashboard');
    }
  }, [isTabEnabled, page]);

  const renderPage = () => {
    switch (page) {
      case 'dashboard': return <DashboardPage />;
      case 'targets': return <TargetsPage onSaved={refreshTargets} />;
      case 'users': return <UsersPage />;
      case 'mail': return <MailPage />;
      case 'calendar': return <CalendarPage />;
      case 'files': return <FilesPage />;
    }
  };

  return (
    <Layout
      page={page}
      onNavigate={navigate}
      isTabEnabled={isTabEnabled}
      onOpenSettings={() => setSettingsOpen(true)}
      onOpenHelp={() => setHelpOpen(true)}
    >
      {renderPage()}
      <SettingsFlyout open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <HelpFlyout open={helpOpen} onClose={() => setHelpOpen(false)} />
    </Layout>
  );
}

export default function App() {
  return (
    <FluentProvider theme={mutatorTheme}>
      <ToastProvider>
        <AppShell />
      </ToastProvider>
    </FluentProvider>
  );
}
