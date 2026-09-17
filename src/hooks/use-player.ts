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

/** Default canvas size for the video-less (overlay-only) preview. */
const SYNTHETIC_SIZE: NativeSize = { w: 1920, h: 1080 };

/**
 * Owns the preview video element's transport state (time, playback, volume),
 * intrinsic size, and the export trim range. The trim range resets to the full
 * clip whenever a new video (URL) or duration is loaded.
 *
 * When no video is loaded but `fallbackDurationMs > 0` (e.g. only an `.osd`/
 * `.srt` is present), the hook runs a synthetic clock so the overlay can be
 * previewed and scrubbed without a video element.
 */
export function usePlayer(
  videoUrl: string | undefined,
  fallbackDurationMs = 0,
): UsePlayer {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [nativeSize, setNativeSize] = useState<NativeSize>({ w: 1920, h: 1080 });
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const rateRef = useRef(1);

  const hasVideo = Boolean(videoUrl);

  // Expose the element once it (re)mounts for the current source.
  useEffect(() => setVideoEl(videoRef.current), [videoUrl]);

  // Synthetic-mode timeline: adopt the fallback duration and reset transport
  // when there is no video source.
  useEffect(() => {
    if (hasVideo) return;
    setDuration(fallbackDurationMs);
    setCurrent(0);
    setPlaying(false);
    setTrimStart(0);
    setTrimEnd(fallbackDurationMs);
    setNativeSize(SYNTHETIC_SIZE);
  }, [hasVideo, fallbackDurationMs]);

  // Synthetic playback loop, advancing the clock with wall time * rate.
  useEffect(() => {
    if (hasVideo || !playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) * rateRef.current;
      last = now;
      setCurrent((c) => {
        const next = c + dt;
        if (next >= duration) {
          setPlaying(false);
          return duration;
        }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [hasVideo, playing, duration]);

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
    const clamped = clampMs(ms, 0, duration);
    const v = videoRef.current;
    if (v) {
      v.currentTime = clamped / 1000;
    } else {
      setCurrent(clamped);
    }
  }

  function togglePlay() {
    const v = videoRef.current;
    if (v) {
      if (v.paused) void v.play();
      else v.pause();
      return;
    }
    // Synthetic mode: restart from the beginning if parked at the end.
    setPlaying((p) => {
      if (!p && current >= duration) setCurrent(0);
      return !p;
    });
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
    rateRef.current = rate;
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
