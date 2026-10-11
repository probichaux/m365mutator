import { describe, it, expect, vi } from 'vitest';

vi.mock('../graph/mail.js', () => ({
  sendMail: vi.fn(() => new Promise(r => setTimeout(r, 5))),
  sendMailWithAttachment: vi.fn().mockResolvedValue(undefined),
  replyToMail: vi.fn(() => new Promise(r => setTimeout(r, 5))),
  forwardMail: vi.fn(() => new Promise(r => setTimeout(r, 5))),
  moveMessage: vi.fn().mockResolvedValue(undefined),
  listInboxMessages: vi.fn().mockResolvedValue([{ id: 'm1', size: 1000 }]),
}));
vi.mock('./random-text.js', () => ({
  generateText: vi.fn().mockResolvedValue('text'),
  subjectPrompt: () => 's',
  bodyPrompt: () => 'b',
}));
const usage = vi.hoisted(() => ({ bytes: 0 }));
vi.mock('./seed-usage.js', () => ({
  bytesAddedToday: () => usage.bytes,
  recordBytesAdded: (b: number) => (usage.bytes += b),
  today: () => '2026-09-22',
}));

import { startMailJob, getMailJob, isMailJobActive, stopMailJob } from './mail-jobs.js';

const NO_CAP = { bodyKb: 0, attachmentMb: 0, dailyCapGb: 0 };
const waitForEnd = async () => {
  while (isMailJobActive()) await new Promise(r => setTimeout(r, 5));
  // Let the job's finally() run.
  await new Promise(r => setTimeout(r, 0));
};

describe('mail jobs', () => {
  it('returns immediately, then finishes in the background', async () => {
    const job = startMailJob(['a@x.com'], 10, false, NO_CAP, 'explicit', 0);
    expect(job.status).toBe('running');
    expect(job.planned).toBe(10);
    expect(isMailJobActive()).toBe(true);
    await waitForEnd();
    const done = getMailJob()!;
    expect(done.status).toBe('done');
    expect(done.completed).toBe(10);
    expect(done.ok).toBe(10);
    expect(done.recent.length).toBe(10);
    expect(done.finishedAt).toBeDefined();
  });

  it('stops early when asked', async () => {
    startMailJob(['a@x.com'], 999, false, NO_CAP, 'explicit', 0);
    await new Promise(r => setTimeout(r, 20));
    expect(stopMailJob()!.status).toBe('stopping');
    await waitForEnd();
    const stopped = getMailJob()!;
    expect(stopped.status).toBe('stopped');
    expect(stopped.completed).toBeLessThan(999);
    expect(stopped.skipped).toBe(999 - stopped.completed);
  });
});

describe('continuous mail jobs', () => {
  it('has no planned total, reports throttling, and stops on request', async () => {
    const job = startMailJob(['a@x.com'], 1, false, NO_CAP, 'explicit', 0, true);
    expect(job.continuous).toBe(true);
    expect(job.planned).toBeNull();
    await new Promise(r => setTimeout(r, 30));
    expect(getMailJob()!.throttle.events).toBe(0);
    stopMailJob();
    await waitForEnd();
    const done = getMailJob()!;
    expect(done.status).toBe('stopped');
    expect(done.stopReason).toBe('stopped');
    expect(done.completed).toBeGreaterThan(0);
  });
});
