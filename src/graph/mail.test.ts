import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// A fake Graph client that records every request by path and method.
const graph = vi.hoisted(() => ({
  calls: [] as { method: string; path: string; body?: unknown }[],
  fail: new Set<string>(), // "METHOD path" entries that should reject
}));
vi.mock('./graph-client.js', () => ({
  getGraphClient: () => ({
    api: (path: string) => {
      const call = async (method: string, body?: unknown) => {
        graph.calls.push({ method, path, body });
        if (graph.fail.has(`${method} ${path}`)) throw Object.assign(new Error(`${method} ${path} failed`), { statusCode: 500 });
        if (method === 'POST' && path.endsWith('/messages')) return { id: 'draft-1' };
        if (method === 'POST' && path.endsWith('/createUploadSession')) return { uploadUrl: 'https://upload.example/session' };
        return {};
      };
      return { post: (body: unknown) => call('POST', body), delete: () => call('DELETE') };
    },
  }),
}));

import { sendMailWithAttachment } from './mail.js';
import { throttleSnapshot, throttleDelta } from './throttle-stats.js';

const message = { subject: 's', body: { contentType: 'Text' as const, content: 'b' }, toRecipients: [] };
const attachment = (mb: number) => ({ name: 'a.bin', contentType: 'application/octet-stream', bytes: Buffer.alloc(mb * 1024 * 1024) });
const draftPath = '/users/u%40x.com/messages/draft-1';

type Upload = { range: string; length: number; bodyUsed: boolean };
const uploads: Upload[] = [];
let responses: (() => Response)[] = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  graph.calls.length = 0;
  graph.fail.clear();
  uploads.length = 0;
  responses = [];
  globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string>;
    const res = (responses.shift() ?? (() => new Response('{}', { status: 200 })))();
    const entry: Upload = { range: headers['Content-Range'], length: Number(headers['Content-Length']), bodyUsed: false };
    uploads.push(entry);
    // Report whether the caller drained the body before moving on.
    Object.defineProperty(res, 'arrayBuffer', {
      value: async () => { entry.bodyUsed = true; return new ArrayBuffer(0); },
    });
    return res;
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('sendMailWithAttachment', () => {
  it('attaches small files inline, then sends', async () => {
    await sendMailWithAttachment('u@x.com', message, attachment(1));
    expect(graph.calls.map(c => `${c.method} ${c.path}`)).toEqual([
      'POST /users/u%40x.com/messages',
      `POST ${draftPath}/attachments`,
      `POST ${draftPath}/send`,
    ]);
    expect(uploads.length).toBe(0);
  });

  it('uploads large files in ranges that are multiples of 320 KiB and drains each response', async () => {
    await sendMailWithAttachment('u@x.com', message, attachment(8));
    expect(uploads.length).toBeGreaterThan(1);
    const total = 8 * 1024 * 1024;
    let expectedStart = 0;
    for (const [i, u] of uploads.entries()) {
      const [, start, end, size] = u.range.match(/^bytes (\d+)-(\d+)\/(\d+)$/)!.map(Number);
      expect(start).toBe(expectedStart);
      expect(size).toBe(total);
      expect(u.length).toBe(end - start + 1);
      if (i < uploads.length - 1) expect(u.length % (320 * 1024)).toBe(0);
      expect(u.length).toBeLessThan(4 * 1024 * 1024);
      expect(u.bodyUsed).toBe(true);
      expectedStart = end + 1;
    }
    expect(expectedStart).toBe(total);
    expect(graph.calls.at(-1)).toMatchObject({ method: 'POST', path: `${draftPath}/send` });
  });

  it('deletes the draft when the send itself fails', async () => {
    graph.fail.add(`POST ${draftPath}/send`);
    await expect(sendMailWithAttachment('u@x.com', message, attachment(1))).rejects.toThrow('send failed');
    expect(graph.calls.at(-1)).toMatchObject({ method: 'DELETE', path: draftPath });
  });

  it('counts a throttled upload that exhausts its retries, then deletes the draft', async () => {
    const before = throttleSnapshot();
    const throttled = () => new Response(null, { status: 429, headers: { 'Retry-After': '0' } });
    responses = Array.from({ length: 11 }, () => throttled); // first try plus ten retries
    await expect(sendMailWithAttachment('u@x.com', message, attachment(4))).rejects.toThrow('HTTP 429');
    expect(uploads.length).toBe(11);
    expect(uploads.every(u => u.bodyUsed)).toBe(true);
    expect(throttleDelta(before, throttleSnapshot())).toMatchObject({ events: 11, tooMany: 11, lastSource: 'upload' });
    expect(graph.calls.at(-1)).toMatchObject({ method: 'DELETE', path: draftPath });
  });
});
