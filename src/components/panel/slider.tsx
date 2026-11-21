interface SliderProps {
  label: string;
  suffix: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  /** Custom value display (defaults to value + suffix). */
  format?: (v: number) => string;
}

/** Labeled range input showing the current value with a unit suffix. */
export function Slider({
  label,
  suffix,
  min,
  max,
  step,
  value,
  onChange,
  format,
}: SliderProps) {
  return (
    <label className="field">
      <span>
        {label}{' '}
        <em>{format ? format(value) : `${value}${suffix}`}</em>
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
