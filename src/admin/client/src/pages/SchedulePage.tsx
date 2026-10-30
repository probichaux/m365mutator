import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Badge, Button, Card, Checkbox, Combobox, Dropdown, Field, Input, MessageBar, MessageBarBody,
  MessageBarTitle, Option, Spinner, SpinButton, Switch, Text, Title2, ToggleButton, Tooltip, tokens,
} from '@fluentui/react-components';
import {
  ArrowDownloadRegular, CheckmarkCircle20Filled, DismissCircle20Filled, FlashRegular, SaveRegular,
  Warning20Filled,
} from '@fluentui/react-icons';
import { api } from '../api';
import { useToast } from '../components/ToastProvider';
import RunStepper from '../components/RunStepper';

// Mirrors src/agent/schedule-store.ts; the server sanitizes whatever we send.
type Credential = 'app' | 'agent';
type Weekday = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';
type DeletionWorkload = 'mail' | 'calendar' | 'onedrive';
type DeletionScope = 'all' | 'after' | 'before' | 'between';
type ScheduledWorkload = 'mail' | 'calendar' | 'onedrive' | 'sharepoint' | 'deletions';
type RunWorkload = 'mail' | 'calendar' | 'onedrive' | 'sharepoint';

interface ActiveWindow {
  timeZone: string;
  days: Weekday[];
  start: string;
  end: string;
}

interface Schedule {
  version: 1;
  enabled: boolean;
  intervalMinutes: number;
  jitterMinutes: number;
  runOnStart: boolean;
  activeWindow?: ActiveWindow;
  workloads: {
    mail: { enabled: boolean; runs: number; allowDeletions: boolean };
    calendar: { enabled: boolean; runs: number };
    onedrive: { enabled: boolean; runs: number };
    sharepoint: { enabled: boolean; runs: number };
    identities: { enabled: boolean };
    deletions: {
      enabled: boolean;
      workloads: DeletionWorkload[];
      scope: DeletionScope;
      after?: string;
      before?: string;
      acknowledgeDestructive: boolean;
    };
  };
  credentials: Record<ScheduledWorkload, Credential>;
}

interface LoadedSchedule {
  schedule: Schedule;
  errors: string[];
  source: 'file' | 'default';
  envOverride: boolean;
}

interface WorkloadSummary {
  workload: ScheduledWorkload;
  credential: Credential;
  ok: number;
  failed: number;
  durationMs: number;
  error?: string;
}

interface CycleSummary {
  startedAt: string;
  endedAt: string;
  status: 'ok' | 'partial' | 'failed' | 'blocked';
  workloads: WorkloadSummary[];
  error?: string;
}

const WEEKDAYS: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const RUN_WORKLOADS: RunWorkload[] = ['mail', 'calendar', 'onedrive', 'sharepoint'];
const DELETION_WORKLOADS: DeletionWorkload[] = ['mail', 'calendar', 'onedrive'];
const DELETION_SCOPES: DeletionScope[] = ['all', 'after', 'before', 'between'];
const CREDENTIALS: Credential[] = ['app', 'agent'];
const MIN_INTERVAL = 5;
const MAX_INTERVAL = 10080;
const MAX_RUNS = 100;
const ICONS: Partial<Record<ScheduledWorkload, string>> = {
  mail: '/admin/icons/outlook.svg',
  calendar: '/admin/icons/outlook-calendar.svg',
  onedrive: '/admin/icons/onedrive.svg',
};

function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/** Intl.supportedValuesOf is ES2022; fall back to the browser's own zone. */
function allTimeZones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  return intl.supportedValuesOf?.('timeZone') ?? [browserTimeZone()];
}

function defaultWindow(): ActiveWindow {
  return { timeZone: browserTimeZone(), days: ['mon', 'tue', 'wed', 'thu', 'fri'], start: '08:00', end: '18:00' };
}

