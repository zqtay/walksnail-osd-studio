import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { parseSrt, srtCueIndexAt, SrtParseError } from '../srt';

const sampleUrl = new URL('../../../docs/examples/AscentG0177.srt', import.meta.url);
const samplePath = fileURLToPath(sampleUrl);
const sampleText = readFileSync(samplePath, 'utf8');

describe('parseSrt (sample AscentG0177.srt)', () => {
  const data = parseSrt(sampleText);

  it('parses the expected number of cues', () => {
    // 575 blocks (index 574 appears twice in this sample).
    expect(data.cues.length).toBe(575);
  });

  it('parses the first cue timing and fields', () => {
    const first = data.cues[0];
    expect(first.index).toBe(1);
    expect(first.start).toBe(0);
    expect(first.end).toBe(134);
    expect(first.fields).toMatchObject({
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
    });
  });

  it('strips unit suffixes and coerces numbers', () => {
    const f = data.cues[0].fields;
    expect(typeof f.SBat).toBe('number'); // "9.7V" -> 9.7
    expect(typeof f.Delay).toBe('number'); // "47ms" -> 47
    expect(typeof f.Bitrate).toBe('number'); // "25.0Mbps" -> 25
    expect(typeof f.Distance).toBe('number'); // "10m" -> 10
  });

  it('has all 11 known keys', () => {
    const keys = Object.keys(data.cues[0].fields).sort();
    expect(keys).toEqual(
      [
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
      ].sort(),
    );
  });
});

describe('srtCueIndexAt', () => {
  const data = parseSrt(sampleText);

  it('returns -1 before the first cue', () => {
    expect(srtCueIndexAt(data.cues, -1)).toBe(-1);
  });

  it('finds the active cue by start time', () => {
    expect(srtCueIndexAt(data.cues, 0)).toBe(0);
    expect(srtCueIndexAt(data.cues, 133)).toBe(0);
    expect(srtCueIndexAt(data.cues, 134)).toBe(1);
  });
});

describe('parseSrt error handling', () => {
  it('throws on content with no cues', () => {
    expect(() => parseSrt('not an srt file')).toThrow(SrtParseError);
  });
});
