import { describe, it, expect } from 'vitest';
import { MUTABLE_ATTRIBUTES, pickRandomAttribute } from './user-attributes.js';

describe('user-attributes catalog', () => {
  it('covers the writable scalar attributes and excludes relationships', () => {
    const names = MUTABLE_ATTRIBUTES.map(a => a.name);
    for (const expected of [
      'streetAddress', 'city', 'state', 'postalCode', 'country',
      'businessPhones', 'mobilePhone', 'jobTitle', 'companyName',
      'department', 'employeeId', 'employeeType', 'employeeHireDate', 'officeLocation',
    ]) {
      expect(names).toContain(expected);
    }
    expect(names).not.toContain('manager');
    expect(names).not.toContain('sponsors');
  });

  it('generates a non-empty value of the right shape for every attribute', () => {
    for (const attr of MUTABLE_ATTRIBUTES) {
      const value = attr.generate();
      if (attr.name === 'businessPhones') {
        expect(Array.isArray(value)).toBe(true);
        expect((value as string[]).length).toBeGreaterThan(0);
      } else {
        expect(typeof value).toBe('string');
        expect((value as string).length).toBeGreaterThan(0);
      }
    }
  });

  it('formats employeeHireDate as an ISO 8601 UTC timestamp', () => {
    const attr = MUTABLE_ATTRIBUTES.find(a => a.name === 'employeeHireDate')!;
    expect(attr.generate()).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00Z$/);
  });

  it('pickRandomAttribute always returns a catalog member', () => {
    for (let i = 0; i < 50; i++) {
      expect(MUTABLE_ATTRIBUTES).toContain(pickRandomAttribute());
    }
  });
});
