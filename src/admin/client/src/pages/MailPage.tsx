import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button, Card, Field, MessageBar, MessageBarBody, ProgressBar, SpinButton, Spinner, Switch, Text, Title2,
  Tooltip, tokens,
} from '@fluentui/react-components';
import {
  CheckmarkCircle20Filled, DismissCircle20Filled, FlashRegular, StopRegular,
} from '@fluentui/react-icons';
import { api } from '../api';
import { useToast } from '../components/ToastProvider';
import TargetPanel from '../components/TargetPanel';
import RunStepper from '../components/RunStepper';

type MailOp = 'send' | 'reply' | 'forward' | 'move';
const MAX_RUNS = 999;
// Keep in sync with MAX_BODY_KB / MAX_ATTACHMENT_MB / MAX_DAILY_CAP_GB in mail-mutate.ts.
const MAX_BODY_KB = 2048;
const MAX_ATTACHMENT_MB = 25;
const MAX_DAILY_CAP_GB = 100;
const SIZE_STORAGE_KEY = 'm365mutator.mail.size';
const CONTINUOUS_STORAGE_KEY = 'm365mutator.mail.continuous';

interface SizeOptions {
  bodyKb: number;
  attachmentMb: number;
  dailyCapGb: number;
}

const DEFAULT_SIZE: SizeOptions = { bodyKb: 0, attachmentMb: 0, dailyCapGb: 1 };

// Remembered per browser as a convenience; the page works the same without it.
function loadSize(): SizeOptions {
  try {
    const saved = JSON.parse(localStorage.getItem(SIZE_STORAGE_KEY) ?? '{}') as Partial<SizeOptions>;
    return { ...DEFAULT_SIZE, ...saved };
  } catch {
    return DEFAULT_SIZE;
  }
}

function saveSize(size: SizeOptions): void {
  try {
    localStorage.setItem(SIZE_STORAGE_KEY, JSON.stringify(size));
  } catch {
    // Storage unavailable (private window, blocked site data); nothing to do.
  }
}

const formatGb = (bytes: number) => (bytes / 1024 ** 3).toFixed(2);

