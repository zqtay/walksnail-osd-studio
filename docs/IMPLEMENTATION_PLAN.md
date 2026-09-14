# Walksnail OSD Studio — Implementation Plan

Companion to [SPECIFICATION.md](SPECIFICATION.md). This plan sequences the build
into verifiable milestones, each ending in something runnable.

---

## 0. Tech Stack & Rationale

| Concern        | Choice | Why |
|----------------|--------|-----|
| Build/dev      | **Vite** + TypeScript | Fast, offline-friendly, easy PWA output |
| UI             | **React** (or Preact) | Component model for panels/controls |
| Styling        | CSS Modules / Tailwind | Small footprint, no runtime network |
| Overlay render | **Canvas 2D** (WebGL later) | Simplicity first; deterministic output |
| Video preview  | `<video>` + `requestVideoFrameCallback` | Frame-accurate clock |
| Export (primary) | **Mediabunny** (WebCodecs) | Demuxes source, composites overlay per frame, re-encodes H.264, copies audio losslessly — deterministic & glitch-free |
| Export (fallback) | `MediaRecorder` on canvas | Works where WebCodecs is unavailable; real-time capture, lower fidelity |
| PWA            | `vite-plugin-pwa` (Workbox) | Precache shell + export chunk for offline |
| Tests          | **Vitest** + Playwright | Unit (parsers) + e2e (playback/export) |

All dependencies are vendored/precached so the app runs with no network.

---

## 1. Project Structure

```
walksnail-osd/
├─ docs/                      # SPECIFICATION.md, IMPLEMENTATION_PLAN.md, examples/
├─ public/
│  └─ fonts/                  # bundled default OSD font atlases (.png)
├─ src/
│  ├─ parsers/
│  │  ├─ osd.ts               # binary .osd decoder
│  │  ├─ srt.ts               # SubRip + telemetry parser
│  │  ├─ font.ts              # PNG atlas → glyph sampler
│  │  └─ __tests__/           # fixtures use docs/examples
│  ├─ engine/
│  │  ├─ clock.ts             # time source + sync offsets + lookups
│  │  ├─ renderer.ts          # OSD grid + SRT panel compositor
│  │  ├─ compositor.ts        # shared draw for preview + export
│  │  └─ pairing.ts           # basename auto-pairing
│  ├─ export/
│  │  ├─ types.ts             # shared export option/result types
│  │  ├─ mediabunny.ts        # primary: Mediabunny conversion (lazy-loaded)
│  │  └─ media-recorder.ts    # fallback: real-time canvas capture
│  ├─ state/                  # settings store + localStorage persistence
│  ├─ ui/                     # React components
│  ├─ app.tsx
│  └─ main.tsx
├─ index.html
├─ vite.config.ts
└─ package.json
```

---

## 2. Data Model (TypeScript)

```ts
// parsers/osd.ts
interface OsdHeader { magic: string; unknown32: number; cols: number; rows: number; }
interface OsdFrame  { t: number; /* ms */ glyphs: Uint16Array; /* cols*rows */ }
interface OsdData   { header: OsdHeader; frames: OsdFrame[]; durationMs: number; }

// parsers/srt.ts
interface SrtCue { index: number; start: number; end: number; /* ms */
                   fields: Record<string, string | number>; raw: string; }
interface SrtData { cues: SrtCue[]; durationMs: number; }

// parsers/font.ts
interface FontAtlas { tileW: 24; tileH: 36; pages: number;
                      draw(ctx: CanvasRenderingContext2D, x: number, y: number,
                           glyph: number, scale: number): void; }
```

---

## 3. Milestones

### M0 — Scaffold & offline shell  *(exit: blank PWA runs offline)*
- Init Vite + TS + React; configure `vite-plugin-pwa` (precache shell).
- Strict CSP in `index.html` (§7 of spec). Verify no runtime network calls.
- Wire `docs/examples/*` as test fixtures.

### M1 — OSD parser  *(exit: unit tests green on sample)*
- Implement `parsers/osd.ts` with a bounds-checked `DataView` reader.
- Read header; **derive `frameSize` from `cols/rows`**; iterate frames to EOF.
- Guard: reject if `(fileLen-40) % frameSize !== 0`; cap allocations.
- Tests assert `cols=53, rows=20, frames=575, lastT=85773`.

### M2 — SRT parser  *(exit: unit tests green on sample)*
- Split blocks on blank lines; parse timecodes to ms.
- Tokenize data line by whitespace, split each on `:`/`=`, strip unit suffixes
  (`V`,`ms`,`Mbps`,`m`), numeric-coerce where possible, keep unknowns as strings.
- Tests assert 575 cues and correct field extraction for first/last cue.

### M3 — Font atlas  *(exit: glyphs render to canvas)*
- Load PNG → `createImageBitmap`; derive `pages = width / 24`.
- `draw()` maps glyph → `(page*24, row*36, 24,36)` blit with integer scale.
- Add 1–2 bundled default fonts in `public/fonts/`; font picker in UI.

