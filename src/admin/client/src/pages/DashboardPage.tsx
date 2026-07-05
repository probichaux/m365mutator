import { useEffect, useState } from 'react';
import { Text, Title2, tokens } from '@fluentui/react-components';
import { api } from '../api';

interface ConfigData {
  graphTenantId: string;
  graphClientId: string;
  graphClientSecret: string;
  graphCertificatePath: string;
}

const cardStyle = {
  background: tokens.colorNeutralBackground1,
  border: `1px solid ${tokens.colorNeutralStroke2}`,
  borderRadius: 8,
  padding: 20,
};

export default function DashboardPage() {
  const [config, setConfig] = useState<ConfigData | null>(null);

  useEffect(() => {
    api<ConfigData>('GET', '/api/config').then(r => setConfig(r.data));
  }, []);

  const configured = !!config?.graphTenantId && !!config?.graphClientId &&
    (!!config?.graphClientSecret || !!config?.graphCertificatePath);

  return (
    <div>
      <Title2 block style={{ marginBottom: 16 }}>Dashboard</Title2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
        <div style={cardStyle}>
          <Text weight="semibold" block style={{ marginBottom: 8 }}>Microsoft Graph</Text>
          <Text size={300} style={{ color: configured ? tokens.colorPaletteGreenForeground1 : tokens.colorPaletteRedForeground1 }}>
            {configured ? 'Configured' : 'Not configured'}
          </Text>
          <Text size={200} block style={{ color: tokens.colorNeutralForeground3, marginTop: 4 }}>
            {configured
              ? `Auth mode: ${config?.graphCertificatePath ? 'certificate' : 'client secret'}`
              : 'Open Settings to add an Entra ID app registration.'}
          </Text>
        </div>
      </div>

      <Text block style={{ marginTop: 24, color: tokens.colorNeutralForeground3 }}>
        Use the tabs above to manage users, mail, calendar items, and OneDrive/SharePoint documents
        in the connected Microsoft 365 tenant.
      </Text>
    </div>
  );
}
