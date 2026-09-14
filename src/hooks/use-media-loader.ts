import { useMemo, useState } from 'react';
import { parseOsd, type OsdData } from '../lib/parsers/osd';
import { parseSrt, type SrtData } from '../lib/parsers/srt';
import { loadFontAtlas, type FontAtlas } from '../lib/parsers/font';
import { pairFiles } from '../lib/engine/pairing';

export interface LoadedMedia {
  osd?: OsdData;
  srt?: SrtData;
  font?: FontAtlas;
  videoFile?: File;
  videoUrl?: string;
  videoName?: string;
  osdName?: string;
  srtName?: string;
  fontName?: string;
}

export interface UseMediaLoader {
  loaded: LoadedMedia;
  error: string | undefined;
  setError: (message: string | undefined) => void;
  handleFiles: (list: FileList | null) => Promise<void>;
  /** Telemetry field keys available in the loaded SRT, in file order. */
  availableFields: string[];
  hasVideo: boolean;
}

/**
 * Loads and parses dropped/selected files (video, .osd, .srt, font .png),
 * auto-pairs them by basename, and manages the video object-URL lifecycle.
 */
export function useMediaLoader(): UseMediaLoader {
  const [loaded, setLoaded] = useState<LoadedMedia>({});
  const [error, setError] = useState<string>();

  const availableFields = useMemo(
    () => (loaded.srt ? Object.keys(loaded.srt.cues[0].fields) : []),
    [loaded.srt],
  );

  async function handleFiles(list: FileList | null) {
    if (!list) return;
    setError(undefined);
    const paired = pairFiles(Array.from(list));
    const next: LoadedMedia = { ...loaded };
    try {
      if (paired.video) {
        if (next.videoUrl) URL.revokeObjectURL(next.videoUrl);
        next.videoFile = paired.video;
        next.videoUrl = URL.createObjectURL(paired.video);
        next.videoName = paired.video.name;
      }
      if (paired.osd) {
        next.osd = parseOsd(await paired.osd.arrayBuffer());
        next.osdName = paired.osd.name;
      }
      if (paired.srt) {
        next.srt = parseSrt(await paired.srt.text());
        next.srtName = paired.srt.name;
      }
      if (paired.font) {
        next.font = await loadFontAtlas(paired.font);
        next.fontName = paired.font.name;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setLoaded(next);
  }

  return {
    loaded,
    error,
    setError,
    handleFiles,
    availableFields,
    hasVideo: Boolean(loaded.videoUrl),
  };
}
