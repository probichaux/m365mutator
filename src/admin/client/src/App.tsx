import { useCallback, useEffect, useState } from 'react';
import { FluentProvider } from '@fluentui/react-components';
import { mutatorTheme } from './theme';
import { ToastProvider } from './components/ToastProvider';
import Layout from './components/Layout';
import SettingsFlyout from './components/SettingsFlyout';
import HelpFlyout from './components/HelpFlyout';
import IdentitiesPage from './pages/IdentitiesPage';
import MailPage from './pages/MailPage';
import CalendarPage from './pages/CalendarPage';
import OneDrivePage from './pages/OneDrivePage';
import SharePointPage from './pages/SharePointPage';

export type PageId = 'identities' | 'mail' | 'calendar' | 'onedrive' | 'sharepoint';

export const PAGE_IDS: PageId[] = ['identities', 'mail', 'calendar', 'onedrive', 'sharepoint'];

function pageFromHash(hash: string): PageId {
  const id = hash.replace(/^#/, '');
  return (PAGE_IDS as string[]).includes(id) ? (id as PageId) : 'identities';
}

function AppShell() {
  const [page, setPage] = useState<PageId>(() => pageFromHash(window.location.hash));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    const onHashChange = () => setPage(pageFromHash(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = useCallback((next: PageId) => {
    window.location.hash = next;
    setPage(next);
  }, []);

  const renderPage = () => {
    switch (page) {
      case 'identities': return <IdentitiesPage />;
      case 'mail': return <MailPage />;
      case 'calendar': return <CalendarPage />;
      case 'onedrive': return <OneDrivePage />;
      case 'sharepoint': return <SharePointPage />;
    }
  };

  return (
    <Layout
      page={page}
      onNavigate={navigate}
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
