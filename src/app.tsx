import { useEffect, useMemo, useRef, useState } from 'react';
import { parseOsd, type OsdData } from './parsers/osd';
import { parseSrt, type SrtData } from './parsers/srt';
import { loadFontAtlas, type FontAtlas } from './parsers/font';
import { pairFiles } from './engine/pairing';
import { clampMs, formatMs } from './engine/clock';
import { OverlayCanvas } from './ui/OverlayCanvas';
import { useOverlaySettings } from './state/settings';

interface Loaded {
  osd?: OsdData;
  srt?: SrtData;
  font?: FontAtlas;
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
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const [duration, setDuration] = useState(0); // ms
  const [current, setCurrent] = useState(0); // ms
  const [playing, setPlaying] = useState(false);

  // Trim range in ms.
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);

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
              </div>

              <Timeline
                duration={duration}
                current={current}
                trimStart={trimStart}
                trimEnd={trimEnd}
                onSeek={seek}
                onTrimStart={(v) => setTrimStart(clampMs(v, 0, trimEnd))}
                onTrimEnd={(v) => setTrimEnd(clampMs(v, trimStart, duration))}
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
                <span className="trim-readout">
                  Export: {formatMs(trimStart)} → {formatMs(trimEnd)}
                </span>
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

          <Section title="OSD">
            <Toggle
              label="Show OSD"
              checked={settings.osdEnabled}
              onChange={(v) => update({ osdEnabled: v })}
            />
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
          </Section>

          <Section title="Telemetry">
            <Toggle
              label="Show panel"
              checked={settings.srtEnabled}
              onChange={(v) => update({ srtEnabled: v })}
            />
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
        </aside>
      </div>
    </div>
  );
}

function Timeline({
  duration,
  current,
  trimStart,
  trimEnd,
  onSeek,
  onTrimStart,
  onTrimEnd,
}: {
  duration: number;
  current: number;
  trimStart: number;
  trimEnd: number;
  onSeek: (ms: number) => void;
  onTrimStart: (ms: number) => void;
  onTrimEnd: (ms: number) => void;
}) {
  const pct = (ms: number) => (duration > 0 ? (ms / duration) * 100 : 0);
  return (
    <div className="timeline">
      <div className="timeline__track">
        <div
          className="timeline__selection"
          style={{ left: `${pct(trimStart)}%`, right: `${100 - pct(trimEnd)}%` }}
        />
        <div className="timeline__playhead" style={{ left: `${pct(current)}%` }} />
        <input
          className="timeline__seek"
          type="range"
          min={0}
          max={duration}
          step={1}
          value={current}
          onChange={(e) => onSeek(Number(e.target.value))}
        />
      </div>
      <div className="timeline__trim">
        <label>
          In
          <input
            type="range"
            min={0}
            max={duration}
            step={1}
            value={trimStart}
            onChange={(e) => onTrimStart(Number(e.target.value))}
          />
        </label>
        <label>
          Out
          <input
            type="range"
            min={0}
            max={duration}
            step={1}
            value={trimEnd}
            onChange={(e) => onTrimEnd(Number(e.target.value))}
          />
        </label>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function FileRow({ label, name }: { label: string; name?: string }) {
  return (
    <div className="filerow">
      <span className="filerow__label">{label}</span>
      <span className={`filerow__name ${name ? '' : 'muted'}`}>{name ?? '—'}</span>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function Slider({
  label,
  suffix,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  suffix: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="field">
      <span>
        {label} <em>{value}{suffix}</em>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
