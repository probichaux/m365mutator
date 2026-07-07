import { describe, it, expect, vi } from 'vitest';

// Mock the Graph + text layers so mutateMail can run without a tenant.
vi.mock('../graph/mail.js', () => ({
  sendMail: vi.fn().mockResolvedValue(undefined),
  replyToMail: vi.fn().mockResolvedValue(undefined),
  forwardMail: vi.fn().mockResolvedValue(undefined),
  moveMessage: vi.fn().mockResolvedValue(undefined),
  listInboxMessages: vi.fn().mockResolvedValue([{ id: 'm1' }]),
}));
vi.mock('./random-text.js', () => ({
  generateText: vi.fn().mockResolvedValue('text'),
  SUBJECT_PROMPT: 's',
  BODY_PROMPT: 'b',
}));

import { pickMailOp, mutateMail, MailOp } from './mail-mutate.js';

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
