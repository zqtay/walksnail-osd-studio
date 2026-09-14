import { describe, it, expect, vi, afterEach } from 'vitest';
import { extensionForMime, pickMimeType } from '../../src/lib/export/media-recorder';

describe('extensionForMime', () => {
  it('maps mp4 and webm mimes to file extensions', () => {
    expect(extensionForMime('video/mp4;codecs=avc1.42E01E')).toBe('mp4');
    expect(extensionForMime('video/mp4')).toBe('mp4');
    expect(extensionForMime('video/webm;codecs=vp9')).toBe('webm');
    expect(extensionForMime('video/webm')).toBe('webm');
  });
});

describe('pickMimeType', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the first supported candidate', () => {
    vi.stubGlobal('MediaRecorder', {
      isTypeSupported: (m: string) => m === 'video/webm;codecs=vp9',
    });
    expect(pickMimeType()).toBe('video/webm;codecs=vp9');
  });

  it('honors a supported preferred type first', () => {
    vi.stubGlobal('MediaRecorder', {
      isTypeSupported: () => true,
    });
    expect(pickMimeType('video/webm')).toBe('video/webm');
  });

  it('falls back past an unsupported preferred type', () => {
    vi.stubGlobal('MediaRecorder', {
      isTypeSupported: (m: string) => m === 'video/mp4',
    });
    expect(pickMimeType('video/unsupported')).toBe('video/mp4');
  });

  it('returns undefined when nothing is supported', () => {
    vi.stubGlobal('MediaRecorder', {
      isTypeSupported: () => false,
    });
    expect(pickMimeType()).toBeUndefined();
  });
});
