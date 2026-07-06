import { describe, it, expect } from 'vitest';
import { hasServicePlan, isMailbox, hasOneDrive } from './target-load.js';
import { DirectoryUser } from '../graph/users.js';

const user = (plans: { service: string; capabilityStatus: string }[]): DirectoryUser => ({
  userPrincipalName: 'u@contoso.com',
  assignedPlans: plans,
});

describe('target-load filters', () => {
  it('hasServicePlan matches service case-insensitively and requires Enabled status', () => {
    const u = user([{ service: 'exchange', capabilityStatus: 'Enabled' }]);
    expect(hasServicePlan(u, 'exchange')).toBe(true);
    expect(hasServicePlan(u, 'Exchange')).toBe(true);
    expect(hasServicePlan(u, 'SharePoint')).toBe(false);
  });

  it('ignores plans that are not Enabled', () => {
    const u = user([{ service: 'exchange', capabilityStatus: 'Deleted' }]);
    expect(hasServicePlan(u, 'exchange')).toBe(false);
  });

  it('handles users with no assignedPlans', () => {
    expect(hasServicePlan({ userPrincipalName: 'u@contoso.com' }, 'exchange')).toBe(false);
  });

  it('isMailbox is true only for an enabled Exchange plan', () => {
    expect(isMailbox(user([{ service: 'exchange', capabilityStatus: 'Enabled' }]))).toBe(true);
    expect(isMailbox(user([{ service: 'SharePoint', capabilityStatus: 'Enabled' }]))).toBe(false);
  });

  it('hasOneDrive is true only for an enabled SharePoint plan', () => {
    expect(hasOneDrive(user([{ service: 'SharePoint', capabilityStatus: 'Enabled' }]))).toBe(true);
    expect(hasOneDrive(user([{ service: 'exchange', capabilityStatus: 'Enabled' }]))).toBe(false);
  });
});
