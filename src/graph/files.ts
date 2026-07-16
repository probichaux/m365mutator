import { getGraphClient } from './graph-client.js';
import { collectAllPages } from './graph-paginate.js';

// OneDrive (a user's personal drive) — requires the Files.ReadWrite.All application permission.

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

/** Children endpoint for a folder; the drive root uses its own path segment. */
function childrenPath(userId: string, folderId: string): string {
  return folderId === 'root'
    ? `/users/${seg(userId)}/drive/root/children`
    : `/users/${seg(userId)}/drive/items/${seg(folderId)}/children`;
}

/**
 * Walk a user's OneDrive breadth-first, returning every item visited (files and
 * folders) up to MAX_ONEDRIVE_SCAN. Drive items have no server-side date filter,
 * so callers filter the result client-side. Requires Files.ReadWrite.All.
 */
async function walkDrive(userId: string): Promise<DriveItemRaw[]> {
  const client = getGraphClient();
  const out: DriveItemRaw[] = [];
  const queue: string[] = ['root'];
  let scanned = 0;

  while (queue.length > 0 && scanned < MAX_ONEDRIVE_SCAN) {
    const parent = queue.shift()!;
    const children = await collectAllPages<DriveItemRaw>(client, childrenPath(userId, parent), req =>
      req.select('id,name,createdDateTime,file,folder').top(999));
    for (const item of children) {
      scanned++;
      out.push(item);
      if (item.folder) queue.push(item.id);
    }
  }
  return out;
}

export async function uploadOneDriveFile(userId: string, path: string, content: Buffer | string): Promise<Record<string, unknown>> {
  return getGraphClient().api(`/users/${userId}/drive/root:/${path}:/content`).put(content);
}

export async function deleteOneDriveFile(userId: string, itemId: string): Promise<void> {
  await getGraphClient().api(`/users/${userId}/drive/items/${itemId}`).delete();
}

/** Files across the whole drive whose createdDateTime falls within `range` (empty = all). */
export async function listOneDriveItemsByDate(userId: string, range: DateRange = {}): Promise<DriveItemRef[]> {
  const items = await walkDrive(userId);
  return items
    .filter(i => i.file && inRange(i.createdDateTime, range))
    .map(i => ({ id: i.id, name: i.name }));
}

/** Every folder in the drive, for picking a random working folder. */
export async function listOneDriveFolders(userId: string): Promise<DriveItemRef[]> {
  const items = await walkDrive(userId);
  return items.filter(i => i.folder).map(i => ({ id: i.id, name: i.name }));
}

/**
 * Files in the drive, optionally limited to one folder's immediate children.
 * With no `folderId` this returns every file in the drive.
 */
export async function listOneDriveFiles(userId: string, folderId?: string): Promise<DriveItemRef[]> {
  if (!folderId || folderId === 'root') {
    return listOneDriveItemsByDate(userId, {});
  }
  const children = await collectAllPages<DriveItemRaw>(getGraphClient(), childrenPath(userId, folderId), req =>
    req.select('id,name,file,folder').top(999));
  return children.filter(i => i.file).map(i => ({ id: i.id, name: i.name }));
}

/** Create a folder under `parentId` ('root' for the drive root). Requires Files.ReadWrite.All. */
export async function createOneDriveFolder(userId: string, parentId: string, name: string): Promise<DriveItemRef> {
  const res = await getGraphClient().api(childrenPath(userId, parentId)).post({
    name,
    folder: {},
    '@microsoft.graph.conflictBehavior': 'rename',
  }) as DriveItemRaw;
  return { id: res.id, name: res.name };
}

/** Upload a new file into `parentId` ('root' for the drive root). Requires Files.ReadWrite.All. */
export async function uploadOneDriveFileToFolder(
  userId: string,
  parentId: string,
  filename: string,
  content: Buffer | Uint8Array | string,
  contentType?: string,
): Promise<DriveItemRef> {
  const path = parentId === 'root'
    ? `/users/${seg(userId)}/drive/root:/${seg(filename)}:/content`
    : `/users/${seg(userId)}/drive/items/${seg(parentId)}:/${seg(filename)}:/content`;
  let req = getGraphClient().api(path);
  if (contentType) req = req.header('Content-Type', contentType);
  const res = await req.put(content) as DriveItemRaw;
  return { id: res.id, name: res.name };
}

/** Rename an item (metadata PATCH). Requires Files.ReadWrite.All. */
export async function renameOneDriveItem(userId: string, itemId: string, newName: string): Promise<void> {
  await getGraphClient().api(`/users/${seg(userId)}/drive/items/${seg(itemId)}`).patch({ name: newName });
}

