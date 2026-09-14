import { describe, it, expect } from 'vitest';
import { classifyFile, pairFiles } from '../../src/lib/engine/pairing';

function mkFile(name: string, type = ''): File {
  return new File([new Uint8Array([0])], name, { type });
}

describe('classifyFile', () => {
  it('classifies by extension', () => {
    expect(classifyFile(mkFile('a.osd')).kind).toBe('osd');
    expect(classifyFile(mkFile('a.srt')).kind).toBe('srt');
    expect(classifyFile(mkFile('a.mp4')).kind).toBe('video');
    expect(classifyFile(mkFile('a.png')).kind).toBe('font');
    expect(classifyFile(mkFile('a.txt')).kind).toBe('unknown');
  });

  it('classifies video by MIME type', () => {
    expect(classifyFile(mkFile('clip', 'video/webm')).kind).toBe('video');
  });

  it('extracts a lowercased basename', () => {
    expect(classifyFile(mkFile('AscentG0177.OSD')).base).toBe('ascentg0177');
  });
});

describe('pairFiles', () => {
  it('pairs tracks by shared basename', () => {
    const set = pairFiles([
      mkFile('AscentG0177.mp4', 'video/mp4'),
      mkFile('AscentG0177.osd'),
      mkFile('AscentG0177.srt'),
      mkFile('font.png'),
    ]);
    expect(set.video?.name).toBe('AscentG0177.mp4');
    expect(set.osd?.name).toBe('AscentG0177.osd');
    expect(set.srt?.name).toBe('AscentG0177.srt');
    expect(set.font?.name).toBe('font.png');
  });

  it('prefers the basename shared by the most tracks', () => {
    const set = pairFiles([
      mkFile('flightA.mp4', 'video/mp4'),
      mkFile('flightB.osd'),
      mkFile('flightB.srt'),
    ]);
    // flightB has 2 tracks; its osd/srt should be chosen.
    expect(set.osd?.name).toBe('flightB.osd');
    expect(set.srt?.name).toBe('flightB.srt');
  });
});
