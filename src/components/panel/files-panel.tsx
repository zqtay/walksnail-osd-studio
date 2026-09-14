import { FileRow } from './file-row';

interface FilesPanelProps {
  videoName?: string;
  osdName?: string;
  srtName?: string;
  fontName?: string;
  /** Show the "load a font" hint (OSD loaded but no font). */
  showFontHint?: boolean;
}

/** Sidebar panel listing the loaded input files. */
export function FilesPanel({
  videoName,
  osdName,
  srtName,
  fontName,
  showFontHint,
}: FilesPanelProps) {
  return (
    <>
      <FileRow label="Video" name={videoName} />
      <FileRow label="OSD" name={osdName} />
      <FileRow label="Telemetry" name={srtName} />
      <FileRow label="Font" name={fontName} />
      {showFontHint && (
        <p className="hint">Load an OSD font (.png) to render the overlay.</p>
      )}
    </>
  );
}
