import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { createScheduleRouter, CycleRunner } from './schedule-routes.js';
import { CycleSummary } from './run-history.js';

const GOOD = { enabled: true, intervalMinutes: 30, workloads: { mail: { enabled: true, runs: 2 } } };
const BAD = { enabled: true, workloads: { identities: { enabled: true } } };
const CYCLE: CycleSummary = { startedAt: 'a', endedAt: 'b', status: 'ok', workloads: [] };

let dir: string;
let server: Server;
let base: string;
let runner: ReturnType<typeof vi.fn<CycleRunner>>;

async function call(method: string, path: string, body?: unknown) {
  return fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Names and contents of a zip's entries, read through the central directory. */
function unzip(zip: Buffer): Record<string, string> {
  const end = zip.length - 22;
  let p = zip.readUInt32LE(end + 16);
  const out: Record<string, string> = {};
  for (let i = 0; i < zip.readUInt16LE(end + 10); i++) {
    const size = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const local = zip.readUInt32LE(p + 42);
    const start = local + 30 + zip.readUInt16LE(local + 26);
    out[zip.subarray(p + 46, p + 46 + nameLen).toString()] = inflateRawSync(zip.subarray(start, start + size)).toString();
    p += 46 + nameLen;
  }
  return out;
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'schedule-routes-'));
  process.env.M365MUTATOR_DATA_DIR = dir;
  runner = vi.fn<CycleRunner>(async () => CYCLE);
  const app = express();
  app.use(express.json());
  app.use(createScheduleRouter(runner));
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.M365MUTATOR_DATA_DIR;
  delete process.env.M365MUTATOR_SCHEDULE_JSON;
});

describe('schedule routes', () => {
  it('returns the default schedule when none is saved, and flags an app-setting override', async () => {
    process.env.M365MUTATOR_SCHEDULE_JSON = '{"enabled":true}';
    const body = await (await call('GET', '/api/schedule')).json();
    // The page edits the file, so the app setting is reported but not loaded.
    expect(body).toMatchObject({ source: 'default', errors: [], envOverride: true, schedule: { enabled: false } });
  });

  it('validates without saving and previews the next runs', async () => {
    const res = await (await call('POST', '/api/schedule/validate', GOOD)).json();
    expect(res.errors).toEqual([]);
    expect(res.nextRuns).toHaveLength(5);
    expect(Date.parse(res.nextRuns[1]) - Date.parse(res.nextRuns[0])).toBe(30 * 60_000);
    expect(existsSync(join(dir, 'schedule.json'))).toBe(false);

    const bad = await (await call('POST', '/api/schedule/validate', BAD)).json();
    expect(bad.errors).toEqual([expect.stringContaining('Identities')]);
    expect(bad.nextRuns).toEqual([]);
  });

  it('saves a valid schedule and refuses one with errors', async () => {
    expect((await call('PUT', '/api/schedule', BAD)).status).toBe(400);
    expect(existsSync(join(dir, 'schedule.json'))).toBe(false);

    const res = await call('PUT', '/api/schedule', GOOD);
    expect(res.status).toBe(200);
    const saved = JSON.parse(readFileSync(join(dir, 'schedule.json'), 'utf-8'));
    expect(saved).toMatchObject({ version: 1, enabled: true, intervalMinutes: 30 });
    expect(await (await call('GET', '/api/schedule')).json()).toMatchObject({ source: 'file', schedule: saved });
  });

  it('exports a bundle with the schedule, targets and App Service settings', async () => {
    writeFileSync(join(dir, 'targets.json'), JSON.stringify({ mail: { enabled: true, items: ['a@contoso.com'] } }));
    const res = await call('POST', '/api/schedule/export', GOOD);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toContain('m365mutator-agent-bundle.zip');

    const files = unzip(Buffer.from(await res.arrayBuffer()));
    expect(Object.keys(files)).toEqual(['schedule.json', 'targets.json', 'app-settings.json', 'README.txt']);
    expect(JSON.parse(files['schedule.json'])).toMatchObject({ intervalMinutes: 30 });
    expect(JSON.parse(files['targets.json']).mail.items).toEqual(['a@contoso.com']);
    const settings = JSON.parse(files['app-settings.json']) as { name: string; value: string }[];
    expect(settings.map(s => s.name)).toEqual(['M365MUTATOR_MODE', 'M365MUTATOR_SCHEDULE_JSON', 'M365MUTATOR_TARGETS_JSON']);
    expect(JSON.parse(settings[1].value)).toEqual(JSON.parse(files['schedule.json']));

    expect((await call('POST', '/api/schedule/export', BAD)).status).toBe(400);
  });

  it('runs one cycle with the posted schedule, one at a time', async () => {
    let release!: () => void;
    runner.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve(CYCLE); }));
    const first = call('POST', '/api/schedule/run-once', GOOD);
    await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(1));
    expect((await call('POST', '/api/schedule/run-once', GOOD)).status).toBe(409);
    release();
    expect(await (await first).json()).toEqual(CYCLE);
    expect(runner.mock.calls[0][0]).toMatchObject({ intervalMinutes: 30, workloads: { mail: { runs: 2 } } });

    expect((await call('POST', '/api/schedule/run-once', BAD)).status).toBe(400);
    expect(runner).toHaveBeenCalledTimes(1);
  });
});
