import { getGraphClient } from './graph-client.js';

/** Requires the User.ReadWrite.All application permission. */
export async function getUser(userId: string): Promise<Record<string, unknown>> {
  return getGraphClient().api(`/users/${userId}`).get();
}

/** Requires the User.ReadWrite.All application permission. */
export async function updateUser(userId: string, patch: Record<string, unknown>): Promise<void> {
  await getGraphClient().api(`/users/${userId}`).patch(patch);
}
