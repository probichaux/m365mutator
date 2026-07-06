import { getGraphClient } from './graph-client.js';
import { collectAllPages } from './graph-paginate.js';

/** Requires the User.ReadWrite.All application permission. */
export async function getUser(userId: string): Promise<Record<string, unknown>> {
  return getGraphClient().api(`/users/${userId}`).get();
}

/** Requires the User.ReadWrite.All application permission. */
export async function updateUser(userId: string, patch: Record<string, unknown>): Promise<void> {
  await getGraphClient().api(`/users/${userId}`).patch(patch);
}

/** A service plan assigned to a user, e.g. Exchange Online or SharePoint/OneDrive. */
export interface AssignedPlan {
  service?: string;
  capabilityStatus?: string;
}

/** The subset of user fields the Targets "Load" feature needs to filter by workload. */
export interface DirectoryUser {
  userPrincipalName?: string;
  mail?: string | null;
  accountEnabled?: boolean;
  assignedPlans?: AssignedPlan[];
}

/**
 * List every user in the tenant, paginated. Selects only the fields the Targets
 * page filters on. Requires the User.Read.All (or User.ReadWrite.All) application
 * permission.
 */
export async function listAllUsers(): Promise<DirectoryUser[]> {
  return collectAllPages<DirectoryUser>(getGraphClient(), '/users', (req) =>
    req.select(['userPrincipalName', 'mail', 'accountEnabled', 'assignedPlans']).top(999),
  );
}
