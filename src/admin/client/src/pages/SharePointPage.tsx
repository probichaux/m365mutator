import { useTranslation } from 'react-i18next';
import { Title2 } from '@fluentui/react-components';
import TargetPanel from '../components/TargetPanel';
import MutationPlaceholder from '../components/MutationPlaceholder';

export default function SharePointPage() {
  const { t } = useTranslation('targets');
  return (
    <div>
      <Title2 block style={{ marginBottom: 16 }}>{t('categories.sharepoint.label')}</Title2>
      <TargetPanel category="sharepoint" />
      <MutationPlaceholder titleKey="scaffold.sharepointTitle" />
    </div>
  );
}
