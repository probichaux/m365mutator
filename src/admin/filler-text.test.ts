import { describe, it, expect } from 'vitest';
import { fillerText } from './filler-text.js';

describe('fillerText', () => {
  it('returns exactly the requested number of bytes', () => {
    for (const n of [1, 100, 4096, 256 * 1024]) {
      const text = fillerText(n);
      expect(Buffer.byteLength(text)).toBe(n);
    }
  });

  it('produces readable sentences split into paragraphs', () => {
    const text = fillerText(8192);
    expect(text).toMatch(/^[A-Z][a-z]/);
    expect(text).toContain('.');
    expect(text).toContain('\n\n');
  });
});
