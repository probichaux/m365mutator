import { describe, it, expect, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp, getRunMode } from './main.js';
import { Scheduler } from './agent/scheduler.js';
import { sanitizeSchedule } from './agent/schedule-store.js';

let server: Server | undefined;

afterEach(() => {
  server?.close();
  server = undefined;
  delete process.env.M365MUTATOR_MODE;
});

async function listen(app: ReturnType<typeof createApp>): Promise<string> {
  server = app.listen(0);
  await new Promise(resolve => server!.once('listening', resolve));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

describe('getRunMode', () => {
  it('defaults to interactive and accepts agent', () => {
    expect(getRunMode()).toBe('interactive');
    process.env.M365MUTATOR_MODE = ' Agent ';
    expect(getRunMode()).toBe('agent');
    process.env.M365MUTATOR_MODE = 'robot';
    expect(getRunMode()).toBe('interactive');
  });
});

describe('agent mode app', () => {
  it('serves health and read-only status, and nothing else', async () => {
    const scheduler = new Scheduler({
      loadSchedule: () => ({ ...sanitizeSchedule({ enabled: false }), source: 'default' }),
      loadRuns: () => [],
      watch: false,
    });
    const base = await listen(createApp(scheduler));

    expect((await fetch(`${base}/health`)).status).toBe(200);
    const status = await fetch(`${base}/api/agent/status`);
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ mode: 'agent', enabled: false, state: 'idle' });

    for (const [method, path] of [['GET', '/api/config'], ['PUT', '/api/config'], ['POST', '/api/mail/mutate'], ['GET', '/']]) {
      expect((await fetch(`${base}${path}`, { method })).status, `${method} ${path}`).toBe(404);
    }
  });
});