function loadContinuous(): boolean {
  try {
    return localStorage.getItem(CONTINUOUS_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function saveContinuous(value: boolean): void {
  try {
    localStorage.setItem(CONTINUOUS_STORAGE_KEY, String(value));
  } catch {
    // Storage unavailable; the switch just won't be remembered.
  }
}

/** "2 h 05 min", "12 min", or "40 s". */
function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`;
  if (m > 0) return `${m} min`;
  return `${totalSec} s`;
}

const formatTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

interface MailResult {
  item: string;
  op: MailOp;
  ok: boolean;
  detail?: string;
  error?: string;
}

type MailJobStatus = 'running' | 'paused' | 'stopping' | 'done' | 'stopped' | 'error';

interface MailJobThrottle {
  events: number;
  tooMany: number;
  busy: number;
  waitSeconds: number;
  lastAt?: string;
  recentEvents: number;
}

// Mirrors MailJob in src/admin/mail-jobs.ts.
interface MailJob {
  id: string;
  status: MailJobStatus;
  continuous: boolean;
  startedAt: string;
  finishedAt?: string;
  resumeAt?: string;
  stopReason?: 'completed' | 'cap' | 'stopped' | 'failures';
  throttle: MailJobThrottle;
  runs: number;
  planned: number | null;
  completed: number;
  ok: number;
  failed: number;
  skipped: number;
  bytesAdded: number;
  bytesToday: number;
  recent: MailResult[];
  error?: string;
}

const POLL_MS = 2000;
const isActive = (job: MailJob | null) =>
  job?.status === 'running' || job?.status === 'paused' || job?.status === 'stopping';

export default function MailPage() {
  const { t } = useTranslation('targets');
  const { t: tp } = useTranslation('pages');
  const showToast = useToast();

  const [starting, setStarting] = useState(false);
  const [runs, setRuns] = useState(1);
  const [allowDeletions, setAllowDeletions] = useState(false);
  const [continuous, setContinuous] = useState(loadContinuous);
  const [job, setJob] = useState<MailJob | null>(null);
  const [ready, setReady] = useState(false);
  // The job id this page started or found running, so finishing it raises a toast once.
  const watchedJob = useRef<string | null>(null);
  const running = starting || isActive(job);
  const [size, setSize] = useState<SizeOptions>(loadSize);
  const [bytesToday, setBytesToday] = useState<number | null>(null);

  const announceFinish = useCallback((j: MailJob) => {
    const args = { runs: j.runs, total: j.completed, ok: j.ok, failed: j.failed };
    if (j.status === 'error') showToast(j.error || tp('mail.mutate.toastFailed'), 'error');
    else if (j.stopReason === 'failures') showToast(tp('mail.mutate.job.toastFailures', args), 'error');
    else if (j.status === 'stopped') showToast(tp('mail.mutate.job.toastStopped', args), 'info');
    else showToast(
      j.failed === 0 ? tp('mail.mutate.toastOk', args) : tp('mail.mutate.toastFailures', args),
      j.failed === 0 ? 'success' : 'warning',
    );
  }, [showToast, tp]);

  const applyJob = useCallback((j: MailJob | null) => {
    setJob(j);
    if (!j) return;
    setBytesToday(j.bytesToday);
    if (isActive(j)) {
      watchedJob.current = j.id;
    } else if (watchedJob.current === j.id) {
      watchedJob.current = null;
      announceFinish(j);
    }
  }, [announceFinish]);

  // On load, pick up today's total and any run that is still going (or just ended).
  useEffect(() => {
    api<{ bytesToday: number }>('GET', '/api/mail/usage').then(r => {
      if (r.status === 200) setBytesToday(r.data.bytesToday);
    });
    api<{ job: MailJob | null }>('GET', '/api/mail/job').then(r => {
      if (r.status === 200) applyJob(r.data.job);
    });
  }, [applyJob]);

  // Poll while a run is active; stops when the job finishes or the page unmounts.
  const active = isActive(job);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(async () => {
      const r = await api<{ job: MailJob | null }>('GET', '/api/mail/job');
      if (r.status === 200) applyJob(r.data.job);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [active, applyJob]);

  const updateSize = (key: keyof SizeOptions, max: number) =>
    (_: unknown, d: { value?: number | null; displayValue?: string }) => {
      const raw = d.value ?? (d.displayValue !== undefined ? Number(d.displayValue) : NaN);
      if (!Number.isFinite(raw)) return;
      const next = { ...size, [key]: Math.min(max, Math.max(0, raw)) };
      setSize(next);
      saveSize(next);
    };

  const doItNow = async () => {
    setStarting(true);
    const result = await api<{ job?: MailJob; error?: string }>(
      'POST', '/api/mail/mutate', { runs, allowDeletions, continuous, ...size },
    );
    setStarting(false);

    if (result.status === 202 && result.data.job) {
      applyJob(result.data.job);
    } else if (result.status === 409 && result.data.job) {
      showToast(tp('mail.mutate.job.alreadyRunning'), 'warning');
      applyJob(result.data.job);
    } else {
      showToast(result.data.error || tp('mail.mutate.toastFailed'), 'error');
    }
  };

  const stopRun = async () => {
    const result = await api<{ job: MailJob | null }>('POST', '/api/mail/job/stop');
    if (result.status === 200) applyJob(result.data.job);
  };

  return (
    <div>
      <Title2 block style={{ marginBottom: 16 }}>{t('categories.mail.label')}</Title2>

      <TargetPanel category="mail" onReadyChange={setReady} />

      <Card style={{ marginTop: 16 }}>
        <Text weight="semibold" size={400} block style={{ marginBottom: 4 }}>{tp('mail.mutate.title')}</Text>
        <Text size={300} block style={{ color: tokens.colorNeutralForeground2, marginBottom: 16 }}>
          {tp('mail.mutate.description', {
            send: allowDeletions ? 30 : 35,
            deletions: allowDeletions ? tp('mail.mutate.deletionsClause') : '',
          })}
        </Text>

        <div style={{ marginBottom: 12 }}>
          <Switch
            checked={allowDeletions}
            disabled={running}
            onChange={(_, d) => setAllowDeletions(d.checked)}
            label={tp('mail.mutate.allowDeletions')}
          />
          <Switch
            checked={continuous}
            disabled={running}
            onChange={(_, d) => { setContinuous(d.checked); saveContinuous(d.checked); }}
            label={tp('mail.mutate.job.continuous')}
          />
          {continuous && (
            <Text size={200} block style={{ color: tokens.colorNeutralForeground3, marginTop: 4 }}>
              {tp('mail.mutate.job.continuousHint')}
            </Text>
          )}
        </div>

        <Text weight="semibold" size={300} block style={{ marginBottom: 4 }}>{tp('mail.mutate.size.title')}</Text>
        <Text size={200} block style={{ color: tokens.colorNeutralForeground3, marginBottom: 8 }}>
          {tp('mail.mutate.size.description')}
        </Text>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 8 }}>
          <Field label={tp('mail.mutate.size.bodyKb')} hint={tp('mail.mutate.size.bodyKbHint')} style={{ width: 200 }}>
            <SpinButton
              value={size.bodyKb} min={0} max={MAX_BODY_KB} step={64}
              disabled={running} onChange={updateSize('bodyKb', MAX_BODY_KB)}
            />
          </Field>
          <Field label={tp('mail.mutate.size.attachmentMb')} hint={tp('mail.mutate.size.attachmentMbHint')} style={{ width: 200 }}>
            <SpinButton
              value={size.attachmentMb} min={0} max={MAX_ATTACHMENT_MB} step={1}
              disabled={running} onChange={updateSize('attachmentMb', MAX_ATTACHMENT_MB)}
            />
          </Field>
          <Field label={tp('mail.mutate.size.dailyCapGb')} hint={tp('mail.mutate.size.dailyCapGbHint')} style={{ width: 200 }}>
            <SpinButton
              value={size.dailyCapGb} min={0} max={MAX_DAILY_CAP_GB} step={0.5} precision={1}
              disabled={running} onChange={updateSize('dailyCapGb', MAX_DAILY_CAP_GB)}
            />
          </Field>
        </div>
        {bytesToday !== null && (
          <Text size={200} block style={{ color: tokens.colorNeutralForeground2, marginBottom: 16 }}>
            {size.dailyCapGb > 0
              ? tp('mail.mutate.size.today', { used: formatGb(bytesToday), cap: size.dailyCapGb })
              : tp('mail.mutate.size.todayNoCap', { used: formatGb(bytesToday) })}
          </Text>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <RunStepper
            value={runs}
            onChange={setRuns}
            min={1}
            max={MAX_RUNS}
            disabled={running || continuous}
            ariaLabel={tp('mail.mutate.runsLabel')}
          />
          <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>{tp('mail.mutate.runsSuffix')}</Text>
          <Tooltip content={tp('run.needTargets')} relationship="label" visible={ready ? false : undefined}>
            <Button
              appearance="primary"
              icon={running ? <Spinner size="tiny" /> : <FlashRegular />}
              disabled={running}
              disabledFocusable={!ready}
              onClick={doItNow}
            >
              {running
                ? tp('mail.mutate.running')
                : continuous
                  ? tp('mail.mutate.job.startContinuous')
                  : tp('mail.mutate.doItNow') + (runs > 1 ? ` · ${runs}×` : '')}
            </Button>
          </Tooltip>
          {active && (
            <Button icon={<StopRegular />} disabled={job?.status === 'stopping'} onClick={stopRun}>
              {job?.status === 'stopping' ? tp('mail.mutate.job.stopping') : tp('mail.mutate.job.stop')}
            </Button>
          )}
        </div>

        {job && active && (
          <div style={{ marginTop: 16 }}>
            <ProgressBar
              value={job.planned ? job.completed / job.planned : undefined}
              thickness="large"
              color={job.status === 'paused' ? 'warning' : 'brand'}
            />
            <Text size={200} block style={{ color: tokens.colorNeutralForeground2, marginTop: 6 }}>
              {job.planned
                ? tp('mail.mutate.job.progress', {
                  completed: job.completed, planned: job.planned, ok: job.ok, failed: job.failed,
                  added: formatGb(job.bytesAdded),
                })
                : tp('mail.mutate.job.progressContinuous', {
                  completed: job.completed, ok: job.ok, failed: job.failed, added: formatGb(job.bytesAdded),
                  elapsed: formatDuration(Date.now() - Date.parse(job.startedAt)),
                })}
            </Text>
            {job.status === 'paused' && job.resumeAt && (
              <Text size={200} block style={{ color: tokens.colorPaletteMarigoldForeground2 }}>
                {tp('mail.mutate.job.paused', { time: formatTime(job.resumeAt) })}
              </Text>
            )}
            <Text size={200} block style={{ color: tokens.colorNeutralForeground3 }}>
              {tp('mail.mutate.job.leaveHint')}
            </Text>
          </div>
        )}

        {job && (
          <div style={{ marginTop: 12 }}>
            {active && job.throttle.recentEvents > 0 && (
              <MessageBar intent="warning" style={{ marginBottom: 6 }}>
                <MessageBarBody>{tp('mail.mutate.job.throttledNow', { count: job.throttle.recentEvents })}</MessageBarBody>
              </MessageBar>
            )}
            <Text size={200} block style={{ color: tokens.colorNeutralForeground2 }}>
              {job.throttle.events === 0
                ? tp('mail.mutate.job.throttleNone')
                : tp('mail.mutate.job.throttleSummary', {
                  events: job.throttle.events, tooMany: job.throttle.tooMany, busy: job.throttle.busy,
                  wait: formatDuration(job.throttle.waitSeconds * 1000),
                  time: job.throttle.lastAt ? formatTime(job.throttle.lastAt) : '',
                })}
            </Text>
          </div>
        )}

        {job && (
          <div style={{ marginTop: 20 }}>
            {!active && (
              <>
                <Text block weight="semibold" style={{ marginBottom: 8 }}>
                  {job.continuous
                    ? tp('mail.mutate.job.summaryContinuous', {
                      total: job.completed, ok: job.ok, failed: job.failed,
                      elapsed: formatDuration(Date.parse(job.finishedAt ?? job.startedAt) - Date.parse(job.startedAt)),
                    })
                    : tp('mail.mutate.summary', { runs: job.runs, total: job.completed, ok: job.ok, failed: job.failed })}
                </Text>
                <Text size={200} block style={{ color: tokens.colorNeutralForeground2, marginBottom: 8 }}>
                  {tp('mail.mutate.size.added', { added: formatGb(job.bytesAdded), today: formatGb(job.bytesToday) })}
                  {job.skipped > 0 && ` ${job.status === 'stopped'
                    ? tp('mail.mutate.job.stoppedNote', { skipped: job.skipped })
                    : tp('mail.mutate.size.capReached', { skipped: job.skipped })}`}
                  {job.stopReason === 'failures' && ` ${tp('mail.mutate.job.failuresNote', { error: job.error ?? '' })}`}
                  {job.status === 'error' && job.error && ` ${job.error}`}
                </Text>
              </>
            )}
            {job.recent.slice().reverse().map((r, i) => (
              <div key={`${r.item}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                {r.ok
                  ? <CheckmarkCircle20Filled style={{ color: tokens.colorPaletteGreenForeground1, flexShrink: 0 }} />
                  : <DismissCircle20Filled style={{ color: tokens.colorPaletteRedForeground1, flexShrink: 0 }} />}
                <Text size={300} style={{ fontFamily: 'var(--fontFamilyMonospace)' }}>{r.item}</Text>
                <Text size={200} weight="semibold" style={{ color: tokens.colorBrandForeground1 }}>
                  {tp(`mail.mutate.op.${r.op}`)}
                </Text>
                {r.ok && r.detail && (
                  <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>— {r.detail}</Text>
                )}
                {!r.ok && r.error && (
                  <Text size={200} style={{ color: tokens.colorPaletteRedForeground1 }}>{r.error}</Text>
                )}
              </div>
            ))}
            {job.completed > job.recent.length && (
              <Text size={200} block style={{ color: tokens.colorNeutralForeground3, marginTop: 6 }}>
                {tp('mail.mutate.job.recentNote', { shown: job.recent.length, total: job.completed })}
              </Text>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
