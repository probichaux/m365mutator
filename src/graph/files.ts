import { getGraphClient } from './graph-client.js';

// OneDrive (a user's personal drive) — requires the Files.ReadWrite.All application permission.

export async function uploadOneDriveFile(userId: string, path: string, content: Buffer | string): Promise<Record<string, unknown>> {
  return getGraphClient().api(`/users/${userId}/drive/root:/${path}:/content`).put(content);
}

export async function deleteOneDriveFile(userId: string, itemId: string): Promise<void> {
  await getGraphClient().api(`/users/${userId}/drive/items/${itemId}`).delete();
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
