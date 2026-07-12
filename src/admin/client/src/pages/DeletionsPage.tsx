import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button, Card, Checkbox, Spinner, Text, Title2, Tooltip, tokens,
} from '@fluentui/react-components';
import {
  CheckmarkCircle20Filled, DismissCircle20Filled, DeleteRegular, WarningRegular,
} from '@fluentui/react-icons';
import { api } from '../api';
import { useToast } from '../components/ToastProvider';
import TargetPanel from '../components/TargetPanel';

type Workload = 'mail' | 'calendar' | 'onedrive';
type Scope = 'all' | 'after' | 'before' | 'between';

interface DeletionResult {
  item: string;
  workload: Workload;
  ok: boolean;
  matched: number;
  deleted: number;
  failed: number;
  error?: string;
}

interface DeletionRun {
  scope: Scope;
  workloads: Workload[];
  users: number;
  matched: number;
  deleted: number;
  failed: number;
  results: DeletionResult[];
  truncated: boolean;
  error?: string;
}

const WORKLOADS: { id: Workload; icon: string }[] = [
  { id: 'mail', icon: '/admin/icons/outlook.svg' },
  { id: 'calendar', icon: '/admin/icons/outlook-calendar.svg' },
  { id: 'onedrive', icon: '/admin/icons/onedrive.svg' },
];

const SCOPES: Scope[] = ['all', 'after', 'before', 'between'];

