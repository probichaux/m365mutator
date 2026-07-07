import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Text, Tooltip, tokens } from '@fluentui/react-components';
import { FlashRegular } from '@fluentui/react-icons';
import RunStepper from './RunStepper';

/**
 * The mutation-card shell (title + run-count stepper + Do it now) for workloads
 * that do not have a mutation operation implemented yet. The action is disabled
 * with a "no operation yet" note; the stepper is shown so the UI is consistent
 * across tabs and ready to wire up when the operation lands.
 */
export default function MutationPlaceholder({ titleKey }: { titleKey: string }) {
  const { t } = useTranslation('pages');
  const [runs, setRuns] = useState(1);

  return (
    <Card style={{ marginTop: 16 }}>
      <Text weight="semibold" size={400} block style={{ marginBottom: 4 }}>{t(titleKey)}</Text>
      <Text size={300} block style={{ color: tokens.colorNeutralForeground2, marginBottom: 16 }}>
        {t('scaffold.noOperation')}
      </Text>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <RunStepper value={runs} onChange={setRuns} min={1} max={999} ariaLabel={t('scaffold.runsLabel')} />
        <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>{t('scaffold.runsSuffix')}</Text>
        <Tooltip content={t('scaffold.noOperation')} relationship="label">
          <Button appearance="primary" icon={<FlashRegular />} disabled>{t('scaffold.doItNow')}</Button>
        </Tooltip>
      </div>
    </Card>
  );
}
