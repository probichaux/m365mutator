// Perform one weighted-random mail operation per selected user.

import { randomBytes, randomUUID } from 'node:crypto';
import {
  sendMail, sendMailWithAttachment, replyToMail, forwardMail, moveMessage, listInboxMessages, MailRef,
} from '../graph/mail.js';
import { generateText, subjectPrompt, bodyPrompt } from './random-text.js';
import { fillerText } from './filler-text.js';
import { bytesAddedToday, recordBytesAdded, today } from './seed-usage.js';
import { sanitizeUpstreamError } from './connectivity.js';
import { logger } from '../logger/logger.js';

export type MailOp = 'send' | 'reply' | 'forward' | 'move';

export interface MailResult {
  /** The acting mailbox (UPN). */
  item: string;
  /** The operation actually performed (may differ from the pick after a fallback). */
  op: MailOp;
  ok: boolean;
  /** Human-readable summary of what happened, e.g. "sent to bob@…". */
  detail?: string;
  error?: string;
  /** Estimated bytes this action added across mailboxes (sender's copy + recipient's copy). */
  bytes?: number;
}

/** Message sizing for seeding mailbox storage. Zero means "off" for each field. */
export interface MailSizeOptions {
  /** Body size in KB of locally generated text; 0 keeps the short OpenRouter/GUID body. */
  bodyKb: number;
  /** Size in MB of a random-data attachment on each new message; 0 sends no attachment. */
  attachmentMb: number;
  /** Stop once today's estimated growth reaches this many GB; 0 disables the cap. */
  dailyCapGb: number;
}

/** Lets a caller watch a run as it goes and ask it to stop early. */
export interface MailRunHooks {
  /** Called once per finished action, with today's running total. */
  onResult?: (result: MailResult, bytesToday: number) => void;
  /** Checked before each action; returning true stops scheduling new actions. */
  shouldStop?: () => boolean;
  /** A continuous run hit the daily cap and is waiting for the next local day. */
  onPause?: (resumeAt: Date) => void;
  onResume?: () => void;
}

export interface MailRunOptions {
  /** Keep going until stopped (or until failures pile up), pausing at the daily cap until midnight. */
  continuous?: boolean;
}

/** Give up after this many failures in a row: the mailbox is likely full or access was revoked. */
export const MAX_CONSECUTIVE_FAILURES = 25;
/** How often a paused continuous run checks for a stop request or a new day. */
const PAUSE_POLL_MS = 5000;

function nextLocalMidnight(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
}

export const MAX_BODY_KB = 2048;
/** Keeps an encoded message under Exchange Online's default 35 MB send limit. */
export const MAX_ATTACHMENT_MB = 25;
export const MAX_DAILY_CAP_GB = 100;
export const DEFAULT_SIZE_OPTIONS: MailSizeOptions = { bodyKb: 0, attachmentMb: 0, dailyCapGb: 1 };

/** Why a run ended. */
export type MailStopReason = 'completed' | 'cap' | 'stopped' | 'failures';

export interface MailRun {
  /** Number of passes requested (one weighted action per mailbox per pass); 0 for a continuous run. */
  runs: number;
  continuous: boolean;
  stopReason: MailStopReason;
  /** runs × mailboxes — the total actions attempted. */
  totalActions: number;
  ok: number;
  failed: number;
  /** A capped sample of per-action results for display. */
  results: MailResult[];
  /** True when more actions ran than are included in `results`. */
  truncated: boolean;
  /** Actions not attempted because the daily cap was reached. */
  skipped: number;
  /** Estimated bytes this run added. */
  bytesAdded: number;
  /** Estimated bytes added today, this run included. */
  bytesToday: number;
  /** The daily cap in bytes; 0 when there is no cap. */
  capBytes: number;
}

export const MAX_RUNS = 999;
/** Cap on per-action results returned so a large run does not ship a huge payload. */
const RESULT_SAMPLE_CAP = 500;

/** Probability weights; each set must sum to 100. */
const OP_WEIGHTS_WITH_DELETE: { op: MailOp; weight: number }[] = [
  { op: 'send', weight: 30 },
  { op: 'reply', weight: 35 },
  { op: 'forward', weight: 30 },
  { op: 'move', weight: 5 },
];

