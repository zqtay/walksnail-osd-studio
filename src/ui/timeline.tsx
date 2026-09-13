interface TimelineProps {
  duration: number;
  current: number;
  trimStart: number;
  trimEnd: number;
  onSeek: (ms: number) => void;
}

/** Scrub bar; the shaded band shows the current export range. */
export function Timeline({ duration, current, trimStart, trimEnd, onSeek }: TimelineProps) {
  const pct = (ms: number) => (duration > 0 ? (ms / duration) * 100 : 0);
  return (
    <div className="timeline">
      <div className="timeline__track">
        <div
          className="timeline__selection"
          style={{ left: `${pct(trimStart)}%`, right: `${100 - pct(trimEnd)}%` }}
        />
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
    </div>
  );
}
