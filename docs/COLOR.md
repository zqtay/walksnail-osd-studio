# Export Color Handling

Notes on how color range and color space flow through the export pipeline, the
contrast problem found in exported videos, and why the raw DVR can look
different in some players. Findings date from 2026-10-23.

---

## 1. Summary
- Exports used to be encoded as **full range with the sRGB transfer function**,
  because that is what Chrome's `VideoEncoder` produces from RGB canvas frames.
  Color-managed players render that with a lighter tone curve, so exports
  looked lower in contrast than the source.
- Exports are now converted to **BT.709 limited range** before encoding
  ([`src/lib/export/yuv.ts`](../src/lib/export/yuv.ts)). This is the standard
  for camera footage and the most widely supported format.
- Walksnail DVR files are **full range BT.601**. VLC 3 on Windows shows them
  with too much contrast because it ignores the full-range flag. The export
  matches the source when the source is decoded correctly (as Premiere Pro does).

---

## 2. Source Format (Walksnail DVR)
Measured on `AscentG0259.mp4` (Avatar DVR, 1280×720 @ 60 fps):

| Property  | Value                        |
|-----------|------------------------------|
| Codec     | H.264 High                   |
| Pixel fmt | `yuvj420p`                   |
| Range     | `pc` (full, 0–255)           |
| Matrix    | `smpte170m` (BT.601)         |
| Primaries | `smpte170m`                  |
| Transfer  | `smpte170m`                  |

Browsers decode this correctly into RGB for the `<video>` preview and for
`VideoSample.draw()` during export.

---

## 3. Export Color Path
1. Mediabunny decodes each source frame (`Conversion`, WebCodecs).
2. The frame is drawn onto a 2D canvas (RGB), then the overlay is drawn on top.
3. The canvas is read back (`getImageData`) and converted in JS to I420
   (4:2:0) using the BT.709 matrix in limited range: `canvasToVideoSample()` in
   [`yuv.ts`](../src/lib/export/yuv.ts).
4. The I420 sample is tagged `{ primaries: bt709, transfer: bt709,
   matrix: bt709, fullRange: false }` and handed to the encoder.

The overlay-only export (no video file) uses the same conversion.

### 3.1 Why not pass the canvas to the encoder directly
Passing an RGB canvas frame (`new VideoSample(canvas)` / `CanvasSource`) leaves
the RGB→YUV conversion to Chrome. Tested in Chrome on Windows, the encoder
reports and writes:

| Property  | Value                         |
|-----------|-------------------------------|
| Range     | full                          |
| Matrix    | `bt709`                       |
| Primaries | `bt709`                       |
| Transfer  | `iec61966-2-1` (sRGB)         |

These tags appear both in the H.264 SPS (VUI) and in the MP4 `colr` box.
`VideoFrame` cannot take a color space override when built from a canvas, so
the only way to control the output tags is to provide YUV data ourselves.
Exports made before this change carry exactly these tags.

### 3.2 Trade-offs
- Each frame is read back from the canvas and converted on the CPU, so exports
  are somewhat slower, more so at 4K. Not yet measured on real footage.
- Super-black / super-white values (below 16 or above 235 in the source) are
  clipped by the RGB round trip. This is invisible in normal viewing.
- The `MediaRecorder` fallback (used without WebCodecs) is unchanged. Its
  color tags are chosen by the browser.

---

## 4. Verification

### 4.1 Synthetic test
A 640×360 SMPTE HD bars clip (`yuv420p`, `tv`, BT.709) run through
`exportWithMediabunny` in headless Chrome:

| File   | Tags              | Y avg   | Y min / max |
|--------|-------------------|---------|-------------|
| Source | `tv`, BT.709      | 103.48  | 0 / 254     |
| Export | `tv`, BT.709      | 103.53  | 15 / 237    |

The min/max difference comes from the PLUGE patches (super-black/white), see
§3.2.

### 4.2 Real footage
`AscentG0259.mp4` vs `AscentG0259-osd.mp4` (exported after the fix). Four
frame-exact samples, decoded to RGB with explicit range/matrix, OSD pixels
masked out (~98% of pixels kept). Values are luma percentiles p1 / p50 / p99
and standard deviation:

| Frame | Export                     | Raw, decoded as full range | Raw, decoded as limited    |
|-------|----------------------------|----------------------------|----------------------------|
| 1200  | 12 / 59 / 178, σ 51.5      | 15 / 60 / 178, σ 51.3      | 3 / 51 / 188, σ 59.4       |
| 3600  | 18 / 114 / 175, σ 52.9     | 20 / 114 / 175, σ 52.4     | 6 / 115 / 185, σ 61.0      |
| 6000  | 15 / 115 / 172, σ 54.1     | 17 / 115 / 172, σ 53.6     | 3 / 115 / 181, σ 62.4      |
| 8400  | 11 / 41 / 200, σ 43.2      | 17 / 42 / 200, σ 43.0      | 6 / 35 / 214, σ 48.2       |

Mean absolute difference vs the export: ~2 levels for the correct decode,
~8 levels when the raw file is wrongly decoded as limited range. The export is
faithful to the source.

---

## 5. Player Behavior

| Player              | Raw DVR (full range)        | Export (limited range) |
|---------------------|-----------------------------|------------------------|
| Premiere Pro        | Correct                     | Correct                |
| VLC 3 (Windows)     | Too much contrast           | Correct                |

VLC appears to ignore the full-range flag on the raw DVR and decodes it as
limited range, crushing blacks and pushing whites up (the "decoded as limited"
column in §4.2). Observed with VLC 3.0.16; disabling hardware-accelerated
decoding does not change it.

To confirm in a given player, convert the first seconds of the raw DVR to the
export's format (no OSD) and compare it with the raw file:

```sh
ffmpeg -i raw.mp4 -t 20 -an \
  -vf "scale=in_range=pc:out_range=tv:in_color_matrix=bt601:out_color_matrix=bt709,format=yuv420p" \
  -c:v libx264 -crf 10 -color_range tv -colorspace bt709 -color_primaries bt709 -color_trc bt709 \
  raw-as-limited-bt709.mp4
```

The two files hold the same picture. If the player shows them differently, it
is mishandling one of the two formats.

Because VLC is wrong about the source, not the export, no change to the export
format is needed.

---

## 6. How to Check a File

Color tags:

```sh
ffprobe -v error -select_streams v \
  -show_entries stream=pix_fmt,color_range,color_space,color_primaries,color_transfer \
  -of compact file.mp4
```

- `color_transfer=iec61966-2-1` → exported before the fix.
- `color_range=tv`, `color_transfer=bt709` → current export format.

Frame-exact RGB extraction with an explicit interpretation (useful for
comparing a source against an export):

```sh
# Raw DVR, decoded correctly
ffmpeg -i raw.mp4 -vf "select='eq(n\,3600)',scale=in_range=pc:in_color_matrix=bt601:out_range=pc,format=rgb24" -vsync 0 raw.png
# Export
ffmpeg -i export.mp4 -vf "select='eq(n\,3600)',scale=in_range=tv:in_color_matrix=bt709:out_range=pc,format=rgb24" -vsync 0 exp.png
```

Avoid `-ss` seeking for this kind of comparison: it can land on different
frames in the two files.
