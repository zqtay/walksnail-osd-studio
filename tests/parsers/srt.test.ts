import { describe, it, expect } from 'vitest';
import { parseSrt, srtCueIndexAt, SrtParseError } from '../../src/lib/parsers/srt';
import { readSrt, sampleBasenames } from '../helpers/fixtures';

const KNOWN_KEYS = [
  'Bitrate',
  'CH',
  'Delay',
  'Distance',
  'FlightTime',
  'GBat',
  'Gp',
  'Hz',
  'SBat',
  'Signal',
  'Sp',
];

/** Exact expected values for known fixtures. */
const EXPECTED: Record<
  string,
  { cues: number; firstEnd: number; firstFields: Record<string, number> }
> = {
  AscentG0177: {
    cues: 575, // index 574 appears twice in this sample
    firstEnd: 134,
    firstFields: {
      Signal: 4,
      CH: 1,
      Hz: 5475000,
      FlightTime: 0,
      Sp: 26,
      Gp: 30,
      SBat: 9.7,
      GBat: 11.9,
      Delay: 47,
      Bitrate: 25.0,
      Distance: 10,
    },
  },
  AscentG0138: {
    cues: 1526,
    firstEnd: 133,
    firstFields: {
      Signal: 4,
      CH: 8,
      Hz: 5740000,
      FlightTime: 0,
      Sp: 13,
      Gp: 14,
      SBat: 9.9,
      GBat: 12.0,
      Delay: 48,
      Bitrate: 25.0,
      Distance: 9,
    },
  },
  AscentG0149: {
    cues: 807,
    firstEnd: 134,
    firstFields: {
      Signal: 4,
      CH: 8,
      Hz: 5740000,
      FlightTime: 0,
      Sp: 0,
      Gp: 14,
      SBat: 9.9,
      GBat: 12.0,
      Delay: 46,
      Bitrate: 25.0,
      Distance: 0,
    },
  },
};

// Structural invariants that must hold for every SRT fixture.
describe.each(sampleBasenames)('parseSrt invariants (%s)', (basename) => {
  const data = parseSrt(readSrt(basename));

  it('parses at least one cue', () => {
    expect(data.cues.length).toBeGreaterThan(0);
  });

  it('cue start times are non-decreasing', () => {
    for (let i = 1; i < data.cues.length; i++) {
      expect(data.cues[i].start).toBeGreaterThanOrEqual(data.cues[i - 1].start);
    }
  });

  it('every cue has the 11 known telemetry keys as numbers', () => {
    for (const cue of data.cues) {
      for (const key of KNOWN_KEYS) {
        expect(typeof cue.fields[key]).toBe('number');
      }
    }
  });
});

// Exact known values for recognized fixtures.
describe.each(Object.keys(EXPECTED))('parseSrt known values (%s)', (basename) => {
  const exp = EXPECTED[basename];
  const data = parseSrt(readSrt(basename));

  it('parses the expected number of cues', () => {
    expect(data.cues.length).toBe(exp.cues);
  });

  it('parses the first cue timing and fields', () => {
    const first = data.cues[0];
    expect(first.index).toBe(1);
    expect(first.start).toBe(0);
    expect(first.end).toBe(exp.firstEnd);
    expect(first.fields).toMatchObject(exp.firstFields);
  });

  it('has exactly the 11 known keys on the first cue', () => {
    expect(Object.keys(data.cues[0].fields).sort()).toEqual([...KNOWN_KEYS].sort());
  });
});

describe('srtCueIndexAt', () => {
  const data = parseSrt(readSrt(sampleBasenames[0]));

  it('returns -1 before the first cue', () => {
    expect(srtCueIndexAt(data.cues, -1)).toBe(-1);
  });

  it('finds the active cue by start time', () => {
    expect(srtCueIndexAt(data.cues, 0)).toBe(0);
    expect(srtCueIndexAt(data.cues, data.cues[1].start - 1)).toBe(0);
    expect(srtCueIndexAt(data.cues, data.cues[1].start)).toBe(1);
  });
});

describe('parseSrt error handling', () => {
  it('throws on content with no cues', () => {
    expect(() => parseSrt('not an srt file')).toThrow(SrtParseError);
  });
});
