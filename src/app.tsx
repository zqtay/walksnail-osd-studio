import { useEffect, useMemo, useRef, useState } from 'react';
import { parseOsd, type OsdData } from './parsers/osd';
import { parseSrt, type SrtData } from './parsers/srt';
import { loadFontAtlas, type FontAtlas } from './parsers/font';
import { pairFiles } from './engine/pairing';
import { clampMs, formatMs } from './engine/clock';
import { OverlayCanvas } from './ui/overlay-canvas';
import { Timeline } from './ui/timeline';
import { Section } from './ui/section';
import { FileRow } from './ui/file-row';
import { Slider } from './ui/slider';
import { MaskEditor } from './ui/mask-editor';
import { ExportPanel, type ExportUiState } from './ui/export-panel';
import {
  exportWithMediaRecorder,
  extensionForMime,
} from './export/media-recorder';
import { useOverlaySettings } from './state/settings';

/** Lightweight capability check (no Mediabunny import) for the export path. */
const canHighQualityExport =
  typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';

interface Loaded {
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

export function App() {
  const [loaded, setLoaded] = useState<Loaded>({});
  const [error, setError] = useState<string>();
  const [settings, update] = useOverlaySettings();

  const videoRef = useRef<HTMLVideoElement>(null);
  const exportVideoRef = useRef<HTMLVideoElement>(null);
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const [duration, setDuration] = useState(0); // ms
  const [current, setCurrent] = useState(0); // ms
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(1); // 0..1
  const [nativeSize, setNativeSize] = useState({ w: 1920, h: 1080 });
  const [maskEditing, setMaskEditing] = useState(false);

  // Trim range in ms.
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);

  // Export state.
  const [exportUi, setExportUi] = useState<ExportUiState>({
    width: 1920,
    height: 1080,
    bitrateMbps: 40,
    includeAudio: false,
  });
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const exportAbort = useRef<AbortController | null>(null);

  useEffect(() => setVideoEl(videoRef.current), [loaded.videoUrl]);

  const availableFields = useMemo(
    () => (loaded.srt ? Object.keys(loaded.srt.cues[0].fields) : []),
    [loaded.srt],
  );

  async function handleFiles(list: FileList | null) {
    if (!list) return;
    setError(undefined);
    const paired = pairFiles(Array.from(list));
    const next: Loaded = { ...loaded };
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

  function onLoadedMetadata() {
    const v = videoRef.current;
    if (!v) return;
    const ms = v.duration * 1000;
    setDuration(ms);
    setTrimStart(0);
    setTrimEnd(ms);
    const w = v.videoWidth || 1920;
    const h = v.videoHeight || 1080;
    setNativeSize({ w, h });
    setExportUi((prev) => ({ ...prev, width: w, height: h }));
  }

  function seek(ms: number) {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = clampMs(ms, 0, duration) / 1000;
  }

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  }

  function stepFrame(dir: number) {
    // Approximate a single frame at 30fps when paused.
    seek(current + dir * (1000 / 30));
  }

  function changeVolume(v: number) {
    setVolume(v);
    const video = videoRef.current;
    if (video) {
      video.volume = v;
      video.muted = v === 0;
    }
  }

  async function runExport() {
    const exportVideo = exportVideoRef.current;
    if (!loaded.videoName) return;
    setError(undefined);
    setExporting(true);
    setExportProgress(0);
    const controller = new AbortController();
    exportAbort.current = controller;

    const exportOptions = {
      startMs: trimStart,
      endMs: trimEnd,
      width: exportUi.width,
      height: exportUi.height,
      videoBitsPerSecond: exportUi.bitrateMbps * 1_000_000,
      includeAudio: exportUi.includeAudio,
    };
    const sources = { osd: loaded.osd, srt: loaded.srt, font: loaded.font };

    try {
      let result;
      if (canHighQualityExport && loaded.videoFile) {
        const { exportWithMediabunny } = await import('./export/mediabunny');
        result = await exportWithMediabunny(
          sources,
          settings,
          exportOptions,
          loaded.videoFile,
          (p) => setExportProgress(p.fraction),
          controller.signal,
        );
      } else if (exportVideo) {
        const mrResult = await exportWithMediaRecorder(
          exportVideo,
          sources,
          settings,
          exportOptions,
          (p) => setExportProgress(p.fraction),
          controller.signal,
        );
        result = mrResult;
      } else {
        return;
      }

      const ext = extensionForMime(result.mimeType);
      const base = loaded.videoName.replace(/\.[^.]+$/, '');
      const url = URL.createObjectURL(result.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${base}-osd.${ext}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setExporting(false);
      setExportProgress(0);
      exportAbort.current = null;
    }
  }

  function cancelExport() {
    exportAbort.current?.abort();
  }

  const hasVideo = Boolean(loaded.videoUrl);

  return (
    <div className="app">
      <header className="app__header">
        <h1>Walksnail OSD Studio</h1>
        <span className="app__badge">offline · local-only</span>
        <label className="btn btn--ghost">
          Open files
          <input
            type="file"
            multiple
            accept=".mp4,.mov,.webm,.osd,.srt,.png,video/*"
            hidden
            onChange={(e) => void handleFiles(e.target.files)}
          />
        </label>
      </header>

      <div className="layout">
        <main
          className="stage"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void handleFiles(e.dataTransfer.files);
          }}
        >
          {!hasVideo && (
            <div className="stage__empty">
              <strong>Drop files to begin</strong>
              <span>.mp4 video · .osd overlay · .srt telemetry · .png font</span>
            </div>
          )}

