import { SkipBack, SkipForward, Play, Pause, Volume2, VolumeX } from 'lucide-react';
import { formatMs } from '../lib/engine/clock';

interface TransportProps {
  current: number; // ms
  duration: number; // ms
  playing: boolean;
  volume: number; // 0..1
  onTogglePlay: () => void;
  onStepFrame: (dir: number) => void;
  onPlaybackRate: (rate: number) => void;
  onVolume: (v: number) => void;
}

/** Playback control bar: frame-step, play/pause, time, speed and volume. */
export function Transport({
  current,
  duration,
  playing,
  volume,
  onTogglePlay,
  onStepFrame,
  onPlaybackRate,
  onVolume,
}: TransportProps) {
  return (
    <div className="transport">
      <button className="btn" onClick={() => onStepFrame(-1)} aria-label="Previous frame">
        <SkipBack size={16} />
      </button>
      <button className="btn btn--primary" onClick={onTogglePlay}>
        {playing ? <Pause size={16} /> : <Play size={16} />}
        {playing ? 'Pause' : 'Play'}
      </button>
      <button className="btn" onClick={() => onStepFrame(1)} aria-label="Next frame">
        <SkipForward size={16} />
      </button>
      <span className="time">
        {formatMs(current)} / {formatMs(duration)}
      </span>
      <label className="speed">
        Speed
        <select defaultValue="1" onChange={(e) => onPlaybackRate(Number(e.target.value))}>
          <option value="0.25">0.25×</option>
          <option value="0.5">0.5×</option>
          <option value="1">1×</option>
          <option value="1.5">1.5×</option>
          <option value="2">2×</option>
        </select>
      </label>
      <label className="volume">
        {volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => onVolume(Number(e.target.value))}
          aria-label="Volume"
        />
      </label>
    </div>
  );
}
