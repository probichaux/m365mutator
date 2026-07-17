import { getGraphClient } from './graph-client.js';
import { collectAllPages } from './graph-paginate.js';

// Drive helpers — shared by OneDrive (user drives) and SharePoint (site document libraries).
// Callers construct the drivePrefix:
//   OneDrive:   `/users/${seg(userId)}/drive`     — userId must be encoded (UPN contains @)
//   SharePoint: `/sites/${siteId}/drive`           — siteId contains commas; do NOT encode

const seg = (v: string) => encodeURIComponent(v);

export interface DriveItemRef {
  id: string;
  name?: string;
}

/** A UTC ISO half-open-inclusive window; either bound may be omitted (unbounded). */
export interface DateRange {
  afterIso?: string;
  beforeIso?: string;
}

interface DriveItemRaw {
  id: string;
  name?: string;
  createdDateTime?: string;
  file?: unknown;
  folder?: unknown;
}

/** Upper bound on drive items visited in one scan, so a huge drive can't run unbounded. */
export const MAX_ONEDRIVE_SCAN = 5000;

function inRange(iso: string | undefined, range: DateRange): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  if (range.afterIso && t < new Date(range.afterIso).getTime()) return false;
  if (range.beforeIso && t > new Date(range.beforeIso).getTime()) return false;
  return true;
}

/** Children endpoint for a folder within a drive; root uses its own path segment. */
function driveChildrenPath(drivePrefix: string, folderId: string): string {
  return folderId === 'root'
    ? `${drivePrefix}/root/children`
    : `${drivePrefix}/items/${seg(folderId)}/children`;
}

/**
 * Walk a drive breadth-first, returning every item (files and folders) up to
 * MAX_ONEDRIVE_SCAN. Drive items have no server-side date filter, so callers
 * filter the result client-side. Requires Files.ReadWrite.All or Sites.ReadWrite.All.
 */
async function walkDriveItems(drivePrefix: string): Promise<DriveItemRaw[]> {
  const client = getGraphClient();
  const out: DriveItemRaw[] = [];
  const queue: string[] = ['root'];
  let scanned = 0;

  while (queue.length > 0 && scanned < MAX_ONEDRIVE_SCAN) {
    const parent = queue.shift()!;
    const children = await collectAllPages<DriveItemRaw>(client, driveChildrenPath(drivePrefix, parent), req =>
      req.select('id,name,createdDateTime,file,folder').top(999));
    for (const item of children) {
      scanned++;
      out.push(item);
      if (item.folder) queue.push(item.id);
    }
  }
  return out;
}

async function listDriveFolders(drivePrefix: string): Promise<DriveItemRef[]> {
  const items = await walkDriveItems(drivePrefix);
  return items.filter(i => i.folder).map(i => ({ id: i.id, name: i.name }));
}

async function listDriveFiles(drivePrefix: string, folderId?: string): Promise<DriveItemRef[]> {
  if (!folderId || folderId === 'root') {
    const items = await walkDriveItems(drivePrefix);
    return items.filter(i => i.file).map(i => ({ id: i.id, name: i.name }));
  }
  const children = await collectAllPages<DriveItemRaw>(getGraphClient(), driveChildrenPath(drivePrefix, folderId), req =>
    req.select('id,name,file,folder').top(999));
  return children.filter(i => i.file).map(i => ({ id: i.id, name: i.name }));
}

async function createDriveFolder(drivePrefix: string, parentId: string, name: string): Promise<DriveItemRef> {
  const res = await getGraphClient().api(driveChildrenPath(drivePrefix, parentId)).post({
    name,
    folder: {},
    '@microsoft.graph.conflictBehavior': 'rename',
  }) as DriveItemRaw;
  return { id: res.id, name: res.name };
}

async function uploadDriveFileToFolder(
  drivePrefix: string,
  parentId: string,
  filename: string,
  content: Buffer | Uint8Array | string,
  contentType?: string,
): Promise<DriveItemRef> {
  const path = parentId === 'root'
    ? `${drivePrefix}/root:/${seg(filename)}:/content`
    : `${drivePrefix}/items/${seg(parentId)}:/${seg(filename)}:/content`;
  let req = getGraphClient().api(path);
  if (contentType) req = req.header('Content-Type', contentType);
  const res = await req.put(content) as DriveItemRaw;
  return { id: res.id, name: res.name };
}