// When deletions are disabled, the move-to-Deleted-Items share (5%) goes to new messages.
const OP_WEIGHTS_NO_DELETE: { op: MailOp; weight: number }[] = [
  { op: 'send', weight: 35 },
  { op: 'reply', weight: 35 },
  { op: 'forward', weight: 30 },
  { op: 'move', weight: 0 },
];

const DELETED_ITEMS = 'deleteditems';
const MUTATE_CONCURRENCY = 5;
// Large uploads share one mailbox's budget (4 concurrent requests, 150 MB per
// 5 minutes), so more parallelism only earns throttling.
const ATTACHMENT_CONCURRENCY = 2;
// A self-addressed message is stored twice: Sent Items and the Inbox. A message
// to another selected mailbox is also stored twice, once in each mailbox.
const STORED_COPIES = 2;
const ATTACHMENT_NAMES = ['forecast', 'contract', 'itinerary', 'capacity-plan', 'backup-report', 'release-notes'];

const clamp = (value: unknown, max: number, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(0, value)) : fallback;

/** Coerce untrusted request input into valid size options. */
export function normalizeSizeOptions(raw: Partial<Record<keyof MailSizeOptions, unknown>> = {}): MailSizeOptions {
  return {
    bodyKb: Math.round(clamp(raw.bodyKb, MAX_BODY_KB, DEFAULT_SIZE_OPTIONS.bodyKb)),
    attachmentMb: Math.round(clamp(raw.attachmentMb, MAX_ATTACHMENT_MB, DEFAULT_SIZE_OPTIONS.attachmentMb)),
    dailyCapGb: clamp(raw.dailyCapGb, MAX_DAILY_CAP_GB, DEFAULT_SIZE_OPTIONS.dailyCapGb),
  };
}

async function bodyText(size: MailSizeOptions): Promise<string> {
  return size.bodyKb > 0 ? fillerText(size.bodyKb * 1024) : generateText(bodyPrompt());
}

const formatMb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/**
 * Only ordinary mail (IPM.Note and its subclasses) accepts a reply or forward;
 * meeting requests, delivery reports, and similar items fail with "Item type is
 * invalid for creating a Reply". Items whose class Graph didn't return are kept.
 */
export function isReplyable(msg: MailRef): boolean {
  if (!msg.messageClass) return true;
  const cls = msg.messageClass.toLowerCase();
  return cls === 'ipm.note' || cls.startsWith('ipm.note.');
}

/**
 * Pick an operation by weight. When `allowDeletions` is false the move-to-Deleted-Items
 * action is never chosen. `rand` returns [0, 1); injectable for tests.
 */
export function pickMailOp(allowDeletions: boolean, rand: () => number = Math.random): MailOp {
  const weights = allowDeletions ? OP_WEIGHTS_WITH_DELETE : OP_WEIGHTS_NO_DELETE;
  let r = rand() * 100;
  for (const { op, weight } of weights) {
    if (weight > 0 && r < weight) return op;
    r -= weight;
  }
  // Unreachable for r in [0, 100); fall back to the last enabled operation.
  return weights.filter(w => w.weight > 0).at(-1)!.op;
}

/** A different mailbox to act against, or the actor itself when it is the only one selected. */
function pickCounterpart(actor: string, others: string[]): string {
  if (others.length === 0) return actor;
  return others[Math.floor(Math.random() * others.length)];
}

async function runSend(actor: string, others: string[], size: MailSizeOptions, fellBackFrom?: MailOp): Promise<MailResult> {
  const to = pickCounterpart(actor, others);
  const subject = await generateText(subjectPrompt());
  const content = await bodyText(size);
  const message = {
    subject,
    body: { contentType: 'Text' as const, content },
    toRecipients: [{ emailAddress: { address: to } }],
  };
  let attachmentBytes = 0;
  if (size.attachmentMb > 0) {
    const bytes = randomBytes(size.attachmentMb * 1024 * 1024);
    const name = `${ATTACHMENT_NAMES[Math.floor(Math.random() * ATTACHMENT_NAMES.length)]}-${randomUUID().slice(0, 8)}.bin`;
    await sendMailWithAttachment(actor, message, { name, contentType: 'application/octet-stream', bytes });
    attachmentBytes = bytes.length;
  } else {
    await sendMail(actor, message);
  }
  const bytes = STORED_COPIES * (Buffer.byteLength(subject) + Buffer.byteLength(content) + attachmentBytes);
  const base = fellBackFrom ? `no inbox messages; sent to ${to} instead` : `sent to ${to}`;
  const detail = size.bodyKb > 0 || attachmentBytes > 0 ? `${base} (~${formatMb(bytes / STORED_COPIES)})` : base;
  return { item: actor, op: 'send', ok: true, detail, bytes };
}

