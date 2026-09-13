# Walksnail OSD Studio — Specification

A fully client-side, offline-capable web application that combines a **Walksnail
Avatar DVR video** with its recorded **`.osd`** overlay (from Betaflight / INAV)
and **`.srt`** link-telemetry track, renders the composite in real time, and can
export a video with the OSD burned in.

---

## 1. Goals & Non-Goals

### 1.1 Goals
- Play a Walksnail `.mp4` DVR clip in the browser with a pixel-accurate OSD
  overlay reconstructed from the matching `.osd` file and OSD font atlas.
- Overlay an optional, styleable telemetry panel derived from the `.srt` link
  data (signal, latency, bitrate, battery, distance, flight time…).
- Run **100% locally / offline** — no upload, no backend, works from `file://`
  or an installed PWA with no network.
- Export the composited result to a downloadable video file (OSD + optional SRT
  panel burned into the frames), including a selectable **start/end trim range**.
- Be forgiving about file naming and timing mismatches (manual sync offset).

> **UI note:** `docs/examples/ui.JPG` shows an existing *native* tool only as a
> feature reference. The web app is **not** constrained to that layout — its UI
> must be intuitive and modern (see §4.6).

### 1.2 Non-Goals (initial release)
- Editing/authoring OSD element layouts (we render what the FC recorded).
- GPS map / track rendering (the Walksnail `.srt` contains link telemetry, not
  GPS position — see §3.3).
- Cloud storage, accounts, or sharing features.
- Mobile-first UX (desktop Chromium is the primary target for export).

---

## 2. Users & Primary Use Cases

| # | Use case | Flow |
|---|----------|------|
| 1 | Review a flight with OSD | Load `.mp4` + `.osd` + font → scrub/playback with overlay |
| 2 | Add link telemetry panel | Additionally load `.srt` → toggle/position panel |
| 3 | Fix A/V-OSD desync | Adjust a millisecond offset until OSD matches action |
| 4 | Produce a shareable clip | Configure overlay → export burned-in `.mp4`/`.webm` |
| 5 | Batch-style quick preview | Drag a folder; app auto-pairs files by basename |

---

## 3. Input File Formats

All three inputs typically share a basename, e.g. `AscentG0177.mp4`,
`AscentG0177.osd`, `AscentG0177.srt`. The app auto-pairs by basename but allows
manual assignment.

### 3.1 Walksnail `.osd` (verified from `docs/examples/AscentG0177.osd`)

Little-endian binary.

**Header (40 bytes):**

| Offset | Size | Type   | Field      | Sample value | Notes |
|-------:|-----:|--------|------------|--------------|-------|
| 0      | 4    | ASCII  | `magic`    | `"BTFL"`     | FC firmware id (also INAV/ARDU/etc.) |
| 4      | 28   | bytes  | `reserved` | all `0x00`   | Name/padding |
| 32     | 4    | u32    | `unknown`  | `200`        | Likely font/char count or version marker |
| 36     | 2    | u16    | `cols`     | `53`         | Grid columns (HD) |
| 38     | 2    | u16    | `rows`     | `20`         | Grid rows (HD) |

**Frame stream (begins at offset 40):** repeated fixed-size records until EOF.

```
frame {
  u32  timestamp_ms;              // display time, milliseconds
  u16  glyphs[cols * rows];       // font atlas indices, row-major; 0x20 = space
}
frameSize = 4 + cols * rows * 2   // = 2124 for 53x20
```

Verified against the sample: `cols=53, rows=20, frameSize=2124`, 575 frames,
`40 + 2124 × 575 = 1,221,340` bytes = exact file size. Timestamps are
milliseconds (`0, 115, 259, … 85773`).

**Playback rule:** for video time `t` ms, render the OSD frame with the greatest
`timestamp_ms ≤ t` (step/hold, not interpolated). Glyph `0x20` (space) renders
nothing.

**Update rate is decoupled from the DVR frame rate.** The OSD stream is written
at the goggle's telemetry/MSP cadence (~5–10 Hz), *not* once per video frame. In
the sample the 575 frames span 85.77 s → **~6.7 frames/s**, with inter-frame
gaps of 108–178 ms (avg ~149 ms). Consequently a 1-second clip has ~7 OSD
frames regardless of whether the DVR records at 60 fps or 100 fps — the file
does **not** contain one frame per video frame. Each OSD frame is *held* across
all video frames that fall within its interval. This is why sync is driven by
the absolute `timestamp_ms` timeline rather than by frame index, and why fast-
changing OSD elements visibly "step" at ~7 Hz in the source recording.

> The grid is `53 × 20` for HD/widescreen. SD or other FC configs may differ, so
> `cols`/`rows` **must** be read from the header, never hard-coded.

### 3.2 OSD Font Atlas (`.png`)

