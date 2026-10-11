import { describe, it, expect, vi } from 'vitest';

// Mock the Graph + text layers so mutateMail can run without a tenant.
vi.mock('../graph/mail.js', () => ({
  sendMail: vi.fn().mockResolvedValue(undefined),
  sendMailWithAttachment: vi.fn().mockResolvedValue(undefined),
  replyToMail: vi.fn().mockResolvedValue(undefined),
  forwardMail: vi.fn().mockResolvedValue(undefined),
  moveMessage: vi.fn().mockResolvedValue(undefined),
  listInboxMessages: vi.fn().mockResolvedValue([{ id: 'm1', size: 1000, hasAttachments: false }]),
}));
// Keep daily usage in memory instead of the data directory.
const usage = vi.hoisted(() => ({ bytes: 0 }));
vi.mock('./seed-usage.js', () => ({
  bytesAddedToday: () => usage.bytes,
  recordBytesAdded: (b: number) => (usage.bytes += b),
  today: () => '2026-09-22',
}));
vi.mock('./random-text.js', () => ({
  generateText: vi.fn().mockResolvedValue('text'),
  subjectPrompt: () => 's',
  bodyPrompt: () => 'b',
}));

import { beforeEach } from 'vitest';
import {
  pickMailOp, mutateMail, normalizeSizeOptions, isReplyable, MailOp, MAX_CONSECUTIVE_FAILURES,
} from './mail-mutate.js';
import { sendMail, sendMailWithAttachment, replyToMail, listInboxMessages } from '../graph/mail.js';

beforeEach(() => {
  usage.bytes = 0;
  vi.mocked(sendMail).mockReset().mockResolvedValue(undefined);
  vi.mocked(sendMailWithAttachment).mockClear();
});

describe('pickMailOp (deletions allowed)', () => {
  const pick = (r: number) => pickMailOp(true, () => r);
  it('maps the random range to the weighted operations', () => {
    expect(pick(0)).toBe('send');
    expect(pick(0.299)).toBe('send');    // < 30
    expect(pick(0.30)).toBe('reply');    // 30 → reply band
    expect(pick(0.649)).toBe('reply');   // < 65
    expect(pick(0.65)).toBe('forward');  // 65 → forward band
    expect(pick(0.949)).toBe('forward'); // < 95
    expect(pick(0.95)).toBe('move');     // 95 → move band
    expect(pick(0.999)).toBe('move');
  });

  it('matches the configured weights over an even sweep', () => {
    const counts: Record<MailOp, number> = { send: 0, reply: 0, forward: 0, move: 0 };
    const n = 20000;
    for (let i = 0; i < n; i++) counts[pickMailOp(true, () => i / n)]++;
    expect(counts.send / n).toBeCloseTo(0.30, 2);
    expect(counts.reply / n).toBeCloseTo(0.35, 2);
    expect(counts.forward / n).toBeCloseTo(0.30, 2);
    expect(counts.move / n).toBeCloseTo(0.05, 2);
  });
});

describe('pickMailOp (deletions disabled)', () => {
  const pick = (r: number) => pickMailOp(false, () => r);
  it('never returns move; the new-message band widens to 35%', () => {
    expect(pick(0)).toBe('send');
    expect(pick(0.349)).toBe('send');    // < 35
    expect(pick(0.35)).toBe('reply');    // 35 → reply band
    expect(pick(0.699)).toBe('reply');   // < 70
    expect(pick(0.70)).toBe('forward');  // 70 → forward band
    expect(pick(0.999)).toBe('forward'); // move is never reached
  });

  it('redistributes the move share to send (send 35, move 0)', () => {
    const counts: Record<MailOp, number> = { send: 0, reply: 0, forward: 0, move: 0 };
    const n = 20000;
    for (let i = 0; i < n; i++) counts[pickMailOp(false, () => i / n)]++;
    expect(counts.move).toBe(0);
    expect(counts.send / n).toBeCloseTo(0.35, 2);
    expect(counts.reply / n).toBeCloseTo(0.35, 2);
    expect(counts.forward / n).toBeCloseTo(0.30, 2);
  });
});

