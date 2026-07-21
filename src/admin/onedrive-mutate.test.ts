import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Graph + content layers so mutateOneDrive runs without a tenant or network.
vi.mock('../graph/files.js', () => ({
  listOneDriveFolders: vi.fn().mockResolvedValue([]),
  listOneDriveFiles: vi.fn().mockResolvedValue([]),
  createOneDriveFolder: vi.fn().mockResolvedValue({ id: 'newfolder', name: 'newfolder' }),
  uploadOneDriveFileToFolder: vi.fn().mockResolvedValue({ id: 'up1', name: 'x' }),
  renameOneDriveItem: vi.fn().mockResolvedValue(undefined),
  moveOneDriveItem: vi.fn().mockResolvedValue(undefined),
  deleteOneDriveFile: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./random-text.js', () => ({
  generateText: vi.fn().mockResolvedValue('text'),
  subjectPrompt: () => 's',
  bodyPrompt: () => 'b',
}));
vi.mock('./doc-gen.js', () => ({
  generateDocument: vi.fn().mockResolvedValue({ content: new Uint8Array([1, 2]), extension: 'pdf', contentType: 'application/pdf' }),
}));
vi.mock('./wikimedia.js', () => ({
  fetchRandomImage: vi.fn().mockResolvedValue({ buffer: Buffer.from([1]), filename: 'pic.jpg', contentType: 'image/jpeg' }),
}));

import { listOneDriveFolders, listOneDriveFiles } from '../graph/files.js';
import { pickOneDriveOp, renameKeepingExtension, mutateOneDrive, OneDriveOp } from './onedrive-mutate.js';

describe('pickOneDriveOp', () => {
  const pick = (r: number) => pickOneDriveOp(() => r);
  it('maps the random range to the weighted operations', () => {
    expect(pick(0)).toBe('createText');     // [0,20)
    expect(pick(0.20)).toBe('createDoc');    // [20,40)
    expect(pick(0.40)).toBe('rename');       // [40,50)
    expect(pick(0.50)).toBe('createFolder'); // [50,60)
    expect(pick(0.60)).toBe('remove');       // [60,75)
    expect(pick(0.75)).toBe('folderMove');   // [75,85)
    expect(pick(0.85)).toBe('image');        // [85,100)
    expect(pick(0.999)).toBe('image');
  });

  it('matches the configured weights over an even sweep', () => {
    const counts: Record<OneDriveOp, number> = {
      createText: 0, createDoc: 0, rename: 0, createFolder: 0, remove: 0, folderMove: 0, image: 0,
    };
    const n = 20000;
    for (let i = 0; i < n; i++) counts[pickOneDriveOp(() => i / n)]++;
    expect(counts.createText / n).toBeCloseTo(0.20, 2);
    expect(counts.createDoc / n).toBeCloseTo(0.20, 2);
    expect(counts.rename / n).toBeCloseTo(0.10, 2);
    expect(counts.createFolder / n).toBeCloseTo(0.10, 2);
    expect(counts.remove / n).toBeCloseTo(0.15, 2);
    expect(counts.folderMove / n).toBeCloseTo(0.10, 2);
    expect(counts.image / n).toBeCloseTo(0.15, 2);
  });
});

describe('renameKeepingExtension', () => {
  it('keeps the extension and swaps the base', () => {
    expect(renameKeepingExtension('report.txt', 'mutator-1')).toBe('mutator-1.txt');
    expect(renameKeepingExtension('a.b.c', 'x')).toBe('x.c');
  });
  it('returns just the base when there is no usable extension', () => {
    expect(renameKeepingExtension('noext', 'y')).toBe('y');
    expect(renameKeepingExtension('.env', 'z')).toBe('z');
  });
});

describe('mutateOneDrive', () => {
  beforeEach(() => {
    vi.mocked(listOneDriveFolders).mockResolvedValue([]);
    vi.mocked(listOneDriveFiles).mockResolvedValue([]);
  });

  it('performs runs × users actions', async () => {
    vi.mocked(listOneDriveFolders).mockResolvedValue([{ id: 'F', name: 'Docs' }]);
    vi.mocked(listOneDriveFiles).mockResolvedValue([{ id: 'x1', name: 'a.txt' }]);
    const run = await mutateOneDrive(['a@x.com', 'b@x.com'], 3);
    expect(run.runs).toBe(3);
    expect(run.totalActions).toBe(6);
    expect(run.ok).toBe(6);
    expect(run.failed).toBe(0);
  });

  it('falls back to createText when the drive has no item to act on', async () => {
    // With an empty drive, rename/remove/folderMove cannot run and must fall back —
    // so those op labels never appear, and nothing fails.
    const run = await mutateOneDrive(['a@x.com', 'b@x.com'], 40);
    expect(run.failed).toBe(0);
    const ops = new Set(run.results.map(r => r.op));
    expect(ops.has('rename')).toBe(false);
    expect(ops.has('remove')).toBe(false);
    expect(ops.has('folderMove')).toBe(false);
  });

  it('clamps runs to [1, 999]', async () => {
    expect((await mutateOneDrive(['a@x.com'], 0)).runs).toBe(1);
    expect((await mutateOneDrive(['a@x.com'], 5000)).runs).toBe(999);
  });
});
