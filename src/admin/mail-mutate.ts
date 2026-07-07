// Perform one weighted-random mail operation per selected user.

import {
  sendMail, replyToMail, forwardMail, moveMessage, listInboxMessages,
} from '../graph/mail.js';
import { generateText, SUBJECT_PROMPT, BODY_PROMPT } from './random-text.js';
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
}

export interface MailRun {
  /** Number of passes performed (one weighted action per mailbox per pass). */
  runs: number;
  /** runs × mailboxes — the total actions attempted. */
  totalActions: number;
  ok: number;
  failed: number;
  /** A capped sample of per-action results for display. */
  results: MailResult[];
  /** True when more actions ran than are included in `results`. */
  truncated: boolean;
}

export const MAX_RUNS = 999;
/** Cap on per-action results returned so a large run does not ship a huge payload. */
const RESULT_SAMPLE_CAP = 500;

/** Probability weights from the plan; must sum to 100. */
const OP_WEIGHTS: { op: MailOp; weight: number }[] = [
  { op: 'send', weight: 30 },
  { op: 'reply', weight: 35 },
  { op: 'forward', weight: 30 },
  { op: 'move', weight: 5 },
];

const DELETED_ITEMS = 'deleteditems';
const MUTATE_CONCURRENCY = 5;

/** Pick an operation by weight. `rand` returns [0, 1); injectable for tests. */
export function pickMailOp(rand: () => number = Math.random): MailOp {
  let r = rand() * 100;
  for (const { op, weight } of OP_WEIGHTS) {
    if (r < weight) return op;
    r -= weight;
  }
  return OP_WEIGHTS[OP_WEIGHTS.length - 1].op;
}

/** A different mailbox to act against, or the actor itself when it is the only one selected. */
function pickCounterpart(actor: string, others: string[]): string {
  if (others.length === 0) return actor;
  return others[Math.floor(Math.random() * others.length)];
}

async function runSend(actor: string, others: string[], fellBackFrom?: MailOp): Promise<MailResult> {
  const to = pickCounterpart(actor, others);
  const subject = await generateText(SUBJECT_PROMPT);
  const content = await generateText(BODY_PROMPT);
  await sendMail(actor, {
    subject,
    body: { contentType: 'Text', content },
    toRecipients: [{ emailAddress: { address: to } }],
  });
  const detail = fellBackFrom ? `no inbox messages; sent to ${to} instead` : `sent to ${to}`;
  return { item: actor, op: 'send', ok: true, detail };
}

async function mutateOne(actor: string, others: string[]): Promise<MailResult> {
  const chosen = pickMailOp();
  try {
    if (chosen !== 'send') {
      const messages = await listInboxMessages(actor);
      if (messages.length === 0) {
        // Fall back to a doable operation rather than skip.
        return await runSend(actor, others, chosen);
      }
      const msg = messages[Math.floor(Math.random() * messages.length)];
      if (chosen === 'reply') {
        await replyToMail(actor, msg.id, await generateText(BODY_PROMPT));
        return { item: actor, op: 'reply', ok: true, detail: 'replied to an inbox message' };
      }
      if (chosen === 'forward') {
        const to = pickCounterpart(actor, others);
        await forwardMail(actor, msg.id, [to]);
        return { item: actor, op: 'forward', ok: true, detail: `forwarded to ${to}` };
      }
      await moveMessage(actor, msg.id, DELETED_ITEMS);
      return { item: actor, op: 'move', ok: true, detail: 'moved a message to Deleted Items' };
    }
    return await runSend(actor, others);
  } catch (err) {
    const error = sanitizeUpstreamError(err);
    logger.warn(`[MAIL] ${chosen} failed for "${actor}": ${error}`);
    return { item: actor, op: chosen, ok: false, error };
  }
}

/**
 * Perform `runs` passes; each pass runs one weighted-random mail operation per
 * selected user. All actions (runs × mailboxes) are scheduled through a single
 * bounded worker pool, so one failure does not abort the rest. Returns totals
 * plus a capped sample of individual results.
 */
export async function mutateMail(items: string[], runs = 1): Promise<MailRun> {
  const passes = Math.min(MAX_RUNS, Math.max(1, Math.round(runs)));
  logger.info(`[MAIL] Mutating ${items.length} mailbox(es) × ${passes} pass(es)`);

  // Precompute each actor's counterparts once; flatten passes into one task list.
  const othersByActor = new Map(items.map(a => [a, items.filter(i => i !== a)]));
  const actors: string[] = [];
  for (let p = 0; p < passes; p++) actors.push(...items);

  const results: MailResult[] = new Array(actors.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(MUTATE_CONCURRENCY, actors.length) }, async () => {
    while (next < actors.length) {
      const index = next++;
      const actor = actors[index];
      results[index] = await mutateOne(actor, othersByActor.get(actor) ?? []);
    }
  });
  await Promise.all(workers);

  const ok = results.filter(r => r.ok).length;
  return {
    runs: passes,
    totalActions: results.length,
    ok,
    failed: results.length - ok,
    results: results.slice(0, RESULT_SAMPLE_CAP),
    truncated: results.length > RESULT_SAMPLE_CAP,
  };
}
