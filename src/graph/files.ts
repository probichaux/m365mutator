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

export async function uploadOneDriveFile(userId: string, path: string, content: Buffer | string): Promise<Record<string, unknown>> {
  return getGraphClient().api(`/users/${userId}/drive/root:/${path}:/content`).put(content);
}

export async function deleteOneDriveFile(userId: string, itemId: string): Promise<void> {
  await getGraphClient().api(`/users/${userId}/drive/items/${itemId}`).delete();
}

/**
 * Walk a user's OneDrive breadth-first and return the files whose createdDateTime
 * falls within `range` (an empty range matches every file). Drive items have no
 * server-side createdDateTime filter, so folders are traversed and files matched
 * client-side. The scan is capped at MAX_ONEDRIVE_SCAN items. Requires
 * Files.ReadWrite.All.
 */
export async function listOneDriveItemsByDate(userId: string, range: DateRange = {}): Promise<DriveItemRef[]> {
  const client = getGraphClient();
  const out: DriveItemRef[] = [];
  const queue: string[] = ['root'];
  let scanned = 0;

  while (queue.length > 0 && scanned < MAX_ONEDRIVE_SCAN) {
    const parent = queue.shift()!;
    const path = parent === 'root'
      ? `/users/${seg(userId)}/drive/root/children`
      : `/users/${seg(userId)}/drive/items/${seg(parent)}/children`;
    const children = await collectAllPages<DriveItemRaw>(client, path, req =>
      req.select('id,name,createdDateTime,file,folder').top(999));
    for (const item of children) {
      scanned++;
      if (item.folder) { queue.push(item.id); continue; }
      if (item.file && inRange(item.createdDateTime, range)) out.push({ id: item.id, name: item.name });
    }
  }
  return out;
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
