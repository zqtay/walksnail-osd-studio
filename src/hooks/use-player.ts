import { useEffect, useRef, useState } from 'react';
import { clampMs } from '../lib/engine/clock';

export interface NativeSize {
  w: number;
  h: number;
}

export interface UsePlayer {
  videoRef: React.RefObject<HTMLVideoElement>;
  /** The mounted video element, once available (for the overlay canvas). */
  videoEl: HTMLVideoElement | null;
  duration: number; // ms
  current: number; // ms
  playing: boolean;
  volume: number; // 0..1
  nativeSize: NativeSize;
  trimStart: number; // ms
  trimEnd: number; // ms
  setTrim: (startMs: number, endMs: number) => void;
  seek: (ms: number) => void;
  togglePlay: () => void;
  stepFrame: (dir: number) => void;
  changeVolume: (v: number) => void;
  setPlaybackRate: (rate: number) => void;
  /** Handlers to spread onto the preview <video> element. */
  videoHandlers: {
    onLoadedMetadata: () => void;
    onTimeUpdate: (e: React.SyntheticEvent<HTMLVideoElement>) => void;
    onPlay: () => void;
    onPause: () => void;
  };
}

/**
 * Owns the preview video element's transport state (time, playback, volume),
 * intrinsic size, and the export trim range. The trim range resets to the full
 * clip whenever a new video (URL) or duration is loaded.
 */
export function usePlayer(videoUrl: string | undefined): UsePlayer {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [nativeSize, setNativeSize] = useState<NativeSize>({ w: 1920, h: 1080 });
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);

  // Expose the element once it (re)mounts for the current source.
  useEffect(() => setVideoEl(videoRef.current), [videoUrl]);

  function onLoadedMetadata() {
    const v = videoRef.current;
    if (!v) return;
    const ms = v.duration * 1000;
    setDuration(ms);
    setTrimStart(0);
    setTrimEnd(ms);
    setNativeSize({ w: v.videoWidth || 1920, h: v.videoHeight || 1080 });
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

  function setPlaybackRate(rate: number) {
    const v = videoRef.current;
    if (v) v.playbackRate = rate;
  }

  function setTrim(startMs: number, endMs: number) {
    setTrimStart(clampMs(startMs, 0, endMs));
    setTrimEnd(clampMs(endMs, startMs, duration));
  }

  return {
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
    videoHandlers: {
      onLoadedMetadata,
      onTimeUpdate: (e) => setCurrent(e.currentTarget.currentTime * 1000),
      onPlay: () => setPlaying(true),
      onPause: () => setPlaying(false),
    },
  };
}
