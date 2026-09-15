import { useEffect, useState } from 'react';
import { ArrowRight, Download } from 'lucide-react';
import { clampMs, formatMs, parseTimeMs } from '../../lib/engine/clock';
import { RangeSlider } from './range-slider';

export interface ExportUiState {
  width: number;
  height: number;
  bitrateMbps: number;
  includeAudio: boolean;
}

interface ExportPanelProps {
  state: ExportUiState;
  onChange: (patch: Partial<ExportUiState>) => void;
  durationMs: number;
  trimStartMs: number;
  trimEndMs: number;
  onTrimChange: (startMs: number, endMs: number) => void;
  nativeWidth: number;
  nativeHeight: number;
  busy: boolean;
  progress: number;
  onExport: () => void;
  onCancel: () => void;
  disabled?: boolean;
  /** True when the high-quality Mediabunny path will be used. */
  highQuality?: boolean;
}

/** Sidebar panel for configuring and running the burned-in export. */
export function ExportPanel({
  state,
  onChange,
  durationMs,
  trimStartMs,
  trimEndMs,
  onTrimChange,
  nativeWidth,
  nativeHeight,
  busy,
  progress,
  onExport,
  onCancel,
  disabled,
  highQuality,
}: ExportPanelProps) {
  const rangeMs = Math.max(0, trimEndMs - trimStartMs);

  // Local draft strings so the user can type freely; committed on blur/Enter.
  const [startText, setStartText] = useState(() => formatMs(trimStartMs));
  const [endText, setEndText] = useState(() => formatMs(trimEndMs));

  // Re-sync the inputs when the trim changes externally (e.g. slider drag).
  useEffect(() => setStartText(formatMs(trimStartMs)), [trimStartMs]);
  useEffect(() => setEndText(formatMs(trimEndMs)), [trimEndMs]);

  const commitStart = () => {
    const parsed = parseTimeMs(startText);
    if (parsed === null) {
      setStartText(formatMs(trimStartMs));
      return;
    }
    const next = clampMs(parsed, 0, trimEndMs);
    onTrimChange(next, trimEndMs);
    setStartText(formatMs(next));
  };

  const commitEnd = () => {
    const parsed = parseTimeMs(endText);
    if (parsed === null) {
      setEndText(formatMs(trimEndMs));
      return;
    }
    const next = clampMs(parsed, trimStartMs, durationMs);
    onTrimChange(trimStartMs, next);
    setEndText(formatMs(next));
  };

  return (
    <div className="export">
      <label className="field">
        <span>
          Trim <em>({formatMs(rangeMs)})</em>
        </span>
        <RangeSlider
          min={0}
          max={durationMs}
          step={1}
          start={trimStartMs}
          end={trimEndMs}
          onChange={onTrimChange}
        />
        <div className="export__trim-inputs">
          <input
            type="text"
            inputMode="decimal"
            aria-label="Trim start"
            value={startText}
            onChange={(e) => setStartText(e.target.value)}
            onBlur={commitStart}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
          <span className="export__trim-sep" aria-hidden="true">
            <ArrowRight size={14} />
          </span>
          <input
            type="text"
            inputMode="decimal"
            aria-label="Trim end"
            value={endText}
            onChange={(e) => setEndText(e.target.value)}
            onBlur={commitEnd}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
        </div>
      </label>

      <label className="field">
        <span>Resolution</span>
        <select
          value={`${state.width}x${state.height}`}
          onChange={(e) => {
            const [w, h] = e.target.value.split('x').map(Number);
            onChange({ width: w, height: h });
          }}
        >
          <option value={`${nativeWidth}x${nativeHeight}`}>
            Native ({nativeWidth}×{nativeHeight})
          </option>
          <option value="2560x1440">1440p (2560×1440)</option>
          <option value="1920x1080">1080p (1920×1080)</option>
          <option value="1280x720">720p (1280×720)</option>
        </select>
      </label>

      <label className="field">
        <span>
          Bitrate <em>{state.bitrateMbps} Mbps</em>
        </span>
        <input
          type="range"
          min={4}
          max={100}
          step={1}
          value={state.bitrateMbps}
          onChange={(e) => onChange({ bitrateMbps: Number(e.target.value) })}
        />
      </label>

      <label className="toggle">
        <input
          type="checkbox"
          checked={state.includeAudio}
          onChange={(e) => onChange({ includeAudio: e.target.checked })}
        />
        <span>Include audio</span>
      </label>

      {busy ? (
        <div className="export__progress">
          <div className="export__bar">
            <div className="export__fill" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      ) : (
        <button
          className="btn btn--primary export__go"
          onClick={onExport}
          disabled={disabled || rangeMs <= 0}
        >
          <Download size={16} />
          Export clip
        </button>
      )}

      <p className="hint">
        {highQuality
          ? 'Encodes an H.264 MP4 with Mediabunny.'
          : 'Falls back to real-time capture; audio support varies by browser.'}
      </p>
    </div>
  );
}
