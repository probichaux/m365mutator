// Generate real Word (.docx) and PDF documents from a title + body of text.

import { PDFDocument, StandardFonts, PDFFont } from 'pdf-lib';
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';

export type DocKind = 'pdf' | 'docx';

export const PDF_CONTENT_TYPE = 'application/pdf';
export const DOCX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export interface GeneratedDoc {
  content: Uint8Array;
  extension: string;
  contentType: string;
}

const PAGE: [number, number] = [612, 792]; // US Letter, points
const MARGIN = 72;
const BODY_SIZE = 12;
const TITLE_SIZE = 18;
const LINE_HEIGHT = 16;

/**
 * The PDF standard fonts are WinAnsi-encoded and throw on characters they can't
 * represent (curly quotes, em dashes, non-Latin glyphs are common in LLM text).
 * Normalize the usual punctuation and drop anything still outside Latin-1.
 */
function sanitizeForPdf(text: string): string {
  return text
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\x00-\xFF]/g, '');
}

/** Greedily wrap `text` to lines no wider than `maxWidth` at the given font/size. */
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const trial = current ? `${current} ${word}` : word;
    if (current && font.widthOfTextAtSize(trial, size) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = trial;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

export async function generatePdf(title: string, body: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const maxWidth = PAGE[0] - MARGIN * 2;

  let page = pdf.addPage(PAGE);
  let y = PAGE[1] - MARGIN;
  const draw = (text: string, f: PDFFont, size: number) => {
    if (y < MARGIN) {
      page = pdf.addPage(PAGE);
      y = PAGE[1] - MARGIN;
    }
    page.drawText(text, { x: MARGIN, y, size, font: f });
    y -= LINE_HEIGHT;
  };

  for (const line of wrapText(sanitizeForPdf(title), bold, TITLE_SIZE, maxWidth)) draw(line, bold, TITLE_SIZE);
  y -= 8;
  for (const para of sanitizeForPdf(body).split(/\n+/)) {
    for (const line of wrapText(para, font, BODY_SIZE, maxWidth)) draw(line, font, BODY_SIZE);
    y -= 6;
  }

  return pdf.save();
}

export async function generateDocx(title: string, body: string): Promise<Uint8Array> {
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ text: title, heading: HeadingLevel.HEADING_1 }),
        ...body.split(/\n+/).map(p => new Paragraph({ children: [new TextRun(p)] })),
      ],
    }],
  });
  const buffer = await Packer.toBuffer(doc);
  return new Uint8Array(buffer);
}

/** Build a document of the requested kind; returns bytes plus its extension and MIME type. */
export async function generateDocument(kind: DocKind, title: string, body: string): Promise<GeneratedDoc> {
  if (kind === 'pdf') {
    return { content: await generatePdf(title, body), extension: 'pdf', contentType: PDF_CONTENT_TYPE };
  }
  return { content: await generateDocx(title, body), extension: 'docx', contentType: DOCX_CONTENT_TYPE };
}
