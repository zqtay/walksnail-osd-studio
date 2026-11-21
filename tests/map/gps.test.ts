import { describe, it, expect } from 'vitest';
import { parseOsd, type OsdData } from '../../src/lib/parsers/osd';
import { extractGpsTrack } from '../../src/lib/map/gps';
import { readFixtureArrayBuffer, sampleBasenames } from '../helpers/fixtures';

const COLS = 53;
const ROWS = 20;

type Line = [row: number, col: number, text: string];

/** Build a synthetic OSD; `{xx}` in text inserts a raw glyph code. */
function syntheticOsd(frames: { t: number; lines: Line[] }[]): OsdData {
  return {
    header: { magic: 'BTFL', unknown32: 0, cols: COLS, rows: ROWS },
    durationMs: frames[frames.length - 1].t,
    frames: frames.map(({ t, lines }) => {
      const glyphs = new Uint16Array(COLS * ROWS).fill(0x20);
      for (const [row, col, text] of lines) {
        const tokens = text.match(/\{[0-9a-f]+\}|./g) ?? [];
        tokens.forEach((tok, i) => {
          glyphs[row * COLS + col + i] = tok.startsWith('{')
            ? parseInt(tok.slice(1, -1), 16)
            : tok.charCodeAt(0);
        });
      }
      return { t, glyphs };
    }),
  };
}

/** Betaflight lat/lon/home-distance elements for one frame. */
function btflFrame(t: number, lat: string, lon: string, home = '-') {
  const lines: Line[] = [
    [1, 40, `{89}${lat}`],
    [2, 40, `{98}${lon}`],
    [2, 20, `{11}${home}`],
  ];
  return { t, lines };
}

describe('extractGpsTrack (AscentG0245 fixture, Betaflight GPS)', () => {
  const osd = parseOsd(readFixtureArrayBuffer('AscentG0245.osd'));
  const track = extractGpsTrack(osd)!;

  it('detects Betaflight coordinates', () => {
    expect(track).toBeDefined();
    expect(track.source).toBe('Betaflight');
    expect(track.points.length).toBeGreaterThan(500);
  });

  it('reads the first fix exactly', () => {
    expect(track.points[0]).toEqual({ t: 0, lat: 1.3088943, lon: 103.868224 });
  });

  it('takes home from the first frame with a home distance (arming)', () => {
    expect(track.homeSource).toBe('arming');
    expect(track.home).toEqual({ lat: 1.3088938, lon: 103.8682237 });
  });

  it('keeps points time-ordered and inside a plausible flight area', () => {
    for (let i = 1; i < track.points.length; i++) {
      expect(track.points[i].t).toBeGreaterThan(track.points[i - 1].t);
    }
    for (const p of track.points) {
      expect(p.lat).toBeGreaterThan(1.3);
      expect(p.lat).toBeLessThan(1.32);
      expect(p.lon).toBeGreaterThan(103.86);
      expect(p.lon).toBeLessThan(103.87);
    }
  });
});

describe.each(sampleBasenames)('extractGpsTrack without GPS elements (%s)', (basename) => {
  it('returns undefined', () => {
    const osd = parseOsd(readFixtureArrayBuffer(`${basename}.osd`));
    expect(extractGpsTrack(osd)).toBeUndefined();
  });
});

describe('extractGpsTrack (synthetic)', () => {
  it('parses negative coordinates', () => {
    const track = extractGpsTrack(
      syntheticOsd([
        btflFrame(0, '-33.8688197', '-151.2092955', '0'),
        btflFrame(200, '-33.8688297', '-151.2093055', '1'),
      ]),
    )!;
    expect(track.points[0]).toMatchObject({ lat: -33.8688197, lon: -151.2092955 });
    expect(track.points).toHaveLength(2);
  });

  it('skips 0,0 placeholders and unparseable values', () => {
    const track = extractGpsTrack(
      syntheticOsd([
        btflFrame(0, '0.0000000', '0.0000000'),
        btflFrame(100, '-', '-'),
        btflFrame(200, '1.3000000', '103.8000000'),
        btflFrame(300, '1.3000100', '103.8000100'),
      ]),
    )!;
    expect(track.points.map((p) => p.t)).toEqual([200, 300]);
    expect(track.homeSource).toBe('first-fix');
  });

  it('collapses repeated values and marks the end of a long hold', () => {
    const frames = [0, 150, 300, 450, 600, 750, 900].map((t) =>
      btflFrame(t, '1.3000000', '103.8000000'),
    );
    frames.push(btflFrame(1050, '1.3000100', '103.8000000'));
    const track = extractGpsTrack(syntheticOsd(frames))!;
    expect(track.points.map((p) => p.t)).toEqual([0, 900, 1050]);
  });

  it('rejects a single implausible jump', () => {
    const track = extractGpsTrack(
      syntheticOsd([
        btflFrame(0, '1.3000000', '103.8000000'),
        btflFrame(150, '1.3000100', '103.8000000'),
        btflFrame(300, '1.3500000', '103.8000000'), // ~5.5 km in 150 ms
        btflFrame(450, '1.3000200', '103.8000000'),
      ]),
    )!;
    expect(track.points.map((p) => p.lat)).toEqual([1.3, 1.30001, 1.30002]);
  });

  it('returns undefined when no coordinates are drawn', () => {
    expect(extractGpsTrack(syntheticOsd([{ t: 0, lines: [[1, 1, 'AIR']] }]))).toBeUndefined();
  });
});