          {hasVideo && (
            <div className="player">
              <div className="player__frame">
                <video
                  ref={videoRef}
                  src={loaded.videoUrl}
                  className="player__video"
                  onLoadedMetadata={onLoadedMetadata}
                  onTimeUpdate={(e) =>
                    setCurrent(e.currentTarget.currentTime * 1000)
                  }
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                />
                <OverlayCanvas
                  video={videoEl}
                  osd={loaded.osd}
                  srt={loaded.srt}
                  font={loaded.font}
                  settings={settings}
                />
                {maskEditing && loaded.osd && (
                  <MaskEditor
                    cols={loaded.osd.header.cols}
                    rows={loaded.osd.header.rows}
                    videoWidth={nativeSize.w}
                    videoHeight={nativeSize.h}
                    offsetX={settings.osdOffsetX}
                    offsetY={settings.osdOffsetY}
                    scale={settings.osdScale}
                    mask={settings.osdMask}
                    onChange={(m) => update({ osdMask: m })}
                  />
                )}
              </div>

              {/* Dedicated source element for export (muted, off-screen). */}
              <video
                ref={exportVideoRef}
                src={loaded.videoUrl}
                muted
                playsInline
                preload="auto"
                style={{ display: 'none' }}
              />

              <Timeline
                duration={duration}
                current={current}
                trimStart={trimStart}
                trimEnd={trimEnd}
                onSeek={seek}
              />

              <div className="transport">
                <button className="btn" onClick={() => stepFrame(-1)}>⏮</button>
                <button className="btn btn--primary" onClick={togglePlay}>
                  {playing ? '⏸ Pause' : '▶ Play'}
                </button>
                <button className="btn" onClick={() => stepFrame(1)}>⏭</button>
                <span className="time">
                  {formatMs(current)} / {formatMs(duration)}
                </span>
                <label className="speed">
                  Speed
                  <select
                    defaultValue="1"
                    onChange={(e) => {
                      const v = videoRef.current;
                      if (v) v.playbackRate = Number(e.target.value);
                    }}
                  >
                    <option value="0.25">0.25×</option>
                    <option value="0.5">0.5×</option>
                    <option value="1">1×</option>
                    <option value="1.5">1.5×</option>
                    <option value="2">2×</option>
                  </select>
                </label>
                <label className="volume">
                  {volume === 0 ? '🔇' : '🔊'}
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={volume}
                    onChange={(e) => changeVolume(Number(e.target.value))}
                    aria-label="Volume"
                  />
                </label>
              </div>
            </div>
          )}

          {error && <p className="error">Error: {error}</p>}
        </main>

        <aside className="sidebar">
          <Section title="Files">
            <FileRow label="Video" name={loaded.videoName} />
            <FileRow label="OSD" name={loaded.osdName} />
            <FileRow label="Telemetry" name={loaded.srtName} />
            <FileRow label="Font" name={loaded.fontName} />
            {loaded.osd && !loaded.font && (
              <p className="hint">Load an OSD font (.png) to render the overlay.</p>
            )}
          </Section>