describe('mutateMail runs', () => {
  it('performs runs × mailboxes actions', async () => {
    const run = await mutateMail(['a@x.com', 'b@x.com'], 3);
    expect(run.runs).toBe(3);
    expect(run.totalActions).toBe(6);
    expect(run.ok).toBe(6);
    expect(run.failed).toBe(0);
    expect(run.truncated).toBe(false);
  });

  it('defaults to a single pass', async () => {
    const run = await mutateMail(['a@x.com', 'b@x.com']);
    expect(run.runs).toBe(1);
    expect(run.totalActions).toBe(2);
  });

  it('clamps runs to [1, 999] and caps the returned sample', async () => {
    expect((await mutateMail(['a@x.com'], 0)).runs).toBe(1);
    const big = await mutateMail(['a@x.com'], 5000);
    expect(big.runs).toBe(999);
    expect(big.totalActions).toBe(999);
    expect(big.results.length).toBe(500);
    expect(big.truncated).toBe(true);
  });

  it('never moves a message to Deleted Items when deletions are disabled', async () => {
    const run = await mutateMail(['a@x.com', 'b@x.com'], 50, false);
    expect(run.results.every(r => r.op !== 'move')).toBe(true);
  });
});

const NO_CAP = { bodyKb: 0, attachmentMb: 0, dailyCapGb: 0 };

describe('normalizeSizeOptions', () => {
  it('clamps to the allowed ranges and falls back to defaults', () => {
    expect(normalizeSizeOptions({})).toEqual({ bodyKb: 0, attachmentMb: 0, dailyCapGb: 1 });
    expect(normalizeSizeOptions({ bodyKb: 99999, attachmentMb: 500, dailyCapGb: 1000 }))
      .toEqual({ bodyKb: 2048, attachmentMb: 25, dailyCapGb: 100 });
    expect(normalizeSizeOptions({ bodyKb: -5, attachmentMb: 'x', dailyCapGb: 0 }))
      .toEqual({ bodyKb: 0, attachmentMb: 0, dailyCapGb: 0 });
  });
});

describe('mutateMail sizing', () => {
  it('attaches a file of the requested size to new messages', async () => {
    const run = await mutateMail(['a@x.com'], 20, false, { ...NO_CAP, attachmentMb: 1 });
    const sends = run.results.filter(r => r.op === 'send');
    expect(sends.length).toBeGreaterThan(0);
    expect(vi.mocked(sendMail)).not.toHaveBeenCalled();
    const [, , attachment] = vi.mocked(sendMailWithAttachment).mock.calls[0];
    expect(attachment.bytes.length).toBe(1024 * 1024);
    // Stored twice: Sent Items plus the Inbox.
    expect(sends[0].bytes).toBeGreaterThan(2 * 1024 * 1024);
  });

  it('builds bodies of the requested size', async () => {
    await mutateMail(['a@x.com'], 30, false, { ...NO_CAP, bodyKb: 64 });
    const [, message] = vi.mocked(sendMail).mock.calls[0];
    expect(message.body.content.length).toBe(64 * 1024);
  });

  it('stops scheduling actions once the daily cap is reached', async () => {
    usage.bytes = 1024 ** 3; // already at 1 GB today
    const run = await mutateMail(['a@x.com'], 10, false, { ...NO_CAP, dailyCapGb: 1 });
    expect(run.totalActions).toBe(0);
    expect(run.skipped).toBe(10);
    expect(run.bytesAdded).toBe(0);
  });

  it('counts estimated bytes toward today', async () => {
    const run = await mutateMail(['a@x.com'], 5, false, NO_CAP);
    expect(run.bytesAdded).toBeGreaterThan(0);
    expect(run.bytesToday).toBe(usage.bytes);
    expect(run.skipped).toBe(0);
  });
});

describe('isReplyable', () => {
  it('accepts ordinary mail and rejects meeting requests and reports', () => {
    expect(isReplyable({ id: '1', messageClass: 'IPM.Note' })).toBe(true);
    expect(isReplyable({ id: '2', messageClass: 'IPM.Note.SMIME' })).toBe(true);
    expect(isReplyable({ id: '3' })).toBe(true); // class unknown: keep it
    expect(isReplyable({ id: '4', messageClass: 'IPM.Schedule.Meeting.Request' })).toBe(false);
    expect(isReplyable({ id: '5', messageClass: 'REPORT.IPM.Note.NDR' })).toBe(false);
    expect(isReplyable({ id: '6', messageClass: 'IPM.NoteX' })).toBe(false);
  });
});

