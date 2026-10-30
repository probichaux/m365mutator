import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Scheduler, SchedulerDeps } from './scheduler.js';
import { sanitizeSchedule, LoadedSchedule } from './schedule-store.js';
import { WorkloadInputError } from '../admin/workload-runner.js';

const MIN = 60_000;
const T0 = Date.parse('2026-10-30T12:00:00Z');
const OK_RUN = { runs: 1, totalActions: 2, ok: 2, failed: 0, results: [], truncated: false, runStyle: 'explicit', pool: 2 };

function loaded(raw: unknown): LoadedSchedule {
  return { ...sanitizeSchedule(raw), source: 'file' };
}

const SCHEDULE = {
  enabled: true,
  intervalMinutes: 60,
  workloads: { mail: { enabled: true, runs: 2 }, onedrive: { enabled: true, runs: 1 } },
  credentials: { onedrive: 'agent' },
};

let deps: SchedulerDeps;
let scheduler: Scheduler;

function make(raw: unknown = SCHEDULE, overrides: Partial<SchedulerDeps> = {}): Scheduler {
  deps = {
    loadSchedule: vi.fn(() => loaded(raw)),
    runWorkload: vi.fn(async () => OK_RUN as never),
    checkToken: vi.fn(async () => {}),
    appendRun: vi.fn(),
    loadRuns: () => [],
    now: Date.now,
    random: () => 0.5,
    watch: false,
    ...overrides,
  };
  scheduler = new Scheduler(deps);
  return scheduler;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(async () => {
  // Real timers first, so stop()'s drain timeout can fire if a cycle is left pending.
  vi.useRealTimers();
  await scheduler?.stop(0);
});

describe('Scheduler', () => {
  it('does nothing for a disabled schedule', async () => {
    make({ ...SCHEDULE, enabled: false }).start();
    await vi.advanceTimersByTimeAsync(10 * 60 * MIN);
    expect(deps.runWorkload).not.toHaveBeenCalled();
    expect(scheduler.status()).toMatchObject({ state: 'idle', nextRunAt: null, enabled: false });
  });

  it('refuses a schedule with errors and reports them', async () => {
    make({ ...SCHEDULE, workloads: { identities: { enabled: true } } }).start();
    await vi.advanceTimersByTimeAsync(2 * 60 * MIN);
    expect(deps.runWorkload).not.toHaveBeenCalled();
    expect(scheduler.status().errors).toEqual([expect.stringContaining('Identities')]);
  });

  it('runs enabled workloads in order with their credentials each interval', async () => {
    make().start();
    expect(scheduler.status()).toMatchObject({ state: 'waiting', nextRunAt: new Date(T0 + 60 * MIN).toISOString() });
    await vi.advanceTimersByTimeAsync(60 * MIN);
    expect(vi.mocked(deps.checkToken).mock.calls).toEqual([['agent'], ['app']]);
    expect(vi.mocked(deps.runWorkload).mock.calls).toEqual([
      [{ workload: 'mail', runs: 2, allowDeletions: false }, { credential: 'app', directoryCredential: 'agent' }],
      [{ workload: 'onedrive', runs: 1 }, { credential: 'agent', directoryCredential: 'agent' }],
    ]);
    expect(deps.appendRun).toHaveBeenCalledWith(expect.objectContaining({
      status: 'ok',
      workloads: [
        expect.objectContaining({ workload: 'mail', credential: 'app', ok: 2, failed: 0 }),
        expect.objectContaining({ workload: 'onedrive', credential: 'agent', ok: 2, failed: 0 }),
      ],
    }));
    expect(scheduler.status().nextRunAt).toBe(new Date(T0 + 120 * MIN).toISOString());
    await vi.advanceTimersByTimeAsync(60 * MIN);
    expect(deps.runWorkload).toHaveBeenCalledTimes(4);
  });

  it('runs immediately with runOnStart', async () => {
    make({ ...SCHEDULE, runOnStart: true }).start();
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.runWorkload).toHaveBeenCalledTimes(2);
  });

  it('keeps going when one workload fails', async () => {
    make(SCHEDULE, {
      runWorkload: vi.fn()
        .mockRejectedValueOnce(new WorkloadInputError('No mailboxes are selected'))
        .mockResolvedValueOnce(OK_RUN as never),
    }).start();
    await vi.advanceTimersByTimeAsync(60 * MIN);
    expect(deps.runWorkload).toHaveBeenCalledTimes(2);
    expect(scheduler.status().lastCycle).toMatchObject({
      status: 'partial',
      workloads: [{ workload: 'mail', error: 'No mailboxes are selected' }, { workload: 'onedrive', ok: 2 }],
    });
  });

  it('marks the cycle failed when every workload fails, with sanitized errors', async () => {
    make(SCHEDULE, { runWorkload: vi.fn().mockRejectedValue(new Error('401 Bearer abc.def.ghi')) }).start();
    await vi.advanceTimersByTimeAsync(60 * MIN);
    const last = scheduler.status().lastCycle!;
    expect(last.status).toBe('failed');
    expect(last.workloads[0].error).toBe('401 Bearer [REDACTED]');
  });

  it('skips a cycle that comes due while the previous one is still running', async () => {
    let release!: () => void;
    make({ ...SCHEDULE, workloads: { mail: { enabled: true } } }, {
      runWorkload: vi.fn(() => new Promise<never>(resolve => { release = () => resolve(OK_RUN as never); })),
    }).start();
    await vi.advanceTimersByTimeAsync(60 * MIN);
    expect(scheduler.status().state).toBe('running');
    await vi.advanceTimersByTimeAsync(60 * MIN);
    expect(deps.runWorkload).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(60 * MIN);
    expect(deps.runWorkload).toHaveBeenCalledTimes(2);
  });

  it('backs off exponentially, capped at the interval, when the agent token fails', async () => {
    make({ ...SCHEDULE, intervalMinutes: 5 }, {
      checkToken: vi.fn().mockRejectedValue(new Error('AADSTS7000112: Application is disabled.')),
    }).start();
    const backoffs: number[] = [];
    await vi.advanceTimersByTimeAsync(5 * MIN);
    for (let i = 0; i < 4; i++) {
      backoffs.push(scheduler.status().backoffMinutes);
      await vi.advanceTimersByTimeAsync(scheduler.status().backoffMinutes * MIN);
    }
    expect(backoffs).toEqual([1, 2, 4, 5]);
    expect(deps.runWorkload).not.toHaveBeenCalled();
    expect(scheduler.status()).toMatchObject({
      tokenHealth: { agent: { ok: false, error: 'AADSTS7000112: Application is disabled.' } },
      lastCycle: { status: 'blocked', workloads: [] },
    });
  });

  it('recovers normal cadence once the token works again', async () => {
    make(SCHEDULE, {
      checkToken: vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue(undefined),
    }).start();
    await vi.advanceTimersByTimeAsync(60 * MIN);
    await vi.advanceTimersByTimeAsync(1 * MIN);
    expect(deps.runWorkload).toHaveBeenCalledTimes(2);
    expect(scheduler.status()).toMatchObject({ backoffMinutes: 0, tokenHealth: { agent: { ok: true }, app: { ok: true } } });
  });

  it('skips app-credential workloads when the app token fails, and still runs agent ones', async () => {
    make(SCHEDULE, {
      checkToken: vi.fn(async (kind: string) => {
        if (kind === 'app') throw new Error('AADSTS7000215: Invalid client secret provided.');
      }),
    }).start();
    await vi.advanceTimersByTimeAsync(60 * MIN);
    expect(vi.mocked(deps.runWorkload).mock.calls.map(c => c[0].workload)).toEqual(['onedrive']);
    expect(scheduler.status()).toMatchObject({
      tokenHealth: { agent: { ok: true }, app: { ok: false, error: 'AADSTS7000215: Invalid client secret provided.' } },
      lastCycle: {
        status: 'partial',
        workloads: [
          { workload: 'mail', error: 'App registration token failed: AADSTS7000215: Invalid client secret provided.' },
          { workload: 'onedrive', ok: 2 },
        ],
      },
    });
  });

  it('does not check the app token when every workload uses the agent', async () => {
    make({ ...SCHEDULE, credentials: { mail: 'agent', onedrive: 'agent' } }).start();
    await vi.advanceTimersByTimeAsync(60 * MIN);
    expect(vi.mocked(deps.checkToken).mock.calls).toEqual([['agent']]);
    expect(scheduler.status().tokenHealth).toEqual({ agent: expect.objectContaining({ ok: true }) });
  });

  it('re-arms on reload when the schedule changes', async () => {
    make().start();
    vi.mocked(deps.loadSchedule).mockReturnValue(loaded({ ...SCHEDULE, intervalMinutes: 15 }));
    await vi.advanceTimersByTimeAsync(5 * MIN);
    scheduler.reload();
    expect(scheduler.status().nextRunAt).toBe(new Date(T0 + 20 * MIN).toISOString());
  });

  it('waits for the running cycle on stop, then arms nothing', async () => {
    let release!: () => void;
    make({ ...SCHEDULE, workloads: { mail: { enabled: true } } }, {
      runWorkload: vi.fn(() => new Promise<never>(resolve => { release = () => resolve(OK_RUN as never); })),
    }).start();
    await vi.advanceTimersByTimeAsync(60 * MIN);
    let stopped = false;
    const stopping = scheduler.stop(60_000).then(() => { stopped = true; });
    await vi.advanceTimersByTimeAsync(1000);
    expect(stopped).toBe(false);
    release();
    await stopping;
    expect(scheduler.status()).toMatchObject({ state: 'stopped', nextRunAt: null });
    expect(deps.appendRun).toHaveBeenCalledTimes(1);
  });
});