          <Section
            title="OSD"
            toggle={{
              checked: settings.osdEnabled,
              onChange: (v) => update({ osdEnabled: v }),
            }}
          >
            <Slider
              label="Sync offset"
              suffix="ms"
              min={-2000}
              max={2000}
              step={10}
              value={settings.osdOffsetMs}
              onChange={(v) => update({ osdOffsetMs: v })}
            />
            <Slider
              label="Scale"
              suffix="×"
              min={0.5}
              max={1.5}
              step={0.01}
              value={settings.osdScale}
              onChange={(v) => update({ osdScale: v })}
            />
            <Slider
              label="Nudge X"
              suffix="px"
              min={-200}
              max={200}
              step={1}
              value={settings.osdOffsetX}
              onChange={(v) => update({ osdOffsetX: v })}
            />
            <Slider
              label="Nudge Y"
              suffix="px"
              min={-200}
              max={200}
              step={1}
              value={settings.osdOffsetY}
              onChange={(v) => update({ osdOffsetY: v })}
            />
            <div className="mask-controls">
              <button
                className={`btn ${maskEditing ? 'btn--primary' : ''}`}
                onClick={() => setMaskEditing((v) => !v)}
                disabled={!loaded.osd}
              >
                {maskEditing ? 'Done masking' : 'Edit mask'}
              </button>
              <button
                className="btn"
                onClick={() => update({ osdMask: [] })}
                disabled={settings.osdMask.length === 0}
              >
                Clear
              </button>
              <span className="mask-controls__count">
                {settings.osdMask.length} hidden
              </span>
            </div>
            {maskEditing && (
              <p className="hint">
                Drag over the video to hide OSD cells; drag over hidden cells to
                reveal them.
              </p>
            )}
          </Section>

          <Section
            title="Telemetry"
            toggle={{
              checked: settings.srtEnabled,
              onChange: (v) => update({ srtEnabled: v }),
            }}
          >
            <Slider
              label="Sync offset"
              suffix="ms"
              min={-2000}
              max={2000}
              step={10}
              value={settings.srtOffsetMs}
              onChange={(v) => update({ srtOffsetMs: v })}
            />
            <label className="field">
              <span>Anchor</span>
              <select
                value={settings.srtAnchor}
                onChange={(e) =>
                  update({ srtAnchor: e.target.value as typeof settings.srtAnchor })
                }
              >
                <option value="top-left">Top left</option>
                <option value="top-right">Top right</option>
                <option value="bottom-left">Bottom left</option>
                <option value="bottom-right">Bottom right</option>
              </select>
            </label>
            <label className="field">
              <span>Layout</span>
              <select
                value={settings.srtLayout}
                onChange={(e) =>
                  update({ srtLayout: e.target.value as typeof settings.srtLayout })
                }
              >
                <option value="single">Single line</option>
                <option value="multi">Multiple lines</option>
              </select>
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={settings.srtBackground}
                onChange={(e) => update({ srtBackground: e.target.checked })}
              />
              <span>Background box</span>
            </label>
            <Slider
              label="Size"
              suffix="×"
              min={0.5}
              max={3}
              step={0.05}
              value={settings.srtScale}
              onChange={(v) => update({ srtScale: v })}
            />
            <Slider
              label="Nudge X"
              suffix="px"
              min={-400}
              max={400}
              step={1}
              value={settings.srtOffsetX}
              onChange={(v) => update({ srtOffsetX: v })}
            />
            <Slider
              label="Nudge Y"
              suffix="px"
              min={-400}
              max={400}
              step={1}
              value={settings.srtOffsetY}
              onChange={(v) => update({ srtOffsetY: v })}
            />
            {availableFields.length > 0 && (
              <div className="fields">
                {availableFields.map((f) => (
                  <label key={f} className="chip">
                    <input
                      type="checkbox"
                      checked={settings.srtFields.includes(f)}
                      onChange={(e) => {
                        const set = new Set(settings.srtFields);
                        if (e.target.checked) set.add(f);
                        else set.delete(f);
                        update({
                          srtFields: availableFields.filter((k) => set.has(k)),
                        });
                      }}
                    />
                    {f}
                  </label>
                ))}
              </div>
            )}
          </Section>

          <Section title="Export">
            <ExportPanel
              state={exportUi}
              onChange={(patch) => setExportUi((prev) => ({ ...prev, ...patch }))}
              durationMs={duration}
              trimStartMs={trimStart}
              trimEndMs={trimEnd}
              onTrimChange={(s, e) => {
                setTrimStart(clampMs(s, 0, e));
                setTrimEnd(clampMs(e, s, duration));
              }}
              nativeWidth={nativeSize.w}
              nativeHeight={nativeSize.h}
              busy={exporting}
              progress={exportProgress}
              onExport={() => void runExport()}
              onCancel={cancelExport}
              disabled={!hasVideo}
              highQuality={canHighQualityExport}
            />
          </Section>
        </aside>
      </div>
    </div>
  );
}