async function mutateOne(actor: string, others: string[], allowDeletions: boolean, size: MailSizeOptions): Promise<MailResult> {
  const chosen = pickMailOp(allowDeletions);
  try {
    if (chosen !== 'send') {
      const inbox = await listInboxMessages(actor);
      const messages = chosen === 'move' ? inbox : inbox.filter(isReplyable);
      if (messages.length === 0) {
        // Fall back to a doable operation rather than skip.
        return await runSend(actor, others, size, chosen);
      }
      const msg = messages[Math.floor(Math.random() * messages.length)];
      if (chosen === 'reply') {
        const comment = await bodyText(size);
        await replyToMail(actor, msg.id, comment);
        // A reply quotes the original body but not its attachments; when the
        // original has attachments its body size is unknown, so count the comment twice.
        const quoted = msg.hasAttachments ? Buffer.byteLength(comment) : (msg.size ?? 0);
        const bytes = STORED_COPIES * (Buffer.byteLength(comment) + quoted);
        return { item: actor, op: 'reply', ok: true, detail: 'replied to an inbox message', bytes };
      }
      if (chosen === 'forward') {
        const to = pickCounterpart(actor, others);
        await forwardMail(actor, msg.id, [to]);
        // A forward carries the original's attachments, so it costs the full original size.
        const bytes = STORED_COPIES * (msg.size ?? 0);
        const detail = msg.size ? `forwarded to ${to} (~${formatMb(msg.size)})` : `forwarded to ${to}`;
        return { item: actor, op: 'forward', ok: true, detail, bytes };
      }
      await moveMessage(actor, msg.id, DELETED_ITEMS);
      return { item: actor, op: 'move', ok: true, detail: 'moved a message to Deleted Items', bytes: 0 };
    }
    return await runSend(actor, others, size);
  } catch (err) {
    const error = sanitizeUpstreamError(err);
    logger.warn(`[MAIL] ${chosen} failed for "${actor}": ${error}`);
    return { item: actor, op: chosen, ok: false, error };
  }
}

/**
 * Perform `runs` passes; each pass runs one weighted-random mail operation per
 * selected user. All actions are scheduled through a single bounded worker
 * pool, so one failure does not abort the rest. A continuous run repeats passes
 * until stopped. When a daily cap is set, a finite run ends once today's
 * estimated growth reaches it, and a continuous run pauses until the next local
 * day. Either kind ends after MAX_CONSECUTIVE_FAILURES failures in a row.
 * Returns totals plus a capped sample of individual results.
 */
