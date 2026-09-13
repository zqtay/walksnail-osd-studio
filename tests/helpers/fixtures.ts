import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const fixturesDir = fileURLToPath(new URL('../fixtures/', import.meta.url));

/** Absolute path to a file under tests/fixtures. */
export function fixturePath(name: string): string {
  return fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
}

/** Read a fixture as a tightly-sliced ArrayBuffer (for binary parsers). */
export function readFixtureArrayBuffer(name: string): ArrayBuffer {
  const buf = readFileSync(fixturePath(name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

/** Read a fixture as UTF-8 text (for text parsers). */
export function readFixtureText(name: string): string {
  return readFileSync(fixturePath(name), 'utf8');
}

/**
 * Discover every capture in tests/fixtures that has both an `.osd` and a
 * matching `.srt`. Keeps tests free of hardcoded file names and automatically
 * covers newly added fixtures.
 */
function findSampleBasenames(): string[] {
  const files = readdirSync(fixturesDir);
  const osd = new Set(
    files.filter((f) => f.toLowerCase().endsWith('.osd')).map((f) => f.slice(0, -4)),
  );
  const paired = files
    .filter((f) => f.toLowerCase().endsWith('.srt'))
    .map((f) => f.slice(0, -4))
    .filter((base) => osd.has(base))
    .sort();
  if (paired.length === 0) {
    throw new Error(`No .osd/.srt fixture pair found in ${fixturesDir}`);
  }
  return paired;
}

/** Basenames (no extension) of every discovered capture pair. */
export const sampleBasenames = findSampleBasenames();

/** Basename of the first discovered capture (back-compat convenience). */
export const sampleBasename = sampleBasenames[0];

/** Read a capture's `.osd` as an ArrayBuffer. */
export function readOsd(basename: string): ArrayBuffer {
  return readFixtureArrayBuffer(`${basename}.osd`);
}

/** Read a capture's `.srt` as text. */
export function readSrt(basename: string): string {
  return readFixtureText(`${basename}.srt`);
}

/** Read the first capture's `.osd` as an ArrayBuffer. */
export function readSampleOsd(): ArrayBuffer {
  return readOsd(sampleBasename);
}

/** Read the first capture's `.srt` as text. */
export function readSampleSrt(): string {
  return readSrt(sampleBasename);
}
