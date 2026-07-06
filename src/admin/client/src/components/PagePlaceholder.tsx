import { useTranslation } from 'react-i18next';
import { Card, Text, Title2, tokens } from '@fluentui/react-components';

interface PagePlaceholderProps {
  pageKey: 'mail' | 'calendar' | 'files';
}

export default function PagePlaceholder({ pageKey }: PagePlaceholderProps) {
  const { t } = useTranslation('pages');
  const operations = t(`${pageKey}.operations`, { returnObjects: true }) as string[];

  return (
    <div>
      <Title2 block style={{ marginBottom: 16 }}>{t(`${pageKey}.title`)}</Title2>
      <Card>
        <Text size={300} block style={{ marginBottom: 12 }}>
          {t('common:requiresPermission')} <Text weight="semibold" font="monospace">{t(`${pageKey}.permission`)}</Text>.
        </Text>
        <Text weight="semibold" block style={{ marginBottom: 8 }}>{t('common:plannedOperations')}</Text>
        <ul style={{ margin: 0, paddingLeft: 20, color: tokens.colorNeutralForeground2 }}>
          {operations.map(op => <li key={op} style={{ marginBottom: 4 }}>{op}</li>)}
        </ul>
      </Card>
    </div>
  );
}
