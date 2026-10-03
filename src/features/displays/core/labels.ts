import type { DisplayInfo, Rotation } from '../../../shared/models';

/** Friendly names the user gave monitors, by monitor id (lower case). */
export type MonitorNames = Record<string, string>;

/**
 * What a monitor is called in messages: the name the user gave it, otherwise its EDID
 * name, with "(2 of 3)" when several monitors in the list share that name.
 */
export function monitorLabels(
  monitors: { id: string; name: string }[],
  names: MonitorNames = {}
): Map<string, string> {
  const totals = new Map<string, number>();
  for (const m of monitors) totals.set(m.name, (totals.get(m.name) ?? 0) + 1);
  const seen = new Map<string, number>();
  const labels = new Map<string, string>();
  for (const m of monitors) {
    const id = m.id.toLowerCase();
    const total = totals.get(m.name) ?? 1;
    const n = (seen.get(m.name) ?? 0) + 1;
    seen.set(m.name, n);
    const friendly = names[id]?.trim();
    const base = m.name || 'Monitor';
    labels.set(id, friendly || (total > 1 ? `${base} (${n} of ${total})` : base));
  }
  return labels;
}

/**
 * The numbers "Identify" shows on the monitors and the map shows on the boxes: enabled
 * monitors from left to right, then top to bottom. A monitor that is off has no number
 * because nothing can be shown on it.
 */
export function monitorNumbers(monitors: DisplayInfo[]): Map<string, number> {
  const on = monitors.filter((m) => m.enabled).sort((a, b) => a.x - b.x || a.y - b.y);
  return new Map(on.map((m, i) => [m.id.toLowerCase(), i + 1]));
}

/** Windows' own words for each rotation. */
export function orientationText(rotation: Rotation): string {
  switch (rotation) {
    case 90:
      return 'Portrait';
    case 180:
      return 'Landscape (flipped)';
    case 270:
      return 'Portrait (flipped)';
    default:
      return 'Landscape';
  }
}

const NAME_MAX = 40;

/** A cleaned-up friendly name, or an error message. Empty means "remove the name". */
export function checkMonitorName(
  name: string,
  id: string,
  names: MonitorNames
): { ok: true; name: string } | { ok: false; message: string } {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (trimmed.length > NAME_MAX) {
    return { ok: false, message: `A monitor name can be at most ${NAME_MAX} characters.` };
  }
  const clash = Object.entries(names).find(
    ([other, n]) => other !== id.toLowerCase() && n.toLowerCase() === trimmed.toLowerCase()
  );
  if (trimmed && clash) {
    return { ok: false, message: `Another monitor is already called "${clash[1]}".` };
  }
  return { ok: true, name: trimmed };
}
