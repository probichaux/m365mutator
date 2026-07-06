import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, Text, Title2, tokens } from '@fluentui/react-components';
import { api } from '../api';

interface ConfigData {
  graphTenantId: string;
  graphClientId: string;
  graphClientSecret: string;
  graphCertificatePath: string;
}

export default function DashboardPage() {
  const { t } = useTranslation('dashboard');
  const [config, setConfig] = useState<ConfigData | null>(null);

  useEffect(() => {
    api<ConfigData>('GET', '/api/config').then(r => setConfig(r.data));
  }, []);

  const configured = !!config?.graphTenantId && !!config?.graphClientId &&
    (!!config?.graphClientSecret || !!config?.graphCertificatePath);

  return (
    <div>
      <Title2 block style={{ marginBottom: 16 }}>{t('title')}</Title2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
        <Card>
          <Text weight="semibold" block style={{ marginBottom: 8 }}>{t('graphCard.title')}</Text>
          <Text size={300} style={{ color: configured ? tokens.colorPaletteGreenForeground1 : tokens.colorPaletteRedForeground1 }}>
            {configured ? t('graphCard.configured') : t('graphCard.notConfigured')}
          </Text>
          <Text size={200} block style={{ color: tokens.colorNeutralForeground3, marginTop: 4 }}>
            {configured
              ? t('graphCard.authMode', {
                  mode: config?.graphCertificatePath ? t('graphCard.authModeCertificate') : t('graphCard.authModeClientSecret'),
                })
              : t('graphCard.openSettingsHint')}
          </Text>
        </Card>
      </div>

      <Text block style={{ marginTop: 24, color: tokens.colorNeutralForeground3 }}>
        {t('footer')}
      </Text>
    </div>
  );
}