/** SpinButton reports either a stepped value or the typed text. */
function spinValue(data: { value?: number | null; displayValue?: string }): number | null {
  if (typeof data.value === 'number') return data.value;
  const n = parseInt(data.displayValue ?? '', 10);
  return Number.isNaN(n) ? null : n;
}

export default function SchedulePage() {
  const { t, i18n } = useTranslation('schedule');
  const { t: tn } = useTranslation('nav');
  const { t: tp } = useTranslation('pages');
  const showToast = useToast();

  const [draft, setDraft] = useState<Schedule | null>(null);
  const [saved, setSaved] = useState('');
  const [envOverride, setEnvOverride] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [nextRuns, setNextRuns] = useState<string[]>([]);
  const [busy, setBusy] = useState<'save' | 'export' | 'run' | null>(null);
  const [cycle, setCycle] = useState<CycleSummary | null>(null);
  const [tzQuery, setTzQuery] = useState<string | null>(null);
  const validateSeq = useRef(0);

  useEffect(() => {
    api<LoadedSchedule>('GET', '/api/schedule').then(r => {
      if (r.status !== 200) {
        showToast(t('toast.loadFailed'), 'error');
        return;
      }
      setDraft(r.data.schedule);
      setSaved(JSON.stringify(r.data.schedule));
      setEnvOverride(r.data.envOverride);
    });
  }, [showToast, t]);

  // Validate as the user edits; only the newest response counts.
  useEffect(() => {
    if (!draft) return;
    const seq = ++validateSeq.current;
    const timer = setTimeout(async () => {
      const r = await api<{ errors: string[]; nextRuns: string[] }>('POST', '/api/schedule/validate', draft);
      if (seq !== validateSeq.current || r.status !== 200) return;
      setErrors(r.data.errors);
      setNextRuns(r.data.nextRuns);
    }, 300);
    return () => clearTimeout(timer);
  }, [draft]);

  const timeZones = useMemo(allTimeZones, []);
  const dayNames = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(i18n.language, { weekday: 'short', timeZone: 'UTC' });
    // 2026-11-01 is a Sunday.
    return WEEKDAYS.map((_, i) => fmt.format(Date.UTC(2026, 10, 1 + i)));
  }, [i18n.language]);

  if (!draft) return <Spinner label={t('loading')} />;

  const dirty = JSON.stringify(draft) !== saved;
  const valid = errors.length === 0;
  const w = draft.workloads;
  const del = w.deletions;
  const update = (fn: (s: Schedule) => Schedule) => { setDraft(s => (s ? fn(s) : s)); setCycle(null); };
  const setWorkload = <K extends keyof Schedule['workloads']>(k: K, patch: Partial<Schedule['workloads'][K]>) =>
    update(s => ({ ...s, workloads: { ...s.workloads, [k]: { ...s.workloads[k], ...patch } } }));
  const setCredential = (k: ScheduledWorkload, c: Credential) =>
    update(s => ({ ...s, credentials: { ...s.credentials, [k]: c } }));
  const setWindow = (patch: Partial<ActiveWindow>) =>
    update(s => ({ ...s, activeWindow: { ...(s.activeWindow ?? defaultWindow()), ...patch } }));

  const enabledWorkloads = (Object.keys(draft.credentials) as ScheduledWorkload[]).filter(k => w[k].enabled);
  const agentWrites = enabledWorkloads.some(k => draft.credentials[k] === 'agent');
  const nothingEnabled = enabledWorkloads.length === 0;
  const runTz = draft.activeWindow?.timeZone ?? browserTimeZone();
  const formatRun = (iso: string) => new Date(iso).toLocaleString(i18n.language, {
    weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: runTz,
  });
  const tzOptions = timeZones
    .filter(z => !tzQuery || z.toLowerCase().includes(tzQuery.toLowerCase()))
    .slice(0, 100);

  const save = async () => {
    setBusy('save');
    const r = await api<{ schedule: Schedule; error?: string }>('PUT', '/api/schedule', draft);
    setBusy(null);
    if (r.status === 200) {
      setDraft(r.data.schedule);
      setSaved(JSON.stringify(r.data.schedule));
      showToast(t('toast.saved'), 'success');
    } else {
      showToast(r.data.error || t('toast.saveFailed'), 'error');
    }
  };

  const exportBundle = async () => {
    setBusy('export');
    try {
      const res = await fetch('/api/schedule/export', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        showToast(body.error || t('toast.exportFailed'), 'error');
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = 'm365mutator-agent-bundle.zip';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      showToast(t('toast.exportFailed'), 'error');
    } finally {
      setBusy(null);
    }
  };

  const runOnce = async () => {
    setBusy('run');
    setCycle(null);
    const r = await api<CycleSummary & { error?: string }>('POST', '/api/schedule/run-once', draft);
    setBusy(null);
    if (r.status === 200 && r.data.status) {
      setCycle(r.data);
      showToast(t(`cycle.status.${r.data.status}`), r.data.status === 'ok' ? 'success' : r.data.status === 'partial' ? 'warning' : 'error');
    } else {
      showToast(r.data.error || t('toast.runFailed'), 'error');
    }
  };

  const cardStyle = { marginTop: 16 } as const;
  const titleBlock = (title: string, sub: string) => (
    <>
      <Text weight="semibold" size={400} block style={{ marginBottom: 4 }}>{title}</Text>
      <Text size={300} block style={{ color: tokens.colorNeutralForeground2, marginBottom: 16 }}>{sub}</Text>
    </>
  );
  const rowStyle: React.CSSProperties = {
    display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) auto 200px', alignItems: 'center', gap: 16,
    padding: '10px 0', borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  };
  const workloadLabel = (k: ScheduledWorkload | 'identities') => (
    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {ICONS[k as ScheduledWorkload] && <img src={ICONS[k as ScheduledWorkload]} alt="" aria-hidden="true" style={{ height: 20 }} />}
      <Text weight="semibold">{tn(k)}</Text>
    </span>
  );
  const credentialPicker = (k: ScheduledWorkload) => (
    <Dropdown
      aria-label={t('workloads.credentialLabel', { workload: tn(k) })}
      value={t(`credential.${draft.credentials[k]}`)}
      selectedOptions={[draft.credentials[k]]}
      disabled={!w[k].enabled}
      onOptionSelect={(_, d) => d.optionValue && setCredential(k, d.optionValue as Credential)}
      style={{ minWidth: 0 }}
    >
      {CREDENTIALS.map(c => <Option key={c} value={c}>{t(`credential.${c}`)}</Option>)}
    </Dropdown>
  );

  return (
    <div>
      <Title2 block style={{ marginBottom: 6 }}>{t('title')}</Title2>
      <Text block style={{ color: tokens.colorNeutralForeground2, marginBottom: 16, maxWidth: '70ch', lineHeight: 1.5 }}>
        {t('lede')}
      </Text>

      {envOverride && (
        <MessageBar intent="warning" style={{ marginBottom: 16 }}>
          <MessageBarBody>{t('envOverride')}</MessageBarBody>
        </MessageBar>
      )}

      {/* Timing */}
      <Card>
        {titleBlock(t('timing.title'), t('timing.subtitle'))}
        <Switch
          checked={draft.enabled}
          onChange={(_, d) => update(s => ({ ...s, enabled: d.checked }))}
          label={draft.enabled ? t('timing.enabled') : t('timing.disabled')}
        />
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 12 }}>
          <Field label={t('timing.interval')} hint={t('timing.intervalHint', { min: MIN_INTERVAL, max: MAX_INTERVAL })}>
            <SpinButton
              value={draft.intervalMinutes} min={MIN_INTERVAL} max={MAX_INTERVAL} step={5}
              onChange={(_, d) => {
                const v = spinValue(d);
                if (v !== null) update(s => ({ ...s, intervalMinutes: v, jitterMinutes: Math.min(s.jitterMinutes, Math.floor(v / 2)) }));
              }}
            />
          </Field>
          <Field label={t('timing.jitter')} hint={t('timing.jitterHint', { max: Math.floor(draft.intervalMinutes / 2) })}>
            <SpinButton
              value={draft.jitterMinutes} min={0} max={Math.floor(draft.intervalMinutes / 2)}
              onChange={(_, d) => {
                const v = spinValue(d);
                if (v !== null) update(s => ({ ...s, jitterMinutes: v }));
              }}
            />
          </Field>
        </div>
        <div style={{ marginTop: 12 }}>
          <Switch
            checked={draft.runOnStart}
            onChange={(_, d) => update(s => ({ ...s, runOnStart: d.checked }))}
            label={t('timing.runOnStart')}
          />
        </div>

        <div style={{ marginTop: 20, paddingTop: 16, borderTop: `1px solid ${tokens.colorNeutralStroke2}` }}>
          <Switch
            checked={!!draft.activeWindow}
            onChange={(_, d) => update(s => ({ ...s, activeWindow: d.checked ? defaultWindow() : undefined }))}
            label={t('window.toggle')}
          />
          {draft.activeWindow && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }} role="group" aria-label={t('window.days')}>
                {WEEKDAYS.map((d, i) => (
                  <ToggleButton
                    key={d} size="small"
                    checked={draft.activeWindow!.days.includes(d)}
                    appearance={draft.activeWindow!.days.includes(d) ? 'primary' : 'secondary'}
                    onClick={() => {
                      const days = draft.activeWindow!.days;
                      setWindow({ days: days.includes(d) ? days.filter(x => x !== d) : WEEKDAYS.filter(x => x === d || days.includes(x)) });
                    }}
                  >
                    {dayNames[i]}
                  </ToggleButton>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <Field label={t('window.start')}>
                  <Input type="time" value={draft.activeWindow.start} onChange={(_, d) => setWindow({ start: d.value })} />
                </Field>
                <Field label={t('window.end')} hint={t('window.endHint')}>
                  <Input type="time" value={draft.activeWindow.end} onChange={(_, d) => setWindow({ end: d.value })} />
                </Field>
                <Field label={t('window.timeZone')} style={{ minWidth: 260 }}>
                  <Combobox
                    freeform
                    value={tzQuery ?? draft.activeWindow.timeZone}
                    selectedOptions={[draft.activeWindow.timeZone]}
                    onChange={e => setTzQuery(e.target.value)}
                    onOptionSelect={(_, d) => {
                      if (d.optionValue) setWindow({ timeZone: d.optionValue });
                      setTzQuery(null);
                    }}
                    onBlur={() => setTzQuery(null)}
                  >
                    {tzOptions.map(z => <Option key={z} value={z}>{z}</Option>)}
                  </Combobox>
                </Field>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Workloads */}
      <Card style={cardStyle}>
        {titleBlock(t('workloads.title'), t('workloads.subtitle'))}
        <div style={{ ...rowStyle, borderTop: 'none', paddingTop: 0 }}>
          <Text size={200} weight="semibold" style={{ color: tokens.colorNeutralForeground3 }}>{t('workloads.colWorkload')}</Text>
          <Text size={200} weight="semibold" style={{ color: tokens.colorNeutralForeground3 }}>{t('workloads.colRuns')}</Text>
          <Text size={200} weight="semibold" style={{ color: tokens.colorNeutralForeground3 }}>{t('workloads.colCredential')}</Text>
        </div>

        {RUN_WORKLOADS.map(k => (
          <div key={k} style={rowStyle}>
            <div>
              <Switch
                checked={w[k].enabled}
                onChange={(_, d) => setWorkload(k, { enabled: d.checked })}
                label={workloadLabel(k)}
              />
              {k === 'mail' && w.mail.enabled && (
                <div style={{ marginLeft: 40 }}>
                  <Checkbox
                    checked={w.mail.allowDeletions}
                    onChange={(_, d) => setWorkload('mail', { allowDeletions: !!d.checked })}
                    label={tp('mail.mutate.allowDeletions')}
                  />
                </div>
              )}
            </div>
            <RunStepper
              value={w[k].runs} min={1} max={MAX_RUNS} disabled={!w[k].enabled}
              onChange={runs => setWorkload(k, { runs })}
              ariaLabel={t('workloads.runsLabel', { workload: tn(k) })}
            />
            {credentialPicker(k)}
          </div>
        ))}

        <div style={rowStyle}>
          <Tooltip content={t('workloads.identitiesBlocked')} relationship="description">
            <Switch checked={false} disabled label={workloadLabel('identities')} />
          </Tooltip>
          <Text size={200} style={{ color: tokens.colorNeutralForeground3, gridColumn: 'span 2' }}>
            {t('workloads.identitiesBlocked')}
          </Text>
        </div>

        {/* Deletions */}
        <div style={{ ...rowStyle, alignItems: 'start' }}>
          <Switch
            checked={del.enabled}
            // Start a new recurring Deletions with a relative date rather than an empty one.
            onChange={(_, d) => setWorkload('deletions', d.checked && !del.after && !del.before
              ? { enabled: true, before: '-30d' }
              : { enabled: d.checked })}
            label={workloadLabel('deletions')}
          />
          <div />
          {credentialPicker('deletions')}
          {del.enabled && (
            <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 12, marginLeft: 40 }}>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }} role="group" aria-label={t('deletions.workloads')}>
                {DELETION_WORKLOADS.map(x => (
                  <Checkbox
                    key={x}
                    checked={del.workloads.includes(x)}
                    label={tp(`deletions.workloads.${x}`)}
                    onChange={(_, d) => setWorkload('deletions', {
                      workloads: DELETION_WORKLOADS.filter(y => (y === x ? !!d.checked : del.workloads.includes(y))),
                    })}
                  />
                ))}
              </div>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <Field label={t('deletions.scope')}>
                  <Dropdown
                    value={tp(`deletions.scope.${del.scope}`)}
                    selectedOptions={[del.scope]}
                    onOptionSelect={(_, d) => d.optionValue && setWorkload('deletions', { scope: d.optionValue as DeletionScope })}
                  >
                    {DELETION_SCOPES.map(s => <Option key={s} value={s}>{tp(`deletions.scope.${s}`)}</Option>)}
                  </Dropdown>
                </Field>
                {(del.scope === 'after' || del.scope === 'between') && (
                  <Field label={tp(del.scope === 'between' ? 'deletions.scope.fromLabel' : 'deletions.scope.afterLabel')} hint={t('deletions.dateHint')}>
                    <Input value={del.after ?? ''} placeholder="-30d" onChange={(_, d) => setWorkload('deletions', { after: d.value || undefined })} />
                  </Field>
                )}
                {(del.scope === 'before' || del.scope === 'between') && (
                  <Field label={tp(del.scope === 'between' ? 'deletions.scope.toLabel' : 'deletions.scope.beforeLabel')} hint={t('deletions.dateHint')}>
                    <Input value={del.before ?? ''} placeholder="-30d" onChange={(_, d) => setWorkload('deletions', { before: d.value || undefined })} />
                  </Field>
                )}
              </div>
              <MessageBar intent="error">
                <MessageBarBody>
                  <Checkbox
                    checked={del.acknowledgeDestructive}
                    onChange={(_, d) => setWorkload('deletions', { acknowledgeDestructive: !!d.checked })}
                    label={t('deletions.acknowledge')}
                  />
                </MessageBarBody>
              </MessageBar>
            </div>
          )}
        </div>

        {agentWrites && (
          <MessageBar intent="warning" style={{ marginTop: 12 }}>
            <MessageBarBody>
              <MessageBarTitle>{t('workloads.agentWarningTitle')}</MessageBarTitle>
              {t('workloads.agentWarning')}
            </MessageBarBody>
          </MessageBar>
        )}
        <Text size={200} block style={{ color: tokens.colorNeutralForeground3, marginTop: 12 }}>
          {t('workloads.targetsNote')}
        </Text>
      </Card>

      {/* Check, save, export, test */}
      <Card style={cardStyle}>
        {titleBlock(t('review.title'), t('review.subtitle'))}

        {!valid ? (
          <MessageBar intent="error">
            <MessageBarBody>
              <MessageBarTitle>{t('review.errorsTitle')}</MessageBarTitle>
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {errors.map(e => <li key={e}>{e}</li>)}
              </ul>
            </MessageBarBody>
          </MessageBar>
        ) : !draft.enabled ? (
          <Text block style={{ color: tokens.colorNeutralForeground2 }}>{t('review.disabled')}</Text>
        ) : (
          <div>
            <Text weight="semibold" block style={{ marginBottom: 4 }}>
              {t('review.nextRuns', { timeZone: runTz })}
            </Text>
            {nextRuns.map(r => (
              <Text key={r} block size={300} style={{ fontFamily: 'var(--fontFamilyMonospace)' }}>{formatRun(r)}</Text>
            ))}
            {draft.jitterMinutes > 0 && (
              <Text size={200} block style={{ color: tokens.colorNeutralForeground3, marginTop: 4 }}>
                {t('review.jitterNote', { jitter: draft.jitterMinutes })}
              </Text>
            )}
            {nothingEnabled && (
              <Text size={200} block style={{ color: tokens.colorPaletteMarigoldForeground1, marginTop: 4 }}>
                {t('review.nothingEnabled')}
              </Text>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
          <Button appearance="primary" icon={busy === 'save' ? <Spinner size="tiny" /> : <SaveRegular />}
            disabled={!dirty || !valid || busy !== null} onClick={save}>
            {dirty ? t('actions.save') : t('actions.saved')}
          </Button>
          <Tooltip content={t('actions.exportHint')} relationship="description">
            <Button icon={busy === 'export' ? <Spinner size="tiny" /> : <ArrowDownloadRegular />}
              disabled={!valid || busy !== null} onClick={exportBundle}>
              {t('actions.export')}
            </Button>
          </Tooltip>
          <Tooltip content={t('actions.runOnceHint')} relationship="description">
            <Button icon={busy === 'run' ? <Spinner size="tiny" /> : <FlashRegular />}
              disabled={!valid || nothingEnabled || busy !== null} onClick={runOnce}>
              {busy === 'run' ? t('actions.running') : t('actions.runOnce')}
            </Button>
          </Tooltip>
        </div>

        {cycle && (
          <div style={{ marginTop: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Badge appearance="filled"
                color={cycle.status === 'ok' ? 'success' : cycle.status === 'partial' ? 'warning' : 'danger'}>
                {t(`cycle.badge.${cycle.status}`)}
              </Badge>
              <Text weight="semibold">{t(`cycle.status.${cycle.status}`)}</Text>
            </div>
            {cycle.error && (
              <Text block size={200} style={{ color: tokens.colorPaletteRedForeground1 }}>{cycle.error}</Text>
            )}
            {cycle.workloads.map(r => (
              <div key={r.workload} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                {r.error
                  ? <DismissCircle20Filled style={{ color: tokens.colorPaletteRedForeground1, flexShrink: 0 }} />
                  : r.failed > 0
                    ? <Warning20Filled style={{ color: tokens.colorPaletteMarigoldForeground1, flexShrink: 0 }} />
                    : <CheckmarkCircle20Filled style={{ color: tokens.colorPaletteGreenForeground1, flexShrink: 0 }} />}
                <Text weight="semibold">{tn(r.workload)}</Text>
                <Text size={200} style={{ color: tokens.colorBrandForeground1 }}>{t(`credential.${r.credential}`)}</Text>
                {r.error
                  ? <Text size={200} style={{ color: tokens.colorPaletteRedForeground1 }}>{r.error}</Text>
                  : <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                      — {t('cycle.line', { ok: r.ok, failed: r.failed, seconds: (r.durationMs / 1000).toFixed(1) })}
                    </Text>}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
