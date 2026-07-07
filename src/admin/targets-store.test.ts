import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadTargets, saveTargets, saveTargetCategory, TARGET_CATEGORIES } from './targets-store.js';

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'm365mutator-targets-'));
  process.env.M365MUTATOR_DATA_DIR = dataDir;
});

afterEach(() => {
  delete process.env.M365MUTATOR_DATA_DIR;
  rmSync(dataDir, { recursive: true, force: true });
});

describe('targets-store', () => {
  it('returns all categories disabled and empty when nothing is saved', () => {
    const targets = loadTargets();
    for (const category of TARGET_CATEGORIES) {
      expect(targets[category]).toMatchObject({ enabled: false, items: [] });
    }
  });

  it('round-trips saved targets', () => {
    saveTargets({
      identities: { enabled: true, items: ['alice@contoso.com'] },
      sharepoint: { enabled: true, items: ['contoso.sharepoint.com/sites/hr'] },
    });
    const targets = loadTargets();
    expect(targets.identities).toMatchObject({ enabled: true, items: ['alice@contoso.com'] });
    expect(targets.sharepoint).toMatchObject({ enabled: true, items: ['contoso.sharepoint.com/sites/hr'] });
    expect(targets.mail).toMatchObject({ enabled: false, items: [] });
  });

  it('trims items, drops empties, and ignores unknown categories and bad shapes', () => {
    const saved = saveTargets({
      mail: { enabled: 'yes', items: ['  bob@contoso.com  ', '', 42, null] },
      bogus: { enabled: true, items: ['x'] },
      calendar: 'nonsense',
    });
    expect(saved.mail).toMatchObject({ enabled: false, items: ['bob@contoso.com'] });
    expect(saved.calendar).toMatchObject({ enabled: false, items: [] });
    expect('bogus' in saved).toBe(false);
  });
});

describe('saveTargetCategory', () => {
  it('updates one category and preserves the others', () => {
    saveTargets({
      identities: { enabled: true, items: ['alice@contoso.com'] },
      mail: { enabled: true, items: ['bob@contoso.com'] },
    });

    const after = saveTargetCategory('mail', { enabled: false, items: ['carol@contoso.com'] });

    expect(after.mail).toMatchObject({ enabled: false, items: ['carol@contoso.com'] });
    // identities is untouched by the mail write
    expect(after.identities).toMatchObject({ enabled: true, items: ['alice@contoso.com'] });
    expect(loadTargets().identities).toMatchObject({ enabled: true, items: ['alice@contoso.com'] });
  });

  it('keeps the existing enabled flag when only items are provided', () => {
    saveTargetCategory('calendar', { enabled: true, items: ['x@contoso.com'] });
    const after = saveTargetCategory('calendar', { items: ['y@contoso.com', 'z@contoso.com'] });
    expect(after.calendar).toMatchObject({ enabled: true, items: ['y@contoso.com', 'z@contoso.com'] });
  });

  it('keeps the existing items when only enabled is provided', () => {
    saveTargetCategory('onedrive', { enabled: false, items: ['u@contoso.com'] });
    const after = saveTargetCategory('onedrive', { enabled: true });
    expect(after.onedrive).toMatchObject({ enabled: true, items: ['u@contoso.com'] });
  });

  it('sanitizes items passed to a category update', () => {
    // trims whitespace and drops empty/non-string entries
    const after = saveTargetCategory('identities', { enabled: true, items: ['  a@b.com  ', '', 7] as unknown[] });
    expect(after.identities).toEqual({ enabled: true, items: ['a@b.com'], runStyle: 'explicit', randomPercent: 10 });
  });

  it('persists and clamps runStyle and randomPercent', () => {
    const a = saveTargetCategory('mail', { runStyle: 'random', randomPercent: 250 });
    expect(a.mail.runStyle).toBe('random');
    expect(a.mail.randomPercent).toBe(100); // clamped to 100

    const b = saveTargetCategory('mail', { randomPercent: 0 });
    expect(b.mail.runStyle).toBe('random'); // preserved from the previous write
    expect(b.mail.randomPercent).toBe(1);   // clamped up to 1

    const c = saveTargetCategory('mail', { runStyle: 'explicit' });
    expect(c.mail.runStyle).toBe('explicit');
    expect(c.mail.randomPercent).toBe(1);   // unchanged
  });

  it('defaults runStyle to explicit and randomPercent to 10 for fresh categories', () => {
    const targets = loadTargets();
    expect(targets.identities.runStyle).toBe('explicit');
    expect(targets.identities.randomPercent).toBe(10);
  });
});
