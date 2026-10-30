// Interactive-mode routes behind the Schedule page: edit schedule.json, preview
// its next runs, run one cycle now, and export the bundle a hosted agent needs.
// Agent mode never mounts these (plan Decision 2).

import { Router, Request, Response } from 'express';
import { logger } from '../logger/logger.js';
import { sanitizeUpstreamError } from '../admin/connectivity.js';
import { loadTargets } from '../admin/targets-store.js';
import { createZip } from '../helpers/zip.js';
import { Scheduler } from './scheduler.js';
import { loadScheduleFile, previewRuns, sanitizeSchedule, saveSchedule, Schedule } from './schedule-store.js';
import { CycleSummary } from './run-history.js';

export const BUNDLE_FILENAME = 'm365mutator-agent-bundle.zip';

const README = `M365Mutator agent bundle

Deploy either way:

1. Files: copy schedule.json and targets.json into the agent's data directory
   (M365MUTATOR_DATA_DIR, for example App Service mounted storage).
2. App settings: import app-settings.json in the Azure portal
   (Web App > Environment variables > Advanced edit). These settings take
   precedence over the files.

Either way, M365MUTATOR_MODE must be "agent".
`;

/** Build the agent bundle zip: the two data files, the same as App Service settings, and a readme. */
export function buildBundle(schedule: Schedule, now = new Date()): Buffer {
  const targets = loadTargets();
  const appSettings = [
    { name: 'M365MUTATOR_MODE', value: 'agent', slotSetting: false },
    { name: 'M365MUTATOR_SCHEDULE_JSON', value: JSON.stringify(schedule), slotSetting: false },
    { name: 'M365MUTATOR_TARGETS_JSON', value: JSON.stringify(targets), slotSetting: false },
  ];
  return createZip([
    { name: 'schedule.json', data: JSON.stringify(schedule, null, 2) },
    { name: 'targets.json', data: JSON.stringify(targets, null, 2) },
    { name: 'app-settings.json', data: JSON.stringify(appSettings, null, 2) },
    { name: 'README.txt', data: README },
  ], now);
}

/** Sanitize a posted schedule, or answer 400 with its errors and return null. */
function validSchedule(req: Request, res: Response): Schedule | null {
  const { schedule, errors } = sanitizeSchedule(req.body);
  if (errors.length > 0) {
    res.status(400).json({ error: errors.join('; '), errors });
    return null;
  }
  return schedule;
}

/** Scheduler factory, swappable in tests. */
export type CycleRunner = (schedule: Schedule) => Promise<CycleSummary>;

const defaultRunner: CycleRunner = schedule => new Scheduler({
  loadSchedule: () => ({ schedule, errors: [], source: 'file' }),
  // A local test run isn't agent history.
  appendRun: () => {},
  loadRuns: () => [],
  watch: false,
}).runNow();

export function createScheduleRouter(runCycle: CycleRunner = defaultRunner): Router {
  const router = Router();
  let running = false;

  router.get('/api/schedule', (_req: Request, res: Response) => {
    const loaded = loadScheduleFile();
    res.json({ ...loaded, envOverride: !!process.env.M365MUTATOR_SCHEDULE_JSON });
  });

  router.post('/api/schedule/validate', (req: Request, res: Response) => {
    const { schedule, errors } = sanitizeSchedule(req.body);
    res.json({ schedule, errors, nextRuns: errors.length === 0 ? previewRuns(schedule, Date.now()) : [] });
  });

  router.put('/api/schedule', (req: Request, res: Response) => {
    const { schedule, errors } = saveSchedule(req.body);
    if (errors.length > 0) {
      res.status(400).json({ error: errors.join('; '), errors });
      return;
    }
    res.json({ success: true, schedule });
  });

  router.post('/api/schedule/export', (req: Request, res: Response) => {
    const schedule = validSchedule(req, res);
    if (!schedule) return;
    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', `attachment; filename="${BUNDLE_FILENAME}"`);
    res.send(buildBundle(schedule));
  });

  router.post('/api/schedule/run-once', async (req: Request, res: Response) => {
    const schedule = validSchedule(req, res);
    if (!schedule) return;
    if (running) {
      res.status(409).json({ error: 'A test cycle is already running' });
      return;
    }
    running = true;
    try {
      res.json(await runCycle(schedule));
    } catch (err) {
      logger.warn('[SCHEDULE] Test cycle failed', err);
      res.status(502).json({ error: sanitizeUpstreamError(err) });
    } finally {
      running = false;
    }
  });

  return router;
}