Glyph indices are 16-bit, so a font must supply **more than 256 glyphs**
(Betaflight/INAV use multiple 256-glyph pages). The app follows the
[`walksnail-osd-tool`](https://github.com/avsandbox/walksnail-osd-tool)
convention:

- Tile size **24 × 36 px** (Walksnail Avatar native).
- PNG mosaic composed of one or more 256-glyph **pages** laid out in columns;
  glyphs stacked vertically within a page.
- Glyph `g` → `page = g >> 8`, `row = g & 0xFF`; source rect
  `(page * 24, row * 36, 24, 36)`.
- The user supplies the font (BF/INAV variant). The app ships a small set of
  bundled default fonts and remembers the last used one.

> Exact page/column arrangement is validated against real font files during
> implementation; the loader is written to be tolerant of 1-, 2-, and 4-page
> atlases by deriving page count from image width / 24.

### 3.3 Walksnail `.srt` (verified from `docs/examples/AscentG0177.srt`)

Standard SubRip structure — index line, `HH:MM:SS,mmm --> HH:MM:SS,mmm` timecode,
then a single data line. This is **VRX link telemetry, not GPS.**

Example data line:

```
Signal:4 CH:1 Hz:5475000 FlightTime:0 Sp=26 Gp=30 SBat:9.7V GBat:11.9V Delay:47ms Bitrate:25.0Mbps Distance:10m
```

Fields (note the mixed `:` and `=` separators and unit suffixes):

| Key        | Meaning                              | Unit  |
|------------|--------------------------------------|-------|
| `Signal`   | Link signal quality                  | 0–4   |
| `CH`       | Channel                              | —     |
| `Hz`       | Frequency                            | Hz    |
| `FlightTime` | Seconds since arm                  | s     |
| `Sp`       | Sky (aircraft) link strength/power   | —     |
| `Gp`       | Ground (goggle) link strength/power  | —     |
| `SBat`     | Sky/aircraft VTX battery voltage     | V     |
| `GBat`     | Ground/goggle battery voltage        | V     |
| `Delay`    | Video latency                        | ms    |
| `Bitrate`  | Video bitrate                        | Mbps  |
| `Distance` | Estimated distance                   | m     |

Parser must be schema-tolerant: extract every `Key:Value` / `Key=Value` token,
strip known unit suffixes (`V`, `ms`, `Mbps`, `m`), and keep unknown keys as raw
strings so future firmware fields still display. The sample has **575 cues**
(note: the index `574` appears twice, so indices run 1..574 across 575 blocks).

Like the OSD stream, cues are emitted at the VRX telemetry cadence (~7 Hz, each
cue ~130–150 ms long), **not** once per DVR video frame. The active cue is
selected by its `HH:MM:SS,mmm` time interval, so the panel stays aligned at any
DVR frame rate.

### 3.4 Video (`.mp4`)
- Standard Walksnail Avatar DVR H.264/H.265 MP4. Decoded via the native
  `<video>` element for preview and via WebCodecs for export where available.

---

## 4. Functional Requirements

### 4.1 Loading & Pairing
- FR-1 Accept files via drag-and-drop and file pickers (video, osd, srt, font).
- FR-2 Auto-pair `.mp4`/`.osd`/`.srt` by common basename; allow manual override.
- FR-3 Validate each file (magic bytes, header sanity, SRT structure) and show
  clear, actionable errors; partial loads are allowed (e.g. video + osd only).
- FR-4 Persist the last-used font and overlay settings in `localStorage`.

### 4.2 Playback & Sync
- FR-5 Play/pause, seek, frame-step, and speed control (0.25×–2×).
- FR-6 Overlay is driven off the video's `currentTime`; OSD frame chosen by the
  step/hold rule (§3.1); SRT record chosen by active subtitle interval.
- FR-7 Global **sync offset** (± ms) applied independently to OSD and SRT to
  correct DVR/telemetry misalignment; adjustable live.
- FR-8 Maintain sync during pause, seek, and variable playback rate.

### 4.3 Rendering
- FR-9 Reconstruct the OSD grid to a `<canvas>` overlay scaled to the video,
  preserving aspect ratio and integer-friendly tile scaling to avoid blur.
- FR-10 Configurable telemetry panel: field selection, position, font size,
  background opacity, units; can be toggled off entirely.
- FR-11 OSD adjustments: horizontal/vertical position offset (px), scale/size %,
  center/reset helpers, and a **position mask** to hide chosen grid cells (e.g.
  suppress the crosshair or duplicated elements).
- FR-12 Render must be deterministic so preview and export match exactly.

### 4.4 Export
- FR-13 Export a video with OSD (and optional SRT panel) burned into frames.
- FR-14 **Trim range:** user selects a start and end time (via numeric fields
  and draggable in/out handles on the timeline); only that range is exported.
  Defaults to the full clip; validated so `start < end` within clip bounds.
- FR-15 Preferred pipeline: **WebCodecs** (`VideoDecoder`/`VideoEncoder`) +
  `mp4-muxer`/`webm-muxer`; fallback: `ffmpeg.wasm`; last resort:
  `MediaRecorder` capture of the canvas.
- FR-16 Export options: resolution passthrough / downscale / **upscale**,
  bitrate, encoder & container (`.mp4` H.264 / `.webm` VP9), whether to copy or
  drop the audio track, and an optional **chroma-key background** (solid color
  behind a transparent video, for compositing the OSD in an NLE).
- FR-17 Progress UI with cancel; export runs in a Web Worker to keep UI responsive.

### 4.5 Offline / PWA
- FR-18 Installable PWA; service worker precaches the app shell and WASM assets.
- FR-19 No network requests at runtime; all processing is local. CSP forbids
  remote origins.

### 4.6 UX / UI
- FR-20 Modern, intuitive single-screen layout: a large video/preview area with
  the overlay composited live, a timeline with scrub + in/out trim handles, and
  a collapsible settings sidebar (Files, OSD, SRT, Export).
- FR-21 Responsive, keyboard-accessible controls; light/dark theme; drag-and-drop
  onto the preview. Settings changes reflect in the preview immediately.
- FR-22 The reference native UI (`docs/examples/ui.JPG`) is inspiration only; the
  web UI is free to diverge for clarity and modern ergonomics.

---

## 5. Non-Functional Requirements
- NFR-1 **Privacy:** media never leaves the device.
- NFR-2 **Performance:** ≥30 fps preview at 1080p on a mid-range laptop; OSD
  frame lookup is O(log n) (binary search over sorted timestamps).
- NFR-3 **Accuracy:** preview and export are pixel-identical for the OSD layer.
- NFR-4 **Robustness:** malformed/truncated files never crash the app; the last
  valid frame is held.
- NFR-5 **Portability:** primary target latest Chromium (WebCodecs); graceful
  degradation (ffmpeg.wasm / MediaRecorder) elsewhere; preview-only on Safari if
  needed.
- NFR-6 **Security:** see §7.

---

## 6. Architecture Overview

```
┌────────────────────────────────────────────────────────────┐
│                        UI (framework)                       │
│  FileDropZone · PlayerControls · OverlaySettings · Export   │
└───────────────┬───────────────────────────┬────────────────┘
                │                            │
        ┌───────▼────────┐          ┌────────▼─────────┐
        │  Media Engine  │          │  Overlay Engine  │
        │  <video>, clock│  time →  │  OSD + SRT render │
        └───────┬────────┘          └────────┬─────────┘
                │                            │
      ┌─────────▼─────────┐        ┌─────────▼──────────┐
      │   Parsers (pure)  │        │  Font Atlas (bitmap)│
      │ osd · srt · font  │        │  24×36 tile sampler │
      └───────────────────┘        └────────────────────┘
                │
        ┌───────▼─────────────────────────────┐
        │  Export Worker (WebCodecs/ffmpeg.wasm)│
        └───────────────────────────────────────┘
```

**Modules**
- `parsers/osd.ts` — header + frame decoder → `{ cols, rows, frames: {t, glyphs}[] }`.
- `parsers/srt.ts` — SubRip + telemetry tokenizer → `{ start, end, fields }[]`.
- `parsers/font.ts` — PNG → `ImageBitmap` pages + `drawGlyph(ctx,x,y,index,scale)`.
- `engine/clock.ts` — single source of truth for time + offsets; binary-search
  lookups for the active OSD frame and SRT cue.
- `engine/renderer.ts` — deterministic canvas compositor (OSD grid + SRT panel).
- `export/worker.ts` — frame-accurate re-encode.
- `state/` — settings + persistence.

---

## 7. Security & Privacy Requirements
- Strict CSP: `default-src 'self'`; `worker-src 'self' blob:`;
  `img-src 'self' blob: data:`; `media-src 'self' blob:`; no `connect-src`
  to remote origins. `wasm-unsafe-eval` only if required by ffmpeg.wasm.
- All file input treated as untrusted: bounds-checked binary reads, capped array
  allocations from header values, guarded against integer-overflow frame counts.
- No `eval`/dynamic remote code. Third-party WASM pinned by hash and precached.
- Object URLs revoked on unload; no persistent copies of user media.

---

## 8. Acceptance Criteria
- AC-1 Loading the `docs/examples` pair reconstructs an OSD that visually matches
  the original DVR overlay across the full 0–85.7 s timeline.
- AC-2 Parser reports `cols=53, rows=20, 575 frames` for the sample `.osd`.
- AC-3 SRT panel shows all 11 fields with correct units and updates each cue.- AC-4 Sync offset visibly shifts the overlay and is remembered per session.
- AC-5 Export produces a playable file whose OSD layer is pixel-identical to the
  preview at matching timestamps.
- AC-6 Setting a trim in/out range exports only that segment, with correct
  duration and the overlay aligned to the original timeline.
- AC-7 With the network disabled after first load, the installed PWA fully works.

---

## 9. Open Questions / Risks
- Meaning of the `u32` at header offset 32 (currently `200`) — confirm against
  other captures / firmwares.
- Exact font-atlas page arrangement per variant — validate loader against real
  BF and INAV font PNGs.
- WebCodecs H.265 decode/encode support varies; MP4/H.264 is the safe export path.
- Audio passthrough during WebCodecs export requires demux/remux of the original
  audio track (ffmpeg.wasm fallback covers this reliably).