export async function mutateMail(
  items: string[],
  runs = 1,
  allowDeletions = false,
  sizeOptions: MailSizeOptions = DEFAULT_SIZE_OPTIONS,
  hooks: MailRunHooks = {},
  runOptions: MailRunOptions = {},
): Promise<MailRun> {
  const continuous = runOptions.continuous === true;
  const passes = continuous ? 0 : Math.min(MAX_RUNS, Math.max(1, Math.round(runs)));
  const planned = continuous ? Infinity : passes * items.length;
  const size = normalizeSizeOptions({ ...sizeOptions });
  const capBytes = Math.round(size.dailyCapGb * 1024 ** 3);
  logger.info(
    `[MAIL] Mutating ${items.length} mailbox(es) × ${continuous ? 'continuous' : `${passes} pass(es)`}, ` +
    `deletions ${allowDeletions ? 'on' : 'off'}, ` +
    `body ${size.bodyKb} KB, attachment ${size.attachmentMb} MB, daily cap ${size.dailyCapGb} GB`,
  );

  // Precompute each actor's counterparts once; action i acts as items[i % n].
  const othersByActor = new Map(items.map(a => [a, items.filter(i => i !== a)]));

  const startedToday = bytesAddedToday();
  let bytesToday = startedToday;
  // Growth across day boundaries, for a continuous run that outlives a day.
  let bytesEarlierDays = 0;
  let dayBaseline = startedToday;
  let day = today();
  let reason: MailStopReason | null = null;
  let consecutiveFailures = 0;
  let pausedUntil: Date | null = null;

  const capReached = () => capBytes > 0 && bytesToday >= capBytes;

  const checkStop = () => {
    if (!reason && hooks.shouldStop?.()) reason = 'stopped';
    return reason !== null;
  };

  // Rolls today's counter over when the local date changes.
  const rollDay = () => {
    const now = today();
    if (now !== day) {
      bytesEarlierDays += bytesToday - dayBaseline;
      day = now;
      bytesToday = bytesAddedToday();
      dayBaseline = bytesToday;
    }
  };

  // For a continuous run at the cap: wait (checking for a stop) until the next day.
  const waitForNextDay = async () => {
    if (!pausedUntil) {
      pausedUntil = nextLocalMidnight();
      logger.info(`[MAIL] Daily cap of ${size.dailyCapGb} GB reached; pausing until ${pausedUntil.toISOString()}`);
      hooks.onPause?.(pausedUntil);
    }
    // Other workers may wait here too; each keeps its own copy of the deadline
    // because the first one to wake clears the shared value.
    const until = pausedUntil.getTime();
    while (!checkStop() && Date.now() < until) {
      await new Promise(r => setTimeout(r, PAUSE_POLL_MS));
    }
    if (pausedUntil && !reason) {
      pausedUntil = null;
      rollDay();
      logger.info('[MAIL] New day; resuming continuous run');
      hooks.onResume?.();
    }
  };

  const sample: MailResult[] = [];
  let finished = 0;
  let ok = 0;
  let next = 0;
  const concurrency = size.attachmentMb > 0 ? ATTACHMENT_CONCURRENCY : MUTATE_CONCURRENCY;

  const worker = async () => {
    while (next < planned) {
      if (checkStop()) return;
      rollDay();
      if (capReached()) {
        if (!continuous) { reason = reason ?? 'cap'; return; }
        await waitForNextDay();
        continue;
      }
      const actor = items[next++ % items.length];
      const result = await mutateOne(actor, othersByActor.get(actor) ?? [], allowDeletions, size);
      finished++;
      if (result.ok) {
        ok++;
        consecutiveFailures = 0;
        if (result.bytes) bytesToday = recordBytesAdded(result.bytes);
      } else if (++consecutiveFailures >= MAX_CONSECUTIVE_FAILURES && !reason) {
        reason = 'failures';
        logger.warn(`[MAIL] ${MAX_CONSECUTIVE_FAILURES} failures in a row; ending the run. Last error: ${result.error}`);
      }
      if (sample.length < RESULT_SAMPLE_CAP) sample.push(result);
      hooks.onResult?.(result, bytesToday);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, Number.isFinite(planned) ? planned : concurrency) }, worker));

  // `reason` is set inside the workers, so TypeScript can't see it change here.
  const stopReason: MailStopReason = (reason as MailStopReason | null) ?? 'completed';
  const skipped = continuous ? 0 : planned - next;
  if (skipped > 0 && stopReason === 'stopped') logger.info(`[MAIL] Stopped on request; skipped ${skipped} action(s)`);
  else if (skipped > 0 && stopReason === 'cap') logger.info(`[MAIL] Daily cap of ${size.dailyCapGb} GB reached; skipped ${skipped} action(s)`);
  const bytesAdded = bytesEarlierDays + bytesToday - dayBaseline;
  logger.info(
    `[MAIL] Run finished (${stopReason}): ${ok} ok, ${finished - ok} failed, ${skipped} skipped, ` +
    `~${formatMb(bytesAdded)} added (~${formatMb(bytesToday)} today)`,
  );
  return {
    runs: passes,
    continuous,
    stopReason,
    totalActions: finished,
    ok,
    failed: finished - ok,
    results: sample,
    truncated: finished > sample.length,
    skipped,
    bytesAdded,
    bytesToday,
    capBytes,
  };
}
