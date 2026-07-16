// Perform one weighted-random SharePoint operation per selected site.
//
// Same operations and weights as OneDrive mutations; actors are site URLs
// rather than UPNs. Each pass resolves the URL to a Graph site ID, picks a
// random existing folder in the site's default document library, and dispatches
// a weighted-random operation. The same fallback behaviour as OneDrive applies:
// operations that need an existing file fall back to createText when none exist.

import { randomUUID } from 'node:crypto';
import {
  listSharePointFolders, listSharePointFiles, createSharePointFolder,
  uploadSharePointFileToFolder, renameSharePointItem, moveSharePointItem, deleteSharePointFile,
  DriveItemRef,
} from '../graph/files.js';
import { getSiteByUrl } from '../graph/sites.js';
import { generateText, SUBJECT_PROMPT, BODY_PROMPT } from './random-text.js';
import { generateDocument, DocKind } from './doc-gen.js';
import { fetchRandomImage } from './wikimedia.js';
import { sanitizeUpstreamError } from './connectivity.js';
import { logger } from '../logger/logger.js';

export type SharePointOp =
  | 'createText' | 'createDoc' | 'rename' | 'createFolder' | 'remove' | 'folderMove' | 'image';

export interface SharePointResult {
  /** The acting site URL. */
  item: string;
  /** The operation actually performed (may differ from the pick after a fallback). */
  op: SharePointOp;
  ok: boolean;
  detail?: string;
  error?: string;
}

export interface SharePointRun {
  runs: number;
  totalActions: number;
  ok: number;
  failed: number;
  results: SharePointResult[];
  truncated: boolean;
}

export const MAX_RUNS = 999;
const RESULT_SAMPLE_CAP = 500;
const MUTATE_CONCURRENCY = 5;

/** Probability weights; must sum to 100. */
const OP_WEIGHTS: { op: SharePointOp; weight: number }[] = [
  { op: 'createText', weight: 20 },
  { op: 'createDoc', weight: 20 },
  { op: 'rename', weight: 10 },
  { op: 'createFolder', weight: 10 },
  { op: 'remove', weight: 15 },
  { op: 'folderMove', weight: 10 },
  { op: 'image', weight: 15 },
];

/** Pick an operation by weight. `rand` returns [0, 1); injectable for tests. */
export function pickSharePointOp(rand: () => number = Math.random): SharePointOp {
  let r = rand() * 100;
  for (const { op, weight } of OP_WEIGHTS) {
    if (r < weight) return op;
    r -= weight;
  }
  return OP_WEIGHTS.at(-1)!.op;
}

function randomBase(): string {
  return `mutator-${randomUUID().slice(0, 8)}`;
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Replace a filename's base while keeping its extension; no extension → just the base. */
function renameKeepingExtension(name: string, newBase: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return newBase;
  return `${newBase}${name.slice(dot)}`;
}

async function createTextFile(
  siteUrl: string, siteId: string, folderId: string, folderName: string, fellBackFrom?: SharePointOp,
): Promise<SharePointResult> {
  const filename = `${randomBase()}.txt`;
  await uploadSharePointFileToFolder(siteId, folderId, filename, await generateText(BODY_PROMPT), 'text/plain');
  const detail = fellBackFrom
    ? `no item to ${fellBackFrom}; created ${filename} in ${folderName}`
    : `created ${filename} in ${folderName}`;
  return { item: siteUrl, op: 'createText', ok: true, detail };
}

function filesFor(siteId: string, folderId: string): Promise<DriveItemRef[]> {
  return listSharePointFiles(siteId, folderId === 'root' ? undefined : folderId);
}

async function mutateOne(siteUrl: string): Promise<SharePointResult> {
  const chosen = pickSharePointOp();
  try {
    const siteData = await getSiteByUrl(siteUrl) as { id: string };
    const siteId = siteData.id;

    const folders = await listSharePointFolders(siteId);
    const folder = folders.length ? pickRandom(folders) : { id: 'root', name: 'root' };
    const folderId = folder.id;
    const folderName = folder.name ?? 'root';

    switch (chosen) {
      case 'createText':
        return await createTextFile(siteUrl, siteId, folderId, folderName);

      case 'createDoc': {
        const kind: DocKind = Math.random() < 0.5 ? 'pdf' : 'docx';
        const [title, body] = await Promise.all([generateText(SUBJECT_PROMPT), generateText(BODY_PROMPT)]);
        const doc = await generateDocument(kind, title, body);
        const filename = `${randomBase()}.${doc.extension}`;
        await uploadSharePointFileToFolder(siteId, folderId, filename, doc.content, doc.contentType);
        return { item: siteUrl, op: 'createDoc', ok: true, detail: `created ${filename} in ${folderName}` };
      }

      case 'createFolder': {
        const created = await createSharePointFolder(siteId, folderId, randomBase());
        return { item: siteUrl, op: 'createFolder', ok: true, detail: `created folder ${created.name} in ${folderName}` };
      }

      case 'rename': {
        const files = await filesFor(siteId, folderId);
        if (files.length === 0) return await createTextFile(siteUrl, siteId, folderId, folderName, 'rename');
        const file = pickRandom(files);
        const oldName = file.name ?? file.id;
        const newName = renameKeepingExtension(oldName, randomBase());
        await renameSharePointItem(siteId, file.id, newName);
        return { item: siteUrl, op: 'rename', ok: true, detail: `renamed ${oldName} to ${newName}` };
      }

      case 'remove': {
        const files = await filesFor(siteId, folderId);
        if (files.length === 0) return await createTextFile(siteUrl, siteId, folderId, folderName, 'remove');
        const file = pickRandom(files);
        const name = file.name ?? file.id;
        await deleteSharePointFile(siteId, file.id);
        return { item: siteUrl, op: 'remove', ok: true, detail: `removed ${name}` };
      }

      case 'folderMove': {
        const files = await filesFor(siteId, folderId);
        if (files.length === 0) return await createTextFile(siteUrl, siteId, folderId, folderName, 'folderMove');
        const created = await createSharePointFolder(siteId, folderId, randomBase());
        const file = pickRandom(files);
        await moveSharePointItem(siteId, file.id, created.id);
        return { item: siteUrl, op: 'folderMove', ok: true, detail: `moved ${file.name} into ${created.name}` };
      }

      case 'image': {
        const img = await fetchRandomImage();
        await uploadSharePointFileToFolder(siteId, folderId, img.filename, img.buffer, img.contentType);
        return { item: siteUrl, op: 'image', ok: true, detail: `added ${img.filename} to ${folderName}` };
      }
    }
  } catch (err) {
    const error = sanitizeUpstreamError(err);
    logger.warn(`[SHAREPOINT] ${chosen} failed for "${siteUrl}": ${error}`);
    return { item: siteUrl, op: chosen, ok: false, error };
  }
}

/**
 * Perform `runs` passes; each pass runs one weighted-random SharePoint operation
 * per selected site through a bounded worker pool.
 */
export async function mutateSharePoint(items: string[], runs = 1): Promise<SharePointRun> {
  const passes = Math.min(MAX_RUNS, Math.max(1, Math.round(runs)));
  logger.info(`[SHAREPOINT] Mutating ${items.length} site(s) × ${passes} pass(es)`);

  const actors: string[] = [];
  for (let p = 0; p < passes; p++) actors.push(...items);

  const results: SharePointResult[] = new Array(actors.length);
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
