import { describe, it, expect } from 'vitest';
import { crc32, inflateRawSync } from 'node:zlib';
import { createZip } from './zip.js';

/** Read entries back through the central directory, the way unzip does. */
function readZip(zip: Buffer): Record<string, string> {
  const end = zip.length - 22;
  expect(zip.readUInt32LE(end)).toBe(0x06054b50);
  const count = zip.readUInt16LE(end + 10);
  let p = zip.readUInt32LE(end + 16);
  const out: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(p)).toBe(0x02014b50);
    const crc = zip.readUInt32LE(p + 16);
    const size = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const local = zip.readUInt32LE(p + 42);
    const name = zip.subarray(p + 46, p + 46 + nameLen).toString('utf-8');
    expect(zip.readUInt32LE(local)).toBe(0x04034b50);
    const start = local + 30 + zip.readUInt16LE(local + 26);
    const data = inflateRawSync(zip.subarray(start, start + size));
    expect(crc32(data)).toBe(crc);
    out[name] = data.toString('utf-8');
    p += 46 + nameLen;
  }
  return out;
}

describe('createZip', () => {
  it('round-trips text and binary entries', () => {
    const zip = createZip([
      { name: 'schedule.json', data: '{"enabled":true}' },
      { name: 'näme.txt', data: Buffer.from('x'.repeat(5000)) },
    ], new Date(2026, 9, 30, 12, 34, 56));
    expect(readZip(zip)).toEqual({ 'schedule.json': '{"enabled":true}', 'näme.txt': 'x'.repeat(5000) });
    // DOS date 2026-10-30 and time 12:34:56 in the first local header.
    expect(zip.readUInt16LE(12)).toBe((46 << 9) | (10 << 5) | 30);
    expect(zip.readUInt16LE(10)).toBe((12 << 11) | (34 << 5) | 28);
  });

  it('writes a valid empty archive', () => {
    expect(readZip(createZip([]))).toEqual({});
  });
});
