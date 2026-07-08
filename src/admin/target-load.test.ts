import { describe, it, expect } from 'vitest';
import { hasServicePlan, isMailbox, hasOneDrive, sampleSize, sampleItems } from './target-load.js';
import { DirectoryUser } from '../graph/users.js';

const user = (plans: { service: string; capabilityStatus: string }[]): DirectoryUser => ({
  userPrincipalName: 'u@contoso.com',
  assignedPlans: plans,
});

describe('target-load filters', () => {
  it('hasServicePlan matches service case-insensitively for a provisioned plan', () => {
    const u = user([{ service: 'exchange', capabilityStatus: 'Enabled' }]);
    expect(hasServicePlan(u, 'exchange')).toBe(true);
    expect(hasServicePlan(u, 'Exchange')).toBe(true);
    expect(hasServicePlan(u, 'SharePoint')).toBe(false);
  });

  it('accepts Suspended plans (CDX/demo tenants) but not Deleted ones', () => {
    expect(hasServicePlan(user([{ service: 'exchange', capabilityStatus: 'Suspended' }]), 'exchange')).toBe(true);
    expect(hasServicePlan(user([{ service: 'exchange', capabilityStatus: 'Deleted' }]), 'exchange')).toBe(false);
  });

  it('handles users with no assignedPlans', () => {
    expect(hasServicePlan({ userPrincipalName: 'u@contoso.com' }, 'exchange')).toBe(false);
  });

  it('isMailbox is true for a provisioned Exchange plan', () => {
    expect(isMailbox(user([{ service: 'exchange', capabilityStatus: 'Enabled' }]))).toBe(true);
    expect(isMailbox(user([{ service: 'exchange', capabilityStatus: 'Suspended' }]))).toBe(true);
    expect(isMailbox(user([{ service: 'exchange', capabilityStatus: 'Deleted' }]))).toBe(false);
    expect(isMailbox(user([{ service: 'SharePoint', capabilityStatus: 'Enabled' }]))).toBe(false);
  });

  it('hasOneDrive is true for a provisioned SharePoint plan', () => {
    expect(hasOneDrive(user([{ service: 'SharePoint', capabilityStatus: 'Enabled' }]))).toBe(true);
    expect(hasOneDrive(user([{ service: 'SharePoint', capabilityStatus: 'Suspended' }]))).toBe(true);
    expect(hasOneDrive(user([{ service: 'exchange', capabilityStatus: 'Enabled' }]))).toBe(false);
  });
});

describe('random sampling', () => {
  it('sampleSize rounds to the nearest whole item and never returns 0 for a non-empty pool', () => {
    expect(sampleSize(50, 10)).toBe(5);
    expect(sampleSize(50, 100)).toBe(50);
    expect(sampleSize(50, 1)).toBe(1);   // 0.5 rounds down to 0, floored up to 1
    expect(sampleSize(3, 10)).toBe(1);
    expect(sampleSize(0, 50)).toBe(0);   // empty pool
  });

  it('sampleSize clamps the percentage to [1, 100]', () => {
    expect(sampleSize(50, 0)).toBe(1);
    expect(sampleSize(50, 200)).toBe(50);
  });

  it('sampleItems returns the right count as a subset with no duplicates', () => {
    const pool = Array.from({ length: 50 }, (_, i) => `u${i}@contoso.com`);
    const picked = sampleItems(pool, 10);
    expect(picked).toHaveLength(5);
    expect(new Set(picked).size).toBe(5);            // all distinct
    expect(picked.every(p => pool.includes(p))).toBe(true);
  });

  it('sampleItems handles an empty pool', () => {
    expect(sampleItems([], 25)).toEqual([]);
  });
});
