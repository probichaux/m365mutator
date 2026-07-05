import { useCallback, useEffect, useState, type ComponentType } from 'react';
import { FluentProvider } from '@fluentui/react-components';
import { mutatorTheme } from './theme';
import { ToastProvider } from './components/ToastProvider';
import Layout from './components/Layout';
import SettingsFlyout from './components/SettingsFlyout';
import DashboardPage from './pages/DashboardPage';
import UsersPage from './pages/UsersPage';
import MailPage from './pages/MailPage';
import CalendarPage from './pages/CalendarPage';
import FilesPage from './pages/FilesPage';

export type PageId = 'dashboard' | 'users' | 'mail' | 'calendar' | 'files';

const PAGES: Record<PageId, ComponentType> = {
  dashboard: DashboardPage,
  users: UsersPage,
  mail: MailPage,
  calendar: CalendarPage,
  files: FilesPage,
};

function pageFromHash(hash: string): PageId {
  const id = hash.replace(/^#/, '');
  return id in PAGES ? (id as PageId) : 'dashboard';
}

function AppShell() {
  const [page, setPage] = useState<PageId>(() => pageFromHash(window.location.hash));
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    const onHashChange = () => setPage(pageFromHash(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = useCallback((next: PageId) => {
    window.location.hash = next;
    setPage(next);
  }, []);

  const Page = PAGES[page];

  return (
    <Layout page={page} onNavigate={navigate} onOpenSettings={() => setSettingsOpen(true)}>
      <Page />
      <SettingsFlyout open={settingsOpen} onClose={() => setSettingsOpen(false)} />
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