/** Today as YYYY-MM-DD, for sensible date-field defaults. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function prettyDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function DeletionsPage() {
  const { t } = useTranslation('pages');
  const showToast = useToast();

  const [selected, setSelected] = useState<Record<Workload, boolean>>({ mail: true, calendar: true, onedrive: false });
  const [scope, setScope] = useState<Scope>('all');
  const [after, setAfter] = useState(today());
  const [before, setBefore] = useState(today());
  const [ack, setAck] = useState(false);
  const [ready, setReady] = useState(false);
  const [running, setRunning] = useState(false);
  const [run, setRun] = useState<DeletionRun | null>(null);

  const workloads = WORKLOADS.filter(w => selected[w.id]).map(w => w.id);
  const needsAfter = scope === 'after' || scope === 'between';
  const needsBefore = scope === 'before' || scope === 'between';
  const datesValid =
    (!needsAfter || !!after) &&
    (!needsBefore || !!before) &&
    (scope !== 'between' || after <= before);
  const canRun = ready && ack && workloads.length > 0 && datesValid;

  const workloadNames = workloads.map(w => t(`deletions.workloadName.${w}`)).join(', ');

  const summary = (() => {
    const wl = workloads.length ? workloadNames : t('deletions.noWorkloads');
    if (scope === 'after') return t('deletions.summary.after', { date: prettyDate(after), workloads: wl });
    if (scope === 'before') return t('deletions.summary.before', { date: prettyDate(before), workloads: wl });
    if (scope === 'between') return t('deletions.summary.between', { from: prettyDate(after), to: prettyDate(before), workloads: wl });
    return t('deletions.summary.all', { workloads: wl });
  })();

  const doItNow = async () => {
    setRunning(true);
    setRun(null);
    const body = {
      workloads,
      scope,
      after: needsAfter ? after : undefined,
      before: needsBefore ? before : undefined,
    };
    const result = await api<DeletionRun>('POST', '/api/deletions/mutate', body);
    setRunning(false);

    if (result.status === 200 && result.data.results) {
      const d = result.data;
      setRun(d);
      if (d.matched === 0) {
        showToast(t('deletions.toastNone'), 'warning');
      } else if (d.failed === 0) {
        showToast(t('deletions.toastOk', { deleted: d.deleted, users: d.users }), 'success');
      } else {
        showToast(t('deletions.toastFailures', { deleted: d.deleted, failed: d.failed }), 'warning');
      }
    } else {
      showToast(result.data.error || t('deletions.toastFailed'), 'error');
    }
  };

  const cardStyle = { marginTop: 16 } as const;
  const titleBlock = (title: string, sub: string) => (
    <>
      <Text weight="semibold" size={400} block style={{ marginBottom: 4 }}>{title}</Text>
      <Text size={300} block style={{ color: tokens.colorNeutralForeground2, marginBottom: 16 }}>{sub}</Text>
    </>
  );

  const dateInputStyle: React.CSSProperties = {
    border: `1px solid ${tokens.colorNeutralStroke1}`, borderRadius: tokens.borderRadiusMedium,
    padding: '7px 10px', fontSize: 13, fontFamily: 'inherit', color: tokens.colorNeutralForeground1,
    background: tokens.colorNeutralBackground1,
  };

  return (
    <div>
      <Title2 block style={{ marginBottom: 6 }}>{t('deletions.title')}</Title2>
      <Text block style={{ color: tokens.colorNeutralForeground2, marginBottom: 16, maxWidth: '70ch', lineHeight: 1.5 }}>
        {t('deletions.lede')}
      </Text>

      {/* Users */}
      <TargetPanel category="deletions" onReadyChange={setReady} />

      {/* Workloads */}
      <Card style={cardStyle}>
        {titleBlock(t('deletions.workloads.title'), t('deletions.workloads.subtitle'))}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {WORKLOADS.map(w => {
            const on = selected[w.id];
            return (
              <label
                key={w.id}
                style={{
                  position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center',
                  border: `1px solid ${on ? tokens.colorBrandStroke1 : tokens.colorNeutralStroke2}`,
                  boxShadow: on ? `inset 0 0 0 1px ${tokens.colorBrandStroke1}` : 'none',
                  background: on ? tokens.colorBrandBackground2 : tokens.colorNeutralBackground1,
                  borderRadius: tokens.borderRadiusLarge, padding: 16, cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox" checked={on} disabled={running}
                  onChange={e => setSelected(s => ({ ...s, [w.id]: e.target.checked }))}
                  style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
                />
                {on && (
                  <CheckmarkCircle20Filled
                    style={{ position: 'absolute', top: 10, right: 10, color: tokens.colorBrandForeground1 }}
                  />
                )}
                <img src={w.icon} alt="" aria-hidden="true" style={{ height: 40, width: 'auto' }} />
                <Text weight="semibold" block style={{ marginTop: 8 }}>{t(`deletions.workloads.${w.id}`)}</Text>
                <Text size={200} block style={{ color: tokens.colorNeutralForeground3 }}>
                  {t(`deletions.workloads.${w.id}Sub`)}
                </Text>
              </label>
            );
          })}
        </div>
      </Card>

      {/* Scope */}
      <Card style={cardStyle}>
        {titleBlock(t('deletions.scope.title'), t('deletions.scope.subtitle'))}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
          {SCOPES.map(s => {
            const on = scope === s;
            return (
              <label
                key={s}
                style={{
                  display: 'flex', gap: 12, alignItems: 'flex-start',
                  border: `1px solid ${on ? tokens.colorBrandStroke1 : tokens.colorNeutralStroke2}`,
                  background: on ? tokens.colorBrandBackground2 : tokens.colorNeutralBackground1,
                  borderRadius: tokens.borderRadiusLarge, padding: '14px 16px', cursor: 'pointer',
                }}
              >
                <input
                  type="radio" name="deletion-scope" value={s} checked={on} disabled={running}
                  onChange={() => { setScope(s); setRun(null); }}
                  style={{ marginTop: 3, accentColor: tokens.colorBrandBackground }}
                />
                <span>
                  <Text weight="semibold" block>{t(`deletions.scope.${s}`)}</Text>
                  <Text size={200} block style={{ color: tokens.colorNeutralForeground2, marginTop: 2 }}>
                    {t(`deletions.scope.${s}Desc`)}
                  </Text>
                </span>
              </label>
            );
          })}
        </div>

        {scope !== 'all' && (
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', marginTop: 16, flexWrap: 'wrap' }}>
            {needsAfter && (
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <Text size={200} weight="semibold" style={{ color: tokens.colorNeutralForeground2 }}>
                  {t(scope === 'between' ? 'deletions.scope.fromLabel' : 'deletions.scope.afterLabel')}
                </Text>
                <input type="date" value={after} disabled={running}
                  onChange={e => { setAfter(e.target.value); setRun(null); }} style={dateInputStyle} />
              </label>
            )}
            {needsBefore && (
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <Text size={200} weight="semibold" style={{ color: tokens.colorNeutralForeground2 }}>
                  {t(scope === 'between' ? 'deletions.scope.toLabel' : 'deletions.scope.beforeLabel')}
                </Text>
                <input type="date" value={before} disabled={running}
                  onChange={e => { setBefore(e.target.value); setRun(null); }} style={dateInputStyle} />
              </label>
            )}
            {scope === 'between' && after > before && (
              <Text size={200} style={{ color: tokens.colorPaletteRedForeground1 }}>
                {t('deletions.scope.orderError')}
              </Text>
            )}
          </div>
        )}
      </Card>

      {/* Confirm & run */}
      <Card style={cardStyle}>
        <div style={{
          display: 'flex', gap: 12, alignItems: 'flex-start',
          border: `1px solid ${tokens.colorPaletteRedBorder1}`, background: tokens.colorPaletteRedBackground1,
          borderRadius: tokens.borderRadiusMedium, padding: '14px 16px',
        }}>
          <WarningRegular style={{ color: tokens.colorPaletteRedForeground1, fontSize: 20, flexShrink: 0 }} />
          <Text block style={{ lineHeight: 1.5 }}>{summary}</Text>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
          <Checkbox
            checked={ack} disabled={running}
            onChange={(_, d) => setAck(!!d.checked)}
            label={t('deletions.acknowledge')}
          />
          <div style={{ flex: 1 }} />
          <Tooltip content={t('deletions.needConfirm')} relationship="label" visible={canRun || running ? false : undefined}>
            <Button
              appearance="primary"
              icon={running ? <Spinner size="tiny" /> : <DeleteRegular />}
              disabled={running}
              disabledFocusable={!canRun}
              onClick={doItNow}
              style={canRun && !running ? {
                background: tokens.colorPaletteRedBackground3,
                borderColor: tokens.colorPaletteRedBackground3,
              } : undefined}
            >
              {running ? t('deletions.deleting') : t('deletions.deleteButton')}
            </Button>
          </Tooltip>
        </div>

        {run && (
          <div style={{ marginTop: 20 }}>
            <Text block weight="semibold" style={{ marginBottom: 8 }}>
              {t('deletions.runSummary', { deleted: run.deleted, matched: run.matched, users: run.users })}
            </Text>
            {run.results.map((r, i) => (
              <div key={`${r.item}-${r.workload}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                {r.ok
                  ? <CheckmarkCircle20Filled style={{ color: tokens.colorPaletteGreenForeground1, flexShrink: 0 }} />
                  : <DismissCircle20Filled style={{ color: tokens.colorPaletteRedForeground1, flexShrink: 0 }} />}
                <Text size={300} style={{ fontFamily: 'var(--fontFamilyMonospace)' }}>{r.item}</Text>
                <Text size={200} weight="semibold" style={{ color: tokens.colorBrandForeground1 }}>
                  {t(`deletions.workloadName.${r.workload}`)}
                </Text>
                {r.error
                  ? <Text size={200} style={{ color: tokens.colorPaletteRedForeground1 }}>{r.error}</Text>
                  : <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                      — {t('deletions.resultLine', { deleted: r.deleted, matched: r.matched })}
                    </Text>}
              </div>
            ))}
            {run.truncated && (
              <Text size={200} block style={{ color: tokens.colorNeutralForeground3, marginTop: 6 }}>
                {t('deletions.truncated', { shown: run.results.length, total: run.users * run.workloads.length })}
              </Text>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
