import { describe, it, expect } from 'vitest';
import {
  parseOsd,
  osdFrameIndexAt,
  OSD_HEADER_SIZE,
  OsdParseError,
} from '../../src/lib/parsers/osd';
import { readOsd, sampleBasenames } from '../helpers/fixtures';

/** Exact expected values for known fixtures. */
const EXPECTED: Record<
  string,
  { cols: number; rows: number; frames: number; lastTs: number; firstTs: number[] }
> = {
  AscentG0177: {
    cols: 53,
    rows: 20,
    frames: 575,
    lastTs: 85773,
    firstTs: [0, 115, 259, 413, 570, 718],
  },
  AscentG0138: {
    cols: 53,
    rows: 20,
    frames: 1526,
    lastTs: 231511,
    firstTs: [0, 142, 282, 425, 575, 730],
  },
  AscentG0149: {
    cols: 53,
    rows: 20,
    frames: 807,
    lastTs: 120668,
    firstTs: [0, 137, 289, 430, 581, 741],
  },
};

// Structural invariants that must hold for every capture fixture.
describe.each(sampleBasenames)('parseOsd invariants (%s)', (basename) => {
  const data = parseOsd(readOsd(basename));

  it('has the BTFL magic', () => {
    expect(data.header.magic).toBe('BTFL');
  });

  it('has a positive, sensible grid', () => {
    expect(data.header.cols).toBeGreaterThan(0);
    expect(data.header.rows).toBeGreaterThan(0);
  });

  it('every frame has cols*rows glyphs', () => {
    const cells = data.header.cols * data.header.rows;
    for (const f of data.frames) expect(f.glyphs.length).toBe(cells);
  });

  it('timestamps are non-decreasing and duration matches the last frame', () => {
    for (let i = 1; i < data.frames.length; i++) {
      expect(data.frames[i].t).toBeGreaterThanOrEqual(data.frames[i - 1].t);
    }
    expect(data.durationMs).toBe(data.frames[data.frames.length - 1].t);
  });
});

// Exact known values for recognized fixtures.
describe.each(Object.keys(EXPECTED))('parseOsd known values (%s)', (basename) => {
  const exp = EXPECTED[basename];
  const data = parseOsd(readOsd(basename));

  it('matches header grid', () => {
    expect(data.header.cols).toBe(exp.cols);
    expect(data.header.rows).toBe(exp.rows);
  });

  it('matches frame count and duration', () => {
    expect(data.frames.length).toBe(exp.frames);
    expect(data.durationMs).toBe(exp.lastTs);
  });

  it('matches the first frame timestamps', () => {
    expect(data.frames.slice(0, exp.firstTs.length).map((f) => f.t)).toEqual(
      exp.firstTs,
    );
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
    const buf = readOsd(sampleBasenames[0]);
    const truncated = buf.slice(0, buf.byteLength - 10);
    expect(() => parseOsd(truncated)).toThrow(OsdParseError);
  });
});
