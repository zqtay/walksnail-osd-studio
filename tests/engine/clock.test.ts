import { describe, it, expect } from 'vitest';
import {
  activeOsdFrame,
  activeSrtCue,
  clampMs,
  formatMs,
} from '../../src/engine/clock';
import type { OsdData } from '../../src/parsers/osd';
import type { SrtData } from '../../src/parsers/srt';

const osd: OsdData = {
  header: { magic: 'BTFL', unknown32: 0, cols: 1, rows: 1 },
  frames: [
    { t: 0, glyphs: new Uint16Array([1]) },
    { t: 100, glyphs: new Uint16Array([2]) },
    { t: 250, glyphs: new Uint16Array([3]) },
  ],
  durationMs: 250,
};

const srt: SrtData = {
  cues: [
    { index: 1, start: 0, end: 100, fields: { Signal: 4 }, raw: '' },
    { index: 2, start: 100, end: 250, fields: { Signal: 3 }, raw: '' },
  ],
  durationMs: 250,
};

describe('activeOsdFrame', () => {
  it('returns undefined before the first frame', () => {
    expect(activeOsdFrame(osd, -1)).toBeUndefined();
  });

  it('holds the active frame (step/hold)', () => {
    expect(activeOsdFrame(osd, 0)?.glyphs[0]).toBe(1);
    expect(activeOsdFrame(osd, 99)?.glyphs[0]).toBe(1);
    expect(activeOsdFrame(osd, 100)?.glyphs[0]).toBe(2);
    expect(activeOsdFrame(osd, 9999)?.glyphs[0]).toBe(3);
  });

  it('applies the sync offset', () => {
    // With +100ms offset, video time 100 maps to osd time 0.
    expect(activeOsdFrame(osd, 100, 100)?.glyphs[0]).toBe(1);
  });

  it('returns undefined when data is missing', () => {
    expect(activeOsdFrame(undefined, 0)).toBeUndefined();
  });
});

describe('activeSrtCue', () => {
  it('selects the active cue by start time', () => {
    expect(activeSrtCue(srt, 0)?.fields.Signal).toBe(4);
    expect(activeSrtCue(srt, 150)?.fields.Signal).toBe(3);
  });

  it('applies the sync offset', () => {
    expect(activeSrtCue(srt, 150, 100)?.fields.Signal).toBe(4);
  });
});

describe('clampMs', () => {
  it('clamps into range', () => {
    expect(clampMs(-5, 0, 10)).toBe(0);
    expect(clampMs(5, 0, 10)).toBe(5);
    expect(clampMs(15, 0, 10)).toBe(10);
  });
});

describe('formatMs', () => {
  it('formats minutes, seconds and millis', () => {
    expect(formatMs(0)).toBe('0:00.000');
    expect(formatMs(1234)).toBe('0:01.234');
    expect(formatMs(65_500)).toBe('1:05.500');
    expect(formatMs(-1000)).toBe('-0:01.000');
  });
});