async function renameDriveItem(drivePrefix: string, itemId: string, newName: string): Promise<void> {
  await getGraphClient().api(`${drivePrefix}/items/${seg(itemId)}`).patch({ name: newName });
}

async function moveDriveItem(drivePrefix: string, itemId: string, newParentId: string): Promise<void> {
  await getGraphClient().api(`${drivePrefix}/items/${seg(itemId)}`).patch({
    parentReference: { id: newParentId },
  });
}

// ── OneDrive (a user's personal drive) ──────────────────────────────

export async function uploadOneDriveFile(userId: string, path: string, content: Buffer | string): Promise<Record<string, unknown>> {
  return getGraphClient().api(`/users/${userId}/drive/root:/${path}:/content`).put(content);
}

export async function deleteOneDriveFile(userId: string, itemId: string): Promise<void> {
  await getGraphClient().api(`/users/${seg(userId)}/drive/items/${seg(itemId)}`).delete();
}

/** Files across the whole drive whose createdDateTime falls within `range` (empty = all). */
export async function listOneDriveItemsByDate(userId: string, range: DateRange = {}): Promise<DriveItemRef[]> {
  const items = await walkDriveItems(`/users/${seg(userId)}/drive`);
  return items
    .filter(i => i.file && inRange(i.createdDateTime, range))
    .map(i => ({ id: i.id, name: i.name }));
}

export function listOneDriveFolders(userId: string): Promise<DriveItemRef[]> {
  return listDriveFolders(`/users/${seg(userId)}/drive`);
}

export function listOneDriveFiles(userId: string, folderId?: string): Promise<DriveItemRef[]> {
  return listDriveFiles(`/users/${seg(userId)}/drive`, folderId);
}

export function createOneDriveFolder(userId: string, parentId: string, name: string): Promise<DriveItemRef> {
  return createDriveFolder(`/users/${seg(userId)}/drive`, parentId, name);
}

export function uploadOneDriveFileToFolder(
  userId: string, parentId: string, filename: string,
  content: Buffer | Uint8Array | string, contentType?: string,
): Promise<DriveItemRef> {
  return uploadDriveFileToFolder(`/users/${seg(userId)}/drive`, parentId, filename, content, contentType);
}

export function renameOneDriveItem(userId: string, itemId: string, newName: string): Promise<void> {
  return renameDriveItem(`/users/${seg(userId)}/drive`, itemId, newName);
}

export function moveOneDriveItem(userId: string, itemId: string, newParentId: string): Promise<void> {
  return moveDriveItem(`/users/${seg(userId)}/drive`, itemId, newParentId);
}

// ── SharePoint document libraries ────────────────────────────────────

export async function uploadSharePointFile(siteId: string, path: string, content: Buffer | string): Promise<Record<string, unknown>> {
  return getGraphClient().api(`/sites/${siteId}/drive/root:/${path}:/content`).put(content);
}

export async function deleteSharePointFile(siteId: string, itemId: string): Promise<void> {
  await getGraphClient().api(`/sites/${siteId}/drive/items/${itemId}`).delete();
}

export async function updateSharePointFileMetadata(
  siteId: string, itemId: string, patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return getGraphClient().api(`/sites/${siteId}/drive/items/${itemId}`).patch(patch);
}

export function listSharePointFolders(siteId: string): Promise<DriveItemRef[]> {
  return listDriveFolders(`/sites/${siteId}/drive`);
}

export function listSharePointFiles(siteId: string, folderId?: string): Promise<DriveItemRef[]> {
  return listDriveFiles(`/sites/${siteId}/drive`, folderId);
}

export function createSharePointFolder(siteId: string, parentId: string, name: string): Promise<DriveItemRef> {
  return createDriveFolder(`/sites/${siteId}/drive`, parentId, name);
}

export function uploadSharePointFileToFolder(
  siteId: string, parentId: string, filename: string,
  content: Buffer | Uint8Array | string, contentType?: string,
): Promise<DriveItemRef> {
  return uploadDriveFileToFolder(`/sites/${siteId}/drive`, parentId, filename, content, contentType);
}

export function renameSharePointItem(siteId: string, itemId: string, newName: string): Promise<void> {
  return renameDriveItem(`/sites/${siteId}/drive`, itemId, newName);
}

export function moveSharePointItem(siteId: string, itemId: string, newParentId: string): Promise<void> {
  return moveDriveItem(`/sites/${siteId}/drive`, itemId, newParentId);
}
