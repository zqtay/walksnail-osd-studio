interface RangeSliderProps {
  min: number;
  max: number;
  step?: number;
  start: number;
  end: number;
  onChange: (start: number, end: number) => void;
}

/**
 * Dual-thumb range slider built from two overlaid range inputs. The active
 * (nearest) thumb receives pointer events so both ends are draggable.
 */
export function RangeSlider({ min, max, step = 1, start, end, onChange }: RangeSliderProps) {
  const span = max - min || 1;
  const startPct = ((start - min) / span) * 100;
  const endPct = ((end - min) / span) * 100;

  return (
    <div className="range">
      <div className="range__rail" />
      <div
        className="range__fill"
        style={{ left: `${startPct}%`, right: `${100 - endPct}%` }}
      />
      <input
        type="range"
        className="range__input range__input--start"
        min={min}
        max={max}
        step={step}
        value={start}
        onChange={(e) => {
          const v = Math.min(Number(e.target.value), end);
          onChange(v, end);
        }}
      />
      <input
        type="range"
        className="range__input range__input--end"
        min={min}
        max={max}
        step={step}
        value={end}
        onChange={(e) => {
          const v = Math.max(Number(e.target.value), start);
          onChange(start, v);
        }}
      />
    </div>
  );
}
