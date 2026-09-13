import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  parseOsd,
  osdFrameIndexAt,
  OSD_HEADER_SIZE,
  OsdParseError,
} from '../osd';

const sampleUrl = new URL('../../../docs/examples/AscentG0177.osd', import.meta.url);
const samplePath = fileURLToPath(sampleUrl);

function readSample(): ArrayBuffer {
  const buf = readFileSync(samplePath);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

describe('parseOsd (sample AscentG0177.osd)', () => {
  const data = parseOsd(readSample());

  it('reads the header', () => {
    expect(data.header.magic).toBe('BTFL');
    expect(data.header.cols).toBe(53);
    expect(data.header.rows).toBe(20);
    expect(data.header.unknown32).toBe(200);
  });

  it('decodes the expected frame count and duration', () => {
    expect(data.frames.length).toBe(575);
    expect(data.durationMs).toBe(85773);
  });

  it('has correct known timestamps for the first frames', () => {
    expect(data.frames.slice(0, 6).map((f) => f.t)).toEqual([
      0, 115, 259, 413, 570, 718,
    ]);
  });

  it('each frame has cols*rows glyphs', () => {
    expect(data.frames[0].glyphs.length).toBe(53 * 20);
  });
});

describe('osdFrameIndexAt (step/hold)', () => {
  const frames = [
    { t: 0, glyphs: new Uint16Array(0) },
    { t: 100, glyphs: new Uint16Array(0) },
    { t: 250, glyphs: new Uint16Array(0) },
  ];

  it('returns -1 before the first frame', () => {
    expect(osdFrameIndexAt(frames, -1)).toBe(-1);
  });

  it('holds the last frame at/under the time', () => {
    expect(osdFrameIndexAt(frames, 0)).toBe(0);
    expect(osdFrameIndexAt(frames, 99)).toBe(0);
    expect(osdFrameIndexAt(frames, 100)).toBe(1);
    expect(osdFrameIndexAt(frames, 249)).toBe(1);
    expect(osdFrameIndexAt(frames, 100000)).toBe(2);
  });
});

describe('parseOsd error handling', () => {
  it('rejects files smaller than the header', () => {
    expect(() => parseOsd(new ArrayBuffer(OSD_HEADER_SIZE - 1))).toThrow(
      OsdParseError,
    );
  });

  it('rejects data that is not a multiple of frameSize', () => {
    const buf = readSample();
    const truncated = buf.slice(0, buf.byteLength - 10);
    expect(() => parseOsd(truncated)).toThrow(OsdParseError);
  });
});
