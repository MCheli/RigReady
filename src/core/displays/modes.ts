import type { DisplayMode } from '../../shared/models';

/**
 * The modes Windows lists for a monitor, in their unrotated (landscape) form, as
 * `DisplayMode` promises.
 *
 * GDI's EnumDisplaySettingsEx lists only the modes of the orientation the monitor has now,
 * and gives their size as the desktop sees it: while a 1024x768 screen is sideways it lists
 * 768x1024. `orientation` is that orientation as GDI reports it (dmDisplayOrientation): 0
 * landscape, 1 portrait (DMDO_90), 2 landscape flipped, 3 portrait flipped (DMDO_270).
 * Sideways modes are turned back; duplicates go; largest first, then fastest.
 */
export function unrotatedModes(
  listed: readonly DisplayMode[],
  orientation: number | undefined
): DisplayMode[] {
  const sideways = orientation === 1 || orientation === 3;
  const seen = new Map<string, DisplayMode>();
  for (const { width, height, refreshHz } of listed) {
    if (width === 0 || height === 0) continue;
    const mode = sideways
      ? { width: height, height: width, refreshHz }
      : { width, height, refreshHz };
    seen.set(`${mode.width}x${mode.height}@${mode.refreshHz}`, mode);
  }
  return [...seen.values()].sort(
    (a, b) => b.width * b.height - a.width * a.height || b.refreshHz - a.refreshHz
  );
}
