import {
  OverlayDrawer, DrawerHeader, DrawerHeaderTitle, DrawerBody,
  Button, Link, Text, tokens,
} from '@fluentui/react-components';
import { Dismiss24Regular } from '@fluentui/react-icons';
import { useTranslation } from 'react-i18next';

interface HelpFlyoutProps {
  open: boolean;
  onClose: () => void;
}

const REPO_URL = 'https://github.com/probichaux/m365mutator';

export default function HelpFlyout({ open, onClose }: HelpFlyoutProps) {
  const { t } = useTranslation('help');

  const sectionStyle = { marginBottom: 24, paddingBottom: 24, borderBottom: `1px solid ${tokens.colorNeutralStroke2}` };
  const steps = t('gettingStarted.steps', { returnObjects: true }) as string[];

  return (
    <OverlayDrawer
      position="end"
      open={open}
      onOpenChange={(_e, data) => { if (!data.open) onClose(); }}
      style={{ width: 480, maxWidth: '90vw' }}
    >
      <DrawerHeader>
        <DrawerHeaderTitle
          action={
            <Button appearance="subtle" aria-label={t('common:close')}
              icon={<Dismiss24Regular />} onClick={onClose} />
          }
        >
          {t('title')}
        </DrawerHeaderTitle>
      </DrawerHeader>

      <DrawerBody>
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
            <Link href={REPO_URL} target="_blank" rel="noopener noreferrer">{REPO_URL}</Link>
          </Text>
        </div>
      </DrawerBody>
    </OverlayDrawer>
  );
}
