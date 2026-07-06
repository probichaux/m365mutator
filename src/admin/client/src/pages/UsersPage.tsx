import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button, Card, Spinner, Text, Title2, tokens,
} from '@fluentui/react-components';
import {
  CheckmarkCircle20Filled, DismissCircle20Filled, FlashRegular,
} from '@fluentui/react-icons';
import { api } from '../api';
import { useToast } from '../components/ToastProvider';

interface MutationResult {
  item: string;
  ok: boolean;
  value: unknown;
  error?: string;
}

interface MutationRun {
  attribute: string;
  label: string;
  results: MutationResult[];
  error?: string;
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

export default function UsersPage() {
  const { t, i18n } = useTranslation('pages');
  const showToast = useToast();

  const [running, setRunning] = useState(false);
  const [run, setRun] = useState<MutationRun | null>(null);
  const [attributes, setAttributes] = useState<string[]>([]);

  useEffect(() => {
    api<{ attributes?: string[] }>('GET', '/api/identities/attributes').then(r => {
      if (r.status === 200 && r.data.attributes) setAttributes(r.data.attributes);
    });
  }, []);

  // Locale-aware "A, B, and C" from the live attribute catalog.
  const attributeList = useMemo(
    () => new Intl.ListFormat(i18n.language, { style: 'long', type: 'conjunction' }).format(attributes),
    [attributes, i18n.language],
  );

  const doItNow = async () => {
    setRunning(true);
    setRun(null);
    const result = await api<MutationRun>('POST', '/api/identities/mutate');
    setRunning(false);

    if (result.status === 200 && result.data.results) {
      setRun(result.data);
      const failed = result.data.results.filter(r => !r.ok).length;
      showToast(
        failed === 0
          ? t('users.mutate.toastAllOk', { label: result.data.label, count: result.data.results.length })
          : t('users.mutate.toastFailures', { label: result.data.label, failed, total: result.data.results.length }),
        failed === 0 ? 'success' : 'warning',
      );
    } else {
      showToast(result.data.error || t('users.mutate.toastFailed'), 'error');
    }
  };

  const operations = t('users.operations', { returnObjects: true }) as string[];

  return (
    <div>
      <Title2 block style={{ marginBottom: 16 }}>{t('users.title')}</Title2>

      <Card style={{ marginBottom: 16 }}>
        <Text size={300} block style={{ marginBottom: 12 }}>
          {t('common:requiresPermission')} <Text weight="semibold" font="monospace">{t('users.permission')}</Text>.
        </Text>
        <Text weight="semibold" block style={{ marginBottom: 8 }}>{t('common:plannedOperations')}</Text>
        <ul style={{ margin: 0, paddingLeft: 20, color: tokens.colorNeutralForeground2 }}>
          {operations.map(op => <li key={op} style={{ marginBottom: 4 }}>{op}</li>)}
        </ul>
      </Card>

      <Card style={{ marginBottom: 16 }}>
        <Text weight="semibold" size={400} block style={{ marginBottom: 4 }}>{t('users.mutate.title')}</Text>
        <Text size={300} block style={{ color: tokens.colorNeutralForeground2, marginBottom: 16 }}>
          {t('users.mutate.description', { attributes: attributeList })}
        </Text>

        <Button
          appearance="primary"
          icon={running ? <Spinner size="tiny" /> : <FlashRegular />}
          disabled={running}
          onClick={doItNow}
        >
          {running ? t('users.mutate.running') : t('users.mutate.doItNow')}
        </Button>

        {run && (
          <div style={{ marginTop: 20 }}>
            <Text block style={{ marginBottom: 8 }}>
              {t('users.mutate.chosenAttribute')} <Text weight="semibold" font="monospace">{run.attribute}</Text>
              {' '}({run.label})
            </Text>
            {run.results.map((r, i) => (
              <div key={`${r.item}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                {r.ok
                  ? <CheckmarkCircle20Filled style={{ color: tokens.colorPaletteGreenForeground1, flexShrink: 0 }} />
                  : <DismissCircle20Filled style={{ color: tokens.colorPaletteRedForeground1, flexShrink: 0 }} />}
                <Text size={300} style={{ fontFamily: 'var(--fontFamilyMonospace)' }}>{r.item}</Text>
                <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>→ {formatValue(r.value)}</Text>
                {!r.ok && r.error && (
                  <Text size={200} style={{ color: tokens.colorPaletteRedForeground1 }}>{r.error}</Text>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
