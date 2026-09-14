import { useState } from 'react';
import { OverlayCanvas } from './components/overlay-canvas';
import { Timeline } from './components/timeline';
import { Transport } from './components/transport';
import { Section } from './components/panel/section';
import { FilesPanel } from './components/panel/files-panel';
import { OsdPanel } from './components/panel/osd-panel';
import { TelemetryPanel } from './components/panel/telemetry-panel';
import { MaskEditor } from './components/mask-editor';
import { ExportPanel } from './components/panel/export-panel';
import { useOverlaySettings } from './state/settings';
import { useMediaLoader } from './hooks/use-media-loader';
import { usePlayer } from './hooks/use-player';
import { useExporter, canHighQualityExport } from './hooks/use-exporter';

export function App() {
  const [settings, update] = useOverlaySettings();
  const [maskEditing, setMaskEditing] = useState(false);

  const { loaded, error, setError, handleFiles, availableFields, hasVideo } =
    useMediaLoader();

  const {
    videoRef,
    videoEl,
    duration,
    current,
    playing,
    volume,
    nativeSize,
    trimStart,
    trimEnd,
    setTrim,
    seek,
    togglePlay,
    stepFrame,
    changeVolume,
    setPlaybackRate,
    videoHandlers,
  } = usePlayer(loaded.videoUrl);

  const exporter = useExporter({
    sources: { osd: loaded.osd, srt: loaded.srt, font: loaded.font },
    settings,
    videoName: loaded.videoName,
    videoFile: loaded.videoFile,
    trimStartMs: trimStart,
    trimEndMs: trimEnd,
    nativeSize,
    onError: setError,
  });

  return (
    <div className="app">
      <header className="app__header">
        <h1>Walksnail OSD Studio</h1>
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
                  onLoadedMetadata={videoHandlers.onLoadedMetadata}
                  onTimeUpdate={videoHandlers.onTimeUpdate}
                  onPlay={videoHandlers.onPlay}
                  onPause={videoHandlers.onPause}
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
                ref={exporter.exportVideoRef}
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

              <Transport
                current={current}
                duration={duration}
                playing={playing}
                volume={volume}
                onTogglePlay={togglePlay}
                onStepFrame={stepFrame}
                onPlaybackRate={setPlaybackRate}
                onVolume={changeVolume}
              />
            </div>
          )}

          {error && <p className="error">Error: {error}</p>}
        </main>

        <aside className="sidebar">
          <Section title="Files">
            <FilesPanel
              videoName={loaded.videoName}
              osdName={loaded.osdName}
              srtName={loaded.srtName}
              fontName={loaded.fontName}
              showFontHint={Boolean(loaded.osd && !loaded.font)}
            />
          </Section>

          <Section
            title="OSD"
            toggle={{
              checked: settings.osdEnabled,
              onChange: (v) => update({ osdEnabled: v }),
            }}
          >
            <OsdPanel
              settings={settings}
              update={update}
              hasOsd={Boolean(loaded.osd)}
              maskEditing={maskEditing}
              onToggleMask={() => setMaskEditing((v) => !v)}
              onClearMask={() => update({ osdMask: [] })}
            />
          </Section>

          <Section
            title="Telemetry"
            toggle={{
              checked: settings.srtEnabled,
              onChange: (v) => update({ srtEnabled: v }),
            }}
          >
            <TelemetryPanel
              settings={settings}
              update={update}
              availableFields={availableFields}
            />
          </Section>

          <Section title="Export">
            <ExportPanel
              state={exporter.exportUi}
              onChange={exporter.setExportUi}
              durationMs={duration}
              trimStartMs={trimStart}
              trimEndMs={trimEnd}
              onTrimChange={setTrim}
              nativeWidth={nativeSize.w}
              nativeHeight={nativeSize.h}
              busy={exporter.exporting}
              progress={exporter.progress}
              onExport={() => void exporter.runExport()}
              onCancel={exporter.cancelExport}
              disabled={!hasVideo}
              highQuality={canHighQualityExport}
            />
          </Section>
        </aside>
      </div>
    </div>
  );
}
