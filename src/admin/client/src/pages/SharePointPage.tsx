import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button, Card, Spinner, Text, Title2, Tooltip, tokens,
} from '@fluentui/react-components';
import {
  CheckmarkCircle20Filled, DismissCircle20Filled, FlashRegular,
} from '@fluentui/react-icons';
import { api } from '../api';
import { useToast } from '../components/ToastProvider';
import TargetPanel from '../components/TargetPanel';
import RunStepper from '../components/RunStepper';

type SharePointOp = 'createText' | 'createDoc' | 'rename' | 'createFolder' | 'remove' | 'folderMove' | 'image';
const MAX_RUNS = 999;

interface SharePointResult {
  item: string;
  op: SharePointOp;
  ok: boolean;
  detail?: string;
  error?: string;
}

interface SharePointRun {
  runs: number;
  totalActions: number;
  ok: number;
  failed: number;
  results: SharePointResult[];
  truncated: boolean;
  error?: string;
}

export default function SharePointPage() {
  const { t } = useTranslation('targets');
  const { t: tp } = useTranslation('pages');
  const showToast = useToast();

  const [running, setRunning] = useState(false);
  const [runs, setRuns] = useState(1);
  const [run, setRun] = useState<SharePointRun | null>(null);
  const [ready, setReady] = useState(false);

  const doItNow = async () => {
    setRunning(true);
    setRun(null);
    const result = await api<SharePointRun>('POST', '/api/sharepoint/mutate', { runs });
    setRunning(false);

    if (result.status === 200 && result.data.results) {
      const d = result.data;
      setRun(d);
      const args = { runs: d.runs, total: d.totalActions, ok: d.ok, failed: d.failed };
      showToast(
        d.failed === 0 ? tp('sharepoint.mutate.toastOk', args) : tp('sharepoint.mutate.toastFailures', args),
        d.failed === 0 ? 'success' : 'warning',
      );
    } else {
      showToast(result.data.error || tp('sharepoint.mutate.toastFailed'), 'error');
    }
  };

  return (
    <div>
      <Title2 block style={{ marginBottom: 16 }}>{t('categories.sharepoint.label')}</Title2>

      <TargetPanel category="sharepoint" onReadyChange={setReady} />

      <Card style={{ marginTop: 16 }}>
        <Text weight="semibold" size={400} block style={{ marginBottom: 4 }}>{tp('sharepoint.mutate.title')}</Text>
        <Text size={300} block style={{ color: tokens.colorNeutralForeground2, marginBottom: 16 }}>
          {tp('sharepoint.mutate.description')}
        </Text>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <RunStepper
            value={runs}
            onChange={setRuns}
            min={1}
            max={MAX_RUNS}
            disabled={running}
            ariaLabel={tp('sharepoint.mutate.runsLabel')}
          />
          <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>{tp('sharepoint.mutate.runsSuffix')}</Text>
          <Tooltip content={tp('run.needTargets')} relationship="label" visible={ready ? false : undefined}>
            <Button
              appearance="primary"
              icon={running ? <Spinner size="tiny" /> : <FlashRegular />}
              disabled={running}
              disabledFocusable={!ready}
              onClick={doItNow}
            >
              {running
                ? tp('sharepoint.mutate.running')
                : tp('sharepoint.mutate.doItNow') + (runs > 1 ? ` · ${runs}×` : '')}
            </Button>
          </Tooltip>
        </div>

        {run && (
          <div style={{ marginTop: 20 }}>
            <Text block weight="semibold" style={{ marginBottom: 8 }}>
              {tp('sharepoint.mutate.summary', { runs: run.runs, total: run.totalActions, ok: run.ok, failed: run.failed })}
            </Text>
            {run.results.map((r, i) => (
              <div key={`${r.item}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                {r.ok
                  ? <CheckmarkCircle20Filled style={{ color: tokens.colorPaletteGreenForeground1, flexShrink: 0 }} />
                  : <DismissCircle20Filled style={{ color: tokens.colorPaletteRedForeground1, flexShrink: 0 }} />}
                <Text size={300} style={{ fontFamily: 'var(--fontFamilyMonospace)' }}>{r.item}</Text>
                <Text size={200} weight="semibold" style={{ color: tokens.colorBrandForeground1 }}>
                  {tp(`sharepoint.mutate.op.${r.op}`)}
                </Text>
                {r.ok && r.detail && (
                  <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>— {r.detail}</Text>
                )}
                {!r.ok && r.error && (
                  <Text size={200} style={{ color: tokens.colorPaletteRedForeground1 }}>{r.error}</Text>
                )}
              </div>
            ))}
            {run.truncated && (
              <Text size={200} block style={{ color: tokens.colorNeutralForeground3, marginTop: 6 }}>
                {tp('sharepoint.mutate.truncated', { shown: run.results.length, total: run.totalActions })}
              </Text>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
