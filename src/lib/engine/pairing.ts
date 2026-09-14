/** Recognized input kinds for the app. */
export type FileKind = 'video' | 'osd' | 'srt' | 'font' | 'unknown';

export interface ClassifiedFile {
  file: File;
  kind: FileKind;
  /** Lowercased basename without extension, for pairing. */
  base: string;
}

/** Classify a file by extension / MIME type. */
export function classifyFile(file: File): ClassifiedFile {
  const name = file.name;
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
  const base = (dot >= 0 ? name.slice(0, dot) : name).toLowerCase();

  let kind: FileKind = 'unknown';
  if (ext === 'osd') kind = 'osd';
  else if (ext === 'srt') kind = 'srt';
  else if (ext === 'mp4' || ext === 'mov' || ext === 'webm' || file.type.startsWith('video/'))
    kind = 'video';
  else if (ext === 'png') kind = 'font';

  return { file, kind, base };
}

export interface PairedSet {
  video?: File;
  osd?: File;
  srt?: File;
  font?: File;
}

/**
 * Auto-pair a batch of dropped files. Video/osd/srt sharing a basename are
 * grouped; a lone font PNG applies globally. Returns the best-matched set.
 */
export function pairFiles(files: File[]): PairedSet {
  const classified = files.map(classifyFile);

  const byKind = (kind: FileKind) => classified.filter((c) => c.kind === kind);
  const videos = byKind('video');
  const osds = byKind('osd');
  const srts = byKind('srt');
  const fonts = byKind('font');

  // Prefer a basename shared by the most tracks.
  const bases = new Map<string, number>();
  for (const c of [...videos, ...osds, ...srts]) {
    bases.set(c.base, (bases.get(c.base) ?? 0) + 1);
  }
  let bestBase: string | undefined;
  let bestScore = -1;
  for (const [base, score] of bases) {
    if (score > bestScore) {
      bestScore = score;
      bestBase = base;
    }
  }

  const pick = (list: ClassifiedFile[]): File | undefined => {
    if (bestBase) {
      const match = list.find((c) => c.base === bestBase);
      if (match) return match.file;
    }
    return list[0]?.file;
  };

  return {
    video: pick(videos),
    osd: pick(osds),
    srt: pick(srts),
    font: fonts[0]?.file,
  };
}
