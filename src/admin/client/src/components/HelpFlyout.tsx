import { Button, Text, tokens } from '@fluentui/react-components';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

interface HelpFlyoutProps {
  open: boolean;
  onClose: () => void;
}

const REPO_URL = 'https://github.com/probichaux/m365mutator';

export default function HelpFlyout({ open, onClose }: HelpFlyoutProps) {
  const { t } = useTranslation('help');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const sectionStyle = { marginBottom: 24, paddingBottom: 24, borderBottom: `1px solid ${tokens.colorNeutralStroke2}` };
  const steps = t('gettingStarted.steps', { returnObjects: true }) as string[];

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 300, animation: 'fadeIn 0.15s ease' }}
    >
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 480, maxWidth: '90vw',
        background: tokens.colorNeutralBackground1, boxShadow: tokens.shadow64,
        display: 'flex', flexDirection: 'column', animation: 'slideInRight 0.2s ease',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '20px 24px', borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        }}>
          <Text weight="semibold" size={500}>{t('title')}</Text>
          <Button appearance="subtle" onClick={onClose} aria-label={t('common:close')} style={{ fontSize: 20, minWidth: 32 }}>&times;</Button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>

          <div style={sectionStyle}>
            <Text weight="semibold" size={400} block style={{ marginBottom: 8 }}>{t('about.heading')}</Text>
            <Text size={300} block>{t('about.body')}</Text>
          </div>

          <div style={sectionStyle}>
            <Text weight="semibold" size={400} block style={{ marginBottom: 8 }}>{t('gettingStarted.heading')}</Text>
            <ol style={{ margin: 0, paddingLeft: 20, color: tokens.colorNeutralForeground2 }}>
              {steps.map((step, i) => (
                <li key={i} style={{ marginBottom: i < steps.length - 1 ? 4 : 0 }}>{step}</li>
              ))}
            </ol>
          </div>

          <div style={sectionStyle}>
            <Text weight="semibold" size={400} block style={{ marginBottom: 8 }}>{t('permissions.heading')}</Text>
            <Text size={300} block style={{ color: tokens.colorNeutralForeground2 }}>{t('permissions.body')}</Text>
          </div>

          <div>
            <Text weight="semibold" size={400} block style={{ marginBottom: 8 }}>{t('repository.heading')}</Text>
            <Text size={300} block style={{ color: tokens.colorNeutralForeground2 }}>
              {t('repository.body')}{' '}
              <a href={REPO_URL} target="_blank" rel="noopener noreferrer" style={{ color: tokens.colorBrandForeground1 }}>
                {REPO_URL}
              </a>
            </Text>
          </div>

        </div>
      </div>
    </div>
  );
}
