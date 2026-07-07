import { useTranslation } from 'react-i18next';
import {
  Button, TabList, Tab, tokens,
  type SelectTabData, type SelectTabEvent,
} from '@fluentui/react-components';
import { SettingsRegular, QuestionCircleRegular } from '@fluentui/react-icons';
import LanguageSwitcher from './LanguageSwitcher';
import { PAGE_IDS, type PageId } from '../App';

interface LayoutProps {
  page: PageId;
  onNavigate: (page: PageId) => void;
  onOpenSettings: () => void;
  onOpenHelp: () => void;
  children: React.ReactNode;
}

export default function Layout({ page, onNavigate, onOpenSettings, onOpenHelp, children }: LayoutProps) {
  const { t } = useTranslation('nav');

  return (
    <div style={{ minHeight: '100vh', background: tokens.colorNeutralBackground3 }}>
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
          <Button appearance="subtle" onClick={onOpenSettings} style={{ color: '#fff' }}
            title={t('settings')} aria-label={t('settings')} icon={<SettingsRegular />} />
          <Button appearance="subtle" onClick={onOpenHelp} style={{ color: '#fff' }}
            title={t('help')} aria-label={t('help')} icon={<QuestionCircleRegular />} />
        </div>
      </header>

      <nav
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto 1fr',
          alignItems: 'center',
          gap: 4,
          background: tokens.colorNeutralBackground1,
          borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
          padding: '0 24px',
        }}
      >
        <div />
        <TabList
          selectedValue={page}
          onTabSelect={(_e: SelectTabEvent, data: SelectTabData) => onNavigate(data.value as PageId)}
        >
          {PAGE_IDS.map((tabId) => (
            <Tab key={tabId} value={tabId}>{t(tabId)}</Tab>
          ))}
        </TabList>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <LanguageSwitcher />
        </div>
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
