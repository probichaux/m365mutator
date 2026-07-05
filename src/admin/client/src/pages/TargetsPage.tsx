import { useTranslation } from 'react-i18next';
import { Text, Title2, tokens } from '@fluentui/react-components';

export default function TargetsPage() {
  const { t } = useTranslation('targets');
  const operations = t('operations', { returnObjects: true }) as string[];

  return (
    <div>
      <Title2 block style={{ marginBottom: 16 }}>{t('title')}</Title2>
      <div style={{
        background: tokens.colorNeutralBackground1,
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        borderRadius: 8,
        padding: 24,
      }}>
        <Text size={300} block style={{ marginBottom: 12 }}>{t('description')}</Text>
        <Text weight="semibold" block style={{ marginBottom: 8 }}>{t('plannedFunctionality')}</Text>
        <ul style={{ margin: 0, paddingLeft: 20, color: tokens.colorNeutralForeground2 }}>
          {operations.map(op => <li key={op} style={{ marginBottom: 4 }}>{op}</li>)}
        </ul>
      </div>
    </div>
  );
}
