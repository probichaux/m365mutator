import { Button } from '@fluentui/react-components';
import type { PageId } from '../App';

interface LayoutProps {
  page: PageId;
  onNavigate: (page: PageId) => void;
  onOpenSettings: () => void;
  onOpenHelp: () => void;
  children: React.ReactNode;
}

const TABS: { id: PageId; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'targets', label: 'Targets' },
  { id: 'users', label: 'Users' },
  { id: 'mail', label: 'Mail' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'files', label: 'Files' },
];

export default function Layout({ page, onNavigate, onOpenSettings, onOpenHelp, children }: LayoutProps) {
  return (
    <div style={{ minHeight: '100vh', background: '#f1f1f1' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: '#241d78',
          color: '#fff',
          padding: '12px 24px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <img src="/admin/favicon.svg" alt="M365Mutator" style={{ height: 24 }} />
          <span style={{ fontSize: 18, fontWeight: 600 }}>M365Mutator</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button
            appearance="subtle"
            onClick={onOpenSettings}
            style={{ color: '#fff' }}
            title="Settings"
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
              </svg>
            }
          />
          <Button
            appearance="subtle"
            onClick={onOpenHelp}
            style={{ color: '#fff' }}
            title="Help"
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            }
          />
        </div>
      </header>

      <nav
        style={{
          display: 'flex',
          justifyContent: 'center',
          gap: 4,
          background: '#241d78',
          padding: '0 24px 8px',
        }}
      >
        {TABS.map((tab) => {
          const active = page === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onNavigate(tab.id)}
              style={{
                appearance: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: active ? 600 : 500,
                color: '#fff',
                background: active ? 'rgba(255,255,255,0.22)' : 'transparent',
                padding: '6px 16px',
                borderRadius: 6,
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>

      <main
        style={{
          maxWidth: 1100,
          margin: '0 auto',
          padding: '24px',
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        {children}
      </main>
    </div>
  );
}
