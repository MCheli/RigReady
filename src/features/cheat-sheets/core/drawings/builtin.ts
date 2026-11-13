import { F18_GRIP, F18_GRIP_BASE1 } from './f18Grip';
import { ICP } from './icp';
import { MFD_FRAME } from './mfd';
import { F16_GRIP, ORION_THROTTLE } from './orion';
import type { DeviceDrawingInput } from './silhouette';
import { STARTUP_PANEL } from './startupPanel';
import { TAKEOFF_PANEL_2 } from './takeoffPanel';
import { THRUSTMASTER_DRAWINGS } from './thrustmaster';
import { UFC_HUD } from './ufc';

/**
 * The drawings RigReady ships, drawn from scratch (no maker's artwork), CC0. Coordinates
 * are in each drawing's own units; the callout planner scales the drawing into the
 * middle of the canvas.
 *
 * Which input number sits on which physical control, and where that control is, comes
 * from a real map of the device: the maker's own test screen or number map, the default
 * profiles the game ships for it, and what the owner found by pressing. The sources for
 * every drawing are written down in docs/research/controller-drawings.md. A control is
 * marked `assumed` (its label shows "?") only where a number or a direction could not be
 * confirmed from such a source. An input the device reports and no source places is left
 * off the drawing; the page lists it under "More controls".
 */

export { F16_GRIP, F18_GRIP, F18_GRIP_BASE1, ICP, MFD_FRAME, ORION_THROTTLE };
export { STARTUP_PANEL, TAKEOFF_PANEL_2, UFC_HUD };

export const DRAWINGS: DeviceDrawingInput[] = [
  F16_GRIP,
  F18_GRIP_BASE1,
  F18_GRIP,
  ORION_THROTTLE,
  MFD_FRAME,
  UFC_HUD,
  ICP,
  STARTUP_PANEL,
  TAKEOFF_PANEL_2,
  ...THRUSTMASTER_DRAWINGS,
];
