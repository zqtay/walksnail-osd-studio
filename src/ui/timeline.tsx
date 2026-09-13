interface TimelineProps {
  duration: number;
  current: number;
  trimStart: number;
  trimEnd: number;
  onSeek: (ms: number) => void;
  onTrimStart: (ms: number) => void;
  onTrimEnd: (ms: number) => void;
}

/** Scrub bar with playhead and in/out trim handles for the export range. */
export function Timeline({
  duration,
  current,
  trimStart,
  trimEnd,
  onSeek,
  onTrimStart,
  onTrimEnd,
}: TimelineProps) {
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