describe('mutateMail hooks', () => {
  it('never replies to or forwards an item that cannot take a reply', async () => {
    vi.mocked(listInboxMessages).mockResolvedValue([{ id: 'meeting', messageClass: 'IPM.Schedule.Meeting.Request' }]);
    vi.mocked(replyToMail).mockClear();
    const run = await mutateMail(['a@x.com'], 30, false, NO_CAP);
    expect(vi.mocked(replyToMail)).not.toHaveBeenCalled();
    // With nothing replyable, every reply or forward falls back to a new message.
    expect(run.results.every(r => r.op === 'send')).toBe(true);
    vi.mocked(listInboxMessages).mockResolvedValue([{ id: 'm1', size: 1000, hasAttachments: false }]);
  });

  it('reports each finished action through onResult', async () => {
    const seen: number[] = [];
    await mutateMail(['a@x.com'], 7, false, NO_CAP, { onResult: (_r, today) => seen.push(today) });
    expect(seen.length).toBe(7);
    expect(seen.at(-1)).toBe(usage.bytes);
  });

  it('stops scheduling new actions once shouldStop returns true', async () => {
    let finished = 0;
    const run = await mutateMail(['a@x.com'], 50, false, NO_CAP, {
      onResult: () => { finished++; },
      shouldStop: () => finished >= 3,
    });
    // In-flight actions may finish after the stop, but no new ones start.
    expect(run.totalActions).toBeLessThan(50);
    expect(run.totalActions).toBeGreaterThanOrEqual(3);
    expect(run.skipped).toBe(50 - run.totalActions);
  });
});

describe('mutateMail continuous mode', () => {
  it('keeps going past the pass limit until asked to stop', async () => {
    let finished = 0;
    const run = await mutateMail(['a@x.com'], 1, false, NO_CAP, {
      onResult: () => { finished++; },
      shouldStop: () => finished >= 1200, // more than MAX_RUNS × 1 mailbox
    }, { continuous: true });
    expect(run.continuous).toBe(true);
    expect(run.stopReason).toBe('stopped');
    expect(run.totalActions).toBeGreaterThanOrEqual(1200);
    expect(run.skipped).toBe(0);
  });

  it('ends after too many failures in a row', async () => {
    vi.mocked(sendMail).mockRejectedValue(Object.assign(new Error('MailboxFull'), { statusCode: 507 }));
    vi.mocked(listInboxMessages).mockResolvedValue([]); // every action falls back to a send
    const run = await mutateMail(['a@x.com'], 1, false, NO_CAP, {}, { continuous: true });
    expect(run.stopReason).toBe('failures');
    expect(run.failed).toBeGreaterThanOrEqual(MAX_CONSECUTIVE_FAILURES);
    expect(run.ok).toBe(0);
    vi.mocked(listInboxMessages).mockResolvedValue([{ id: 'm1', size: 1000, hasAttachments: false }]);
  });

  it('pauses at the daily cap instead of ending', async () => {
    usage.bytes = 1024 ** 3;
    let paused: Date | null = null;
    const run = await mutateMail(['a@x.com'], 1, false, { ...NO_CAP, dailyCapGb: 1 }, {
      onPause: at => { paused = at; },
      shouldStop: () => paused !== null,
    }, { continuous: true });
    expect(paused).not.toBeNull();
    expect(paused!.getTime()).toBeGreaterThan(Date.now());
    expect(run.stopReason).toBe('stopped');
    expect(run.totalActions).toBe(0);
  });

  it('reports why a finite run ended', async () => {
    expect((await mutateMail(['a@x.com'], 3, false, NO_CAP)).stopReason).toBe('completed');
    usage.bytes = 1024 ** 3;
    expect((await mutateMail(['a@x.com'], 3, false, { ...NO_CAP, dailyCapGb: 1 })).stopReason).toBe('cap');
  });
});
