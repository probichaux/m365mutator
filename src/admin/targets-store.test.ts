import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadTargets, saveTargets, TARGET_CATEGORIES } from './targets-store.js';

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
      expect(targets[category]).toEqual({ enabled: false, items: [] });
    }
  });

  it('round-trips saved targets', () => {
    saveTargets({
      identities: { enabled: true, items: ['alice@contoso.com'] },
      sharepoint: { enabled: true, items: ['contoso.sharepoint.com/sites/hr'] },
    });
    const targets = loadTargets();
    expect(targets.identities).toEqual({ enabled: true, items: ['alice@contoso.com'] });
    expect(targets.sharepoint).toEqual({ enabled: true, items: ['contoso.sharepoint.com/sites/hr'] });
    expect(targets.mail).toEqual({ enabled: false, items: [] });
  });

  it('trims items, drops empties, and ignores unknown categories and bad shapes', () => {
    const saved = saveTargets({
      mail: { enabled: 'yes', items: ['  bob@contoso.com  ', '', 42, null] },
      bogus: { enabled: true, items: ['x'] },
      calendar: 'nonsense',
    });
    expect(saved.mail).toEqual({ enabled: false, items: ['bob@contoso.com'] });
    expect(saved.calendar).toEqual({ enabled: false, items: [] });
    expect('bogus' in saved).toBe(false);
  });
});
