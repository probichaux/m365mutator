// Local, offline text for large mail bodies: readable business-style prose
// assembled from a word bank, sized to a target byte count. No network, no cost.

const SUBJECTS = [
  'The migration team', 'Our finance group', 'The regional office', 'Customer success',
  'The platform squad', 'Procurement', 'The steering committee', 'Our travel desk',
  'The analytics team', 'Legal and compliance', 'The support rotation', 'Facilities',
];
const VERBS = [
  'reviewed', 'approved', 'rescheduled', 'summarized', 'flagged', 'drafted',
  'reconciled', 'escalated', 'prioritized', 'archived', 'benchmarked', 'audited',
];
const OBJECTS = [
  'the quarterly forecast', 'the vendor contract', 'the renewal schedule', 'the onboarding checklist',
  'the tenant backup report', 'the itinerary for the offsite', 'the capacity plan', 'the incident timeline',
  'the retention settings', 'the pricing proposal', 'the license inventory', 'the release notes',
];
const TAILS = [
  'before the end of the week', 'ahead of the board meeting', 'after the latest round of feedback',
  'so the numbers line up with last year', 'pending sign-off from the sponsor', 'with a few open questions',
  'to keep the project on track', 'once the data finished syncing', 'as discussed on the call',
  'following the audit recommendations', 'while the team was traveling', 'in time for the next sprint',
];

const pick = <T>(list: readonly T[], rand: () => number): T => list[Math.floor(rand() * list.length)];

function sentence(rand: () => number): string {
  return `${pick(SUBJECTS, rand)} ${pick(VERBS, rand)} ${pick(OBJECTS, rand)} ${pick(TAILS, rand)}.`;
}

function paragraph(rand: () => number): string {
  const count = 4 + Math.floor(rand() * 5);
  return Array.from({ length: count }, () => sentence(rand)).join(' ');
}

/**
 * Build plain text of roughly `targetBytes` (UTF-8; the word bank is ASCII, so
 * bytes equal characters). Paragraphs are separated by blank lines. `rand`
 * returns [0, 1) and is injectable for tests.
 */
export function fillerText(targetBytes: number, rand: () => number = Math.random): string {
  const target = Math.max(1, Math.floor(targetBytes));
  const parts: string[] = [];
  let length = 0;
  while (length < target) {
    const p = paragraph(rand);
    parts.push(p);
    length += p.length + 2;
  }
  return parts.join('\n\n').slice(0, target);
}
