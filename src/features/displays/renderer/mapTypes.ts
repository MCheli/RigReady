import type { Rotation } from '../../../shared/models';

/** One monitor as MonitorMap draws it. */
export interface MapMonitor {
  id: string;
  label: string;
  /** The Identify number; only monitors that are on have one. */
  number?: number | undefined;
  enabled: boolean;
  primary: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: Rotation;
  /** False for a monitor a saved layout wants but that is not connected. */
  connected?: boolean;
}
