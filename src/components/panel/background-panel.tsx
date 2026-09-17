import type { OverlaySettings } from '../../state/settings';

interface BackgroundPanelProps {
  settings: OverlaySettings;
  update: (patch: Partial<OverlaySettings>) => void;
  /** Whether a video is loaded (enables the video/background toggle). */
  hasVideo: boolean;
}

/**
 * Sidebar panel for the preview/export background. Picks the color shown behind
 * the overlay and, when a video is loaded, toggles between showing the video or
 * the background color in its place.
 */
export function BackgroundPanel({ settings, update, hasVideo }: BackgroundPanelProps) {
  return (
    <>
      {hasVideo && (
        <label className="toggle">
          <input
            type="checkbox"
            checked={settings.useBackground}
            onChange={(e) => update({ useBackground: e.target.checked })}
          />
          <span>Use background instead of video</span>
        </label>
      )}

      <label className="field field--color">
        <span>{hasVideo ? 'Background color' : 'Color (in place of video)'}</span>
        <input
          type="color"
          value={settings.bgColor}
          onChange={(e) => update({ bgColor: e.target.value })}
          aria-label="Background color"
        />
      </label>

      {!hasVideo && (
        <p className="hint">Shown in place of a video for preview and export.</p>
      )}
    </>
  );
}
