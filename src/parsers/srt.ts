/**
 * Walksnail `.srt` telemetry parser.
 *
 * The Walksnail Avatar VRX writes a standard SubRip file whose payload line is
 * link telemetry (NOT GPS). Verified from docs/examples/AscentG0177.srt:
 *
 *   1
 *   00:00:00,000 --> 00:00:00,134
 *   Signal:4 CH:1 Hz:5475000 FlightTime:0 Sp=26 Gp=30 SBat:9.7V GBat:11.9V \
 *   Delay:47ms Bitrate:25.0Mbps Distance:10m
 *
 * Tokens use a mix of `Key:Value` and `Key=Value` with unit suffixes
 * (V, ms, Mbps, m). The parser is schema-tolerant: it keeps every token, coerces
 * numbers where possible, and preserves unknown keys as strings.
 */

export interface SrtCue {
  index: number;
  /** Start time in milliseconds. */
  start: number;
  /** End time in milliseconds. */
  end: number;
  /** Parsed telemetry fields (numeric where possible). */
  fields: Record<string, number | string>;
  /** Original payload text. */
  raw: string;
}

export interface SrtData {
  cues: SrtCue[];
  /** End time of the last cue, in ms. */
  durationMs: number;
}

export class SrtParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SrtParseError';
  }
}

const TIMECODE_RE =
  /(\d{2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{1,3})/;

// Unit suffixes stripped before numeric coercion, longest first.
const UNIT_SUFFIXES = ['Mbps', 'ms', 'V', 'm'];

/**
 * Parse SRT text into telemetry cues.
 * @param text UTF-8 file contents.
 */
export function parseSrt(text: string): SrtData {
  // Normalize newlines and strip a UTF-8 BOM if present.
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const blocks = normalized.split(/\n{2,}/);

  const cues: SrtCue[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim().length > 0);
    if (lines.length < 2) continue;

    // Find the timecode line (usually line 0 or 1).
    let tcLineIdx = -1;
    let tc: RegExpMatchArray | null = null;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(TIMECODE_RE);
      if (m) {
        tcLineIdx = i;
        tc = m;
        break;
      }
    }
    if (!tc || tcLineIdx === -1) continue;

    // Index is the line before the timecode if it is a bare integer.
    let index = cues.length + 1;
    if (tcLineIdx > 0) {
      const maybe = parseInt(lines[tcLineIdx - 1].trim(), 10);
      if (!Number.isNaN(maybe)) index = maybe;
    }

    const start = tcToMs(tc[1], tc[2], tc[3], tc[4]);
    const end = tcToMs(tc[5], tc[6], tc[7], tc[8]);

    const payload = lines.slice(tcLineIdx + 1).join(' ').trim();
    cues.push({ index, start, end, fields: parseFields(payload), raw: payload });
  }

  if (cues.length === 0) {
    throw new SrtParseError('No valid SRT cues found.');
  }

  const durationMs = cues[cues.length - 1].end;
  return { cues, durationMs };
}

/**
 * Index of the active cue for a given time (start <= t < end preferred; falls
 * back to the last cue that started at/before t). Returns -1 if none.
 * O(log n) binary search over cue start times.
 */
export function srtCueIndexAt(cues: SrtCue[], tMs: number): number {
  let lo = 0;
  let hi = cues.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (cues[mid].start <= tMs) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

function tcToMs(hh: string, mm: string, ss: string, ms: string): number {
  const h = parseInt(hh, 10);
  const m = parseInt(mm, 10);
  const s = parseInt(ss, 10);
  // Milliseconds may be 1-3 digits; pad to 3.
  const millis = parseInt(ms.padEnd(3, '0'), 10);
  return ((h * 60 + m) * 60 + s) * 1000 + millis;
}

function parseFields(payload: string): Record<string, number | string> {
  const fields: Record<string, number | string> = {};
  for (const token of payload.split(/\s+/)) {
    if (!token) continue;
    const m = token.match(/^([A-Za-z][A-Za-z0-9_]*)[:=](.*)$/);
    if (!m) continue;
    const key = m[1];
    let value = m[2];

    // Strip a known unit suffix for numeric coercion.
    let numeric = value;
    for (const unit of UNIT_SUFFIXES) {
      if (numeric.endsWith(unit)) {
        numeric = numeric.slice(0, -unit.length);
        break;
      }
    }
    const asNum = Number(numeric);
    fields[key] = numeric !== '' && !Number.isNaN(asNum) ? asNum : value;
  }
  return fields;
}
