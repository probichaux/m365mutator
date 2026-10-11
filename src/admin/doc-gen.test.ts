import { describe, it, expect } from 'vitest';
import { generatePdf, generateDocx, generateDocument } from './doc-gen.js';

describe('generatePdf', () => {
  it('emits a valid PDF (magic bytes %PDF-)', async () => {
    const bytes = await generatePdf('A title', 'Some body text.');
    expect(bytes.length).toBeGreaterThan(0);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
  });

  it('does not throw on unicode the PDF standard fonts cannot encode', async () => {
    await expect(
      generatePdf('Smart “quotes” — dash', 'Body with … ellipsis, é, and 漢字.'),
    ).resolves.toBeInstanceOf(Uint8Array);
  });

  it('wraps long text across a page without error', async () => {
    const long = 'word '.repeat(2000);
    const bytes = await generatePdf('Long', long);
    expect(bytes.length).toBeGreaterThan(0);
  });
});

describe('generateDocx', () => {
  it('emits a valid .docx (zip magic bytes PK\\x03\\x04)', async () => {
    const bytes = await generateDocx('A title', 'Some body text.');
    expect(bytes.length).toBeGreaterThan(0);
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });
});

describe('generateDocument', () => {
  it('tags each kind with the right extension and content type', async () => {
    const pdf = await generateDocument('pdf', 't', 'b');
    expect(pdf.extension).toBe('pdf');
    expect(pdf.contentType).toBe('application/pdf');

    const docx = await generateDocument('docx', 't', 'b');
    expect(docx.extension).toBe('docx');
    expect(docx.contentType).toContain('wordprocessingml');
  });
});