/** Move an item under a new parent folder. Requires Files.ReadWrite.All. */
export async function moveOneDriveItem(userId: string, itemId: string, newParentId: string): Promise<void> {
  await getGraphClient().api(`/users/${seg(userId)}/drive/items/${seg(itemId)}`).patch({
    parentReference: { id: newParentId },
  });
}

// SharePoint document libraries — requires the Sites.ReadWrite.All application permission.

export async function uploadSharePointFile(siteId: string, path: string, content: Buffer | string): Promise<Record<string, unknown>> {
  return getGraphClient().api(`/sites/${siteId}/drive/root:/${path}:/content`).put(content);
}

export async function deleteSharePointFile(siteId: string, itemId: string): Promise<void> {
  await getGraphClient().api(`/sites/${siteId}/drive/items/${itemId}`).delete();
}

export async function updateSharePointFileMetadata(
  siteId: string,
  itemId: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return getGraphClient().api(`/sites/${siteId}/drive/items/${itemId}`).patch(patch);
}

/** Children endpoint for a SharePoint site folder; root uses its own path segment. */
function siteChildrenPath(siteId: string, folderId: string): string {
  return folderId === 'root'
    ? `/sites/${siteId}/drive/root/children`
    : `/sites/${siteId}/drive/items/${seg(folderId)}/children`;
}

/** Walk the site's default drive breadth-first, up to MAX_ONEDRIVE_SCAN items. */
async function walkSiteDrive(siteId: string): Promise<DriveItemRaw[]> {
  const client = getGraphClient();
  const out: DriveItemRaw[] = [];
  const queue: string[] = ['root'];
  let scanned = 0;

  while (queue.length > 0 && scanned < MAX_ONEDRIVE_SCAN) {
    const parent = queue.shift()!;
    const children = await collectAllPages<DriveItemRaw>(client, siteChildrenPath(siteId, parent), req =>
      req.select('id,name,createdDateTime,file,folder').top(999));
    for (const item of children) {
      scanned++;
      out.push(item);
      if (item.folder) queue.push(item.id);
    }
  }
  return out;
}

/** Every folder in the site's default drive. */
export async function listSharePointFolders(siteId: string): Promise<DriveItemRef[]> {
  const items = await walkSiteDrive(siteId);
  return items.filter(i => i.folder).map(i => ({ id: i.id, name: i.name }));
}

/** Files in the site's default drive, optionally limited to one folder's immediate children. */
export async function listSharePointFiles(siteId: string, folderId?: string): Promise<DriveItemRef[]> {
  if (!folderId || folderId === 'root') {
    const items = await walkSiteDrive(siteId);
    return items.filter(i => i.file).map(i => ({ id: i.id, name: i.name }));
  }
  const children = await collectAllPages<DriveItemRaw>(getGraphClient(), siteChildrenPath(siteId, folderId), req =>
    req.select('id,name,file,folder').top(999));
  return children.filter(i => i.file).map(i => ({ id: i.id, name: i.name }));
}

/** Create a folder under `parentId` ('root' for the drive root). */
export async function createSharePointFolder(siteId: string, parentId: string, name: string): Promise<DriveItemRef> {
  const res = await getGraphClient().api(siteChildrenPath(siteId, parentId)).post({
    name,
    folder: {},
    '@microsoft.graph.conflictBehavior': 'rename',
  }) as DriveItemRaw;
  return { id: res.id, name: res.name };
}

/** Upload a new file into `parentId` ('root' for the drive root). */
export async function uploadSharePointFileToFolder(
  siteId: string,
  parentId: string,
  filename: string,
  content: Buffer | Uint8Array | string,
  contentType?: string,
): Promise<DriveItemRef> {
  const path = parentId === 'root'
    ? `/sites/${siteId}/drive/root:/${seg(filename)}:/content`
    : `/sites/${siteId}/drive/items/${seg(parentId)}:/${seg(filename)}:/content`;
  let req = getGraphClient().api(path);
  if (contentType) req = req.header('Content-Type', contentType);
  const res = await req.put(content) as DriveItemRaw;
  return { id: res.id, name: res.name };
}

/** Rename a SharePoint drive item (metadata PATCH). */
export async function renameSharePointItem(siteId: string, itemId: string, newName: string): Promise<void> {
  await getGraphClient().api(`/sites/${siteId}/drive/items/${seg(itemId)}`).patch({ name: newName });
}

/** Move a SharePoint drive item under a new parent folder. */
export async function moveSharePointItem(siteId: string, itemId: string, newParentId: string): Promise<void> {
  await getGraphClient().api(`/sites/${siteId}/drive/items/${seg(itemId)}`).patch({
    parentReference: { id: newParentId },
  });
}
