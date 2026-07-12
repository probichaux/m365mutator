// Perform one weighted-random OneDrive operation per selected user.
//
// Each operation picks a random existing folder in the user's drive as its
// working folder (the drive root when the drive has none). Operations that need
// an existing item to act on fall back to creating a text file when the drive
// has none, so a pass never silently no-ops — the same pattern mutateMail uses.

import { randomUUID } from 'node:crypto';
import {
  listOneDriveFolders, listOneDriveFiles, createOneDriveFolder,
  uploadOneDriveFileToFolder, renameOneDriveItem, moveOneDriveItem, deleteOneDriveFile,
  DriveItemRef,
} from '../graph/files.js';
import { generateText, SUBJECT_PROMPT, BODY_PROMPT } from './random-text.js';
import { generateDocument, DocKind } from './doc-gen.js';
import { fetchRandomImage } from './wikimedia.js';
import { sanitizeUpstreamError } from './connectivity.js';
import { logger } from '../logger/logger.js';

export type OneDriveOp =
  | 'createText' | 'createDoc' | 'rename' | 'createFolder' | 'remove' | 'folderMove' | 'image';

export interface OneDriveResult {
  /** The acting drive owner (UPN). */
  item: string;
  /** The operation actually performed (may differ from the pick after a fallback). */
  op: OneDriveOp;
  ok: boolean;
  detail?: string;
  error?: string;
}

export interface OneDriveRun {
  runs: number;
  totalActions: number;
  ok: number;
  failed: number;
  results: OneDriveResult[];
  truncated: boolean;
}

export const MAX_RUNS = 999;
const RESULT_SAMPLE_CAP = 500;
const MUTATE_CONCURRENCY = 5;

/** Probability weights; must sum to 100. */
const OP_WEIGHTS: { op: OneDriveOp; weight: number }[] = [
  { op: 'createText', weight: 20 },
  { op: 'createDoc', weight: 20 },
  { op: 'rename', weight: 10 },
  { op: 'createFolder', weight: 10 },
  { op: 'remove', weight: 15 },
  { op: 'folderMove', weight: 10 },
  { op: 'image', weight: 15 },
];

/** Pick an operation by weight. `rand` returns [0, 1); injectable for tests. */
export function pickOneDriveOp(rand: () => number = Math.random): OneDriveOp {
  let r = rand() * 100;
  for (const { op, weight } of OP_WEIGHTS) {
    if (r < weight) return op;
    r -= weight;
  }
  return OP_WEIGHTS.at(-1)!.op;
}

/** Replace a filename's base while keeping its extension; no extension → just the base. */
export function renameKeepingExtension(name: string, newBase: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return newBase;
  return `${newBase}${name.slice(dot)}`;
}

function randomBase(): string {
  return `mutator-${randomUUID().slice(0, 8)}`;
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function createTextFile(
  actor: string, folderId: string, folderName: string, fellBackFrom?: OneDriveOp,
): Promise<OneDriveResult> {
  const filename = `${randomBase()}.txt`;
  await uploadOneDriveFileToFolder(actor, folderId, filename, await generateText(BODY_PROMPT), 'text/plain');
  const detail = fellBackFrom
    ? `no item to ${fellBackFrom}; created ${filename} in ${folderName}`
    : `created ${filename} in ${folderName}`;
  return { item: actor, op: 'createText', ok: true, detail };
}

/** Files in the working folder (or the whole drive when it's the root). */
function filesFor(actor: string, folderId: string): Promise<DriveItemRef[]> {
  return listOneDriveFiles(actor, folderId === 'root' ? undefined : folderId);
}

async function mutateOne(actor: string): Promise<OneDriveResult> {
  const chosen = pickOneDriveOp();
  try {
    const folders = await listOneDriveFolders(actor);
    const folder = folders.length ? pickRandom(folders) : { id: 'root', name: 'root' };
    const folderId = folder.id;
    const folderName = folder.name ?? 'root';

    switch (chosen) {
      case 'createText':
        return await createTextFile(actor, folderId, folderName);

      case 'createDoc': {
        const kind: DocKind = Math.random() < 0.5 ? 'pdf' : 'docx';
        const [title, body] = await Promise.all([generateText(SUBJECT_PROMPT), generateText(BODY_PROMPT)]);
        const doc = await generateDocument(kind, title, body);
        const filename = `${randomBase()}.${doc.extension}`;
        await uploadOneDriveFileToFolder(actor, folderId, filename, doc.content, doc.contentType);
        return { item: actor, op: 'createDoc', ok: true, detail: `created ${filename} in ${folderName}` };
      }

      case 'createFolder': {
        const created = await createOneDriveFolder(actor, folderId, randomBase());
        return { item: actor, op: 'createFolder', ok: true, detail: `created folder ${created.name} in ${folderName}` };
      }

      case 'rename': {
        const files = await filesFor(actor, folderId);
        if (files.length === 0) return await createTextFile(actor, folderId, folderName, 'rename');
        const file = pickRandom(files);
        const newName = renameKeepingExtension(file.name ?? `${randomBase()}.txt`, randomBase());
        await renameOneDriveItem(actor, file.id, newName);
        return { item: actor, op: 'rename', ok: true, detail: `renamed ${file.name} to ${newName}` };
      }

      case 'remove': {
        const files = await filesFor(actor, folderId);
        if (files.length === 0) return await createTextFile(actor, folderId, folderName, 'remove');
        const file = pickRandom(files);
        await deleteOneDriveFile(actor, file.id);
        return { item: actor, op: 'remove', ok: true, detail: `removed ${file.name}` };
      }

      case 'folderMove': {
        const files = await filesFor(actor, folderId);
        if (files.length === 0) return await createTextFile(actor, folderId, folderName, 'folderMove');
        const created = await createOneDriveFolder(actor, folderId, randomBase());
        const file = pickRandom(files);
        await moveOneDriveItem(actor, file.id, created.id);
        return { item: actor, op: 'folderMove', ok: true, detail: `moved ${file.name} into ${created.name}` };
      }

      case 'image': {
        const img = await fetchRandomImage();
        await uploadOneDriveFileToFolder(actor, folderId, img.filename, img.buffer, img.contentType);
        return { item: actor, op: 'image', ok: true, detail: `added ${img.filename} to ${folderName}` };
      }
    }
  } catch (err) {
    const error = sanitizeUpstreamError(err);
    logger.warn(`[ONEDRIVE] ${chosen} failed for "${actor}": ${error}`);
    return { item: actor, op: chosen, ok: false, error };
  }
}

/**
 * Perform `runs` passes; each pass runs one weighted-random OneDrive operation
 * per selected user through a single bounded worker pool, so one failure does
 * not abort the rest. Returns totals plus a capped sample of individual results.
 */
export async function mutateOneDrive(items: string[], runs = 1): Promise<OneDriveRun> {
  const passes = Math.min(MAX_RUNS, Math.max(1, Math.round(runs)));
  logger.info(`[ONEDRIVE] Mutating ${items.length} drive(s) × ${passes} pass(es)`);

  const actors: string[] = [];
  for (let p = 0; p < passes; p++) actors.push(...items);

  const results: OneDriveResult[] = new Array(actors.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(MUTATE_CONCURRENCY, actors.length) }, async () => {
    while (next < actors.length) {
      const index = next++;
      results[index] = await mutateOne(actors[index]);
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
