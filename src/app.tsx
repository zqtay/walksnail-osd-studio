import { useState } from 'react';
import { parseOsd, type OsdData } from './parsers/osd';
import { parseSrt, type SrtData } from './parsers/srt';

interface LoadState {
  osd?: OsdData;
  srt?: SrtData;
  videoUrl?: string;
  videoName?: string;
  error?: string;
}

/**
 * Minimal M0/M1 shell: verifies the parsers work end-to-end in the browser and
 * that the app runs fully offline. The full player/overlay/export UI (M4-M6)
 * builds on top of this scaffold.
 */
export function App() {
  const [state, setState] = useState<LoadState>({});

  async function handleFiles(files: FileList | null) {
    if (!files) return;
    const next: LoadState = { ...state, error: undefined };
    try {
      for (const file of Array.from(files)) {
        const lower = file.name.toLowerCase();
        if (lower.endsWith('.osd')) {
          next.osd = parseOsd(await file.arrayBuffer());
        } else if (lower.endsWith('.srt')) {
          next.srt = parseSrt(await file.text());
        } else if (lower.endsWith('.mp4') || file.type.startsWith('video/')) {
          if (next.videoUrl) URL.revokeObjectURL(next.videoUrl);
          next.videoUrl = URL.createObjectURL(file);
          next.videoName = file.name;
        }
      }
    } catch (err) {
      next.error = err instanceof Error ? err.message : String(err);
    }
    setState(next);
  }

  return (
    <div className="app">
      <header className="app__header">
        <h1>Walksnail OSD Studio</h1>
        <span className="app__badge">offline · local-only</span>
      </header>

      <main className="app__main">
        <label
          className="dropzone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void handleFiles(e.dataTransfer.files);
          }}
        >
          <input
            type="file"
            multiple
            accept=".mp4,.osd,.srt,video/*"
            hidden
            onChange={(e) => void handleFiles(e.target.files)}
          />
          <strong>Drop or choose files</strong>
          <span>.mp4 video · .osd overlay · .srt telemetry</span>
        </label>

        {state.error && <p className="error">Error: {state.error}</p>}

        <section className="cards">
          {state.videoUrl && (
            <div className="card">
              <h2>Video</h2>
              <video src={state.videoUrl} controls className="preview" />
              <p className="muted">{state.videoName}</p>
            </div>
          )}

          {state.osd && (
            <div className="card">
              <h2>OSD</h2>
              <dl className="kv">
                <dt>Firmware</dt>
                <dd>{state.osd.header.magic}</dd>
                <dt>Grid</dt>
                <dd>
                  {state.osd.header.cols} × {state.osd.header.rows}
                </dd>
                <dt>Frames</dt>
                <dd>{state.osd.frames.length}</dd>
                <dt>Duration</dt>
                <dd>{(state.osd.durationMs / 1000).toFixed(2)} s</dd>
              </dl>
            </div>
          )}

          {state.srt && (
            <div className="card">
              <h2>Telemetry</h2>
              <dl className="kv">
                <dt>Cues</dt>
                <dd>{state.srt.cues.length}</dd>
                <dt>Duration</dt>
                <dd>{(state.srt.durationMs / 1000).toFixed(2)} s</dd>
                <dt>Fields</dt>
                <dd>{Object.keys(state.srt.cues[0].fields).join(', ')}</dd>
              </dl>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