### M4 — Overlay renderer + clock  *(exit: OSD overlays a playing video)*
- `clock.ts`: expose `timeMs`, `osdOffsetMs`, `srtOffsetMs`; binary-search the
  active OSD frame and SRT cue.
- `renderer.ts`: draw OSD grid onto an overlay `<canvas>` sized to the video;
  skip `0x20`; scale tiles to fit; then draw the configurable SRT panel.
- Drive redraws from `requestVideoFrameCallback` (fallback `rAF`).

### M5 — Player UI & file handling  *(exit: full interactive review)*
- Modern single-screen layout: large preview with live overlay, timeline with
  scrub head **and draggable in/out trim handles**, collapsible settings sidebar
  (Files / OSD / SRT / Export). Light & dark themes; drag-and-drop onto preview.
- Drag/drop + pickers; `pairing.ts` auto-pairs by basename; manual reassign.
- Transport controls, speed, frame-step, seek bar; per-track sync offset sliders.
- OSD controls: H/V position (px), size %, center/reset, and a **position mask**
  editor to hide selected grid cells.
- Overlay settings panel (field toggles, position, size, opacity); persist to
  `localStorage`. Robust error surfaces for bad/truncated files.
- The reference `docs/examples/ui.JPG` guides features only — not the layout.

### M6 — Export pipeline  *(exit: downloadable burned-in clip)*
- **Trim range:** dual-thumb slider in the Export panel; export only the
  `[start, end]` range, validated (`start < end`, within bounds), overlay aligned
  to the original timeline.
- Overlay compositing is shared with the live preview via `engine/compositor.ts`
  (`drawOverlay`), so preview and export are pixel-identical.
- **Mediabunny path (primary):** `Conversion` reads the source `File`
  (`BlobSource`), trims to range, decodes sequentially, composites the overlay in
  the per-frame `process` hook (frames carry input-file timestamps that align
  with the OSD/SRT timelines), re-encodes H.264 to an `Mp4OutputFormat` +
  `BufferTarget`, and copies audio losslessly. Deterministic and glitch-free —
  no real-time playback or per-frame seeking. Lazy-loaded to keep the initial
  bundle small; the chunk is precached for offline use.
- **MediaRecorder path (fallback):** fixed-fps `captureStream` of a canvas with
  WebAudio-sourced audio; used only when WebCodecs is unavailable.
- Options: trim, resolution (native / down / **upscale**), bitrate, audio
  include/drop; progress + cancel via `AbortSignal`.
- Output downloads as `<name>-osd.mp4`.
- Verify OSD layer is pixel-identical to preview at sampled timestamps.

> Future options still open: chroma-key background for transparent-OSD
> compositing, and WebM/VP9 output. Not yet implemented.

### M7 — Hardening & polish  *(exit: acceptance criteria met)*
- Playwright e2e: load sample → assert overlay → export → validate output opens.
- Fuzz parsers with truncated/garbage inputs (no crashes; last frame held).
- Perf pass (≥30 fps @1080p); memory cleanup / object-URL revocation.
- Docs: README with usage, browser support matrix, and known limits.

---

## 4. Key Algorithms

**Active OSD frame (step/hold, O(log n)):**
```ts
function frameAt(frames: OsdFrame[], tMs: number): OsdFrame | null {
  let lo = 0, hi = frames.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1;
    if (frames[m].t <= tMs) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans < 0 ? null : frames[ans];
}
```

**OSD grid render:**
```ts
for (let r = 0; r < rows; r++)
  for (let c = 0; c < cols; c++) {
    const g = frame.glyphs[r * cols + c];
    if (g === 0x20) continue;               // space → nothing
    font.draw(ctx, c * tileW * scale, r * tileH * scale, g, scale);
  }
```

**Timecode parse:** `HH:MM:SS,mmm → ((HH*60+MM)*60+SS)*1000 + mmm`.

---

## 5. Testing Strategy
- **Unit (Vitest):** parsers against `docs/examples` fixtures; timecode + token
  edge cases; font page-count derivation.
- **Golden-image:** render known frames, compare canvas hashes (preview==export).
- **E2E (Playwright):** headed Chromium — load, scrub, offset, export, re-open.
- **Fuzz:** truncated/oversized headers, non-multiple file lengths, empty SRT.

---

## 6. Risks & Mitigations
| Risk | Mitigation |
|------|-----------|
| Font atlas layout varies by variant | Derive pages from width; test BF+INAV fonts; allow manual tile-size override |
| WebCodecs H.265 gaps | Default export to H.264/MP4; ffmpeg.wasm fallback |
| Audio remux in WebCodecs | Use ffmpeg.wasm path when "copy audio" is on |
| DVR/telemetry desync | Manual per-track ms offset (FR-7) |
| Large clips / memory | Stream export frame-by-frame in worker; release bitmaps |
| Header field `@32` unknown | Don't depend on it; read cols/rows only |

---

## 7. Definition of Done
- All acceptance criteria (spec §8) pass in CI (unit + e2e).
- App installs as a PWA and runs fully offline after first load.
- Sample `docs/examples` pair loads, previews, and exports correctly.
- No unhandled exceptions on malformed input; media never leaves the device.
