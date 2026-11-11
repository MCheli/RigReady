import type { KnownDeviceInput } from '../known/schema';
import type { DeviceDrawingInput } from './silhouette';

/** Small helpers the shipped drawings are built with: paths use absolute commands only. */

/** A rounded rectangle as an absolute path. */
export function roundedRect(x: number, y: number, w: number, h: number, r: number): string {
  const right = x + w;
  const bottom = y + h;
  return (
    `M ${x + r} ${y} L ${right - r} ${y} Q ${right} ${y} ${right} ${y + r} ` +
    `L ${right} ${bottom - r} Q ${right} ${bottom} ${right - r} ${bottom} ` +
    `L ${x + r} ${bottom} Q ${x} ${bottom} ${x} ${bottom - r} ` +
    `L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y} Z`
  );
}

/** A circle as an absolute path (two arcs). */
export function circle(cx: number, cy: number, r: number): string {
  return `M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy} Z`;
}

/** The eight directions of a POV hat, each with its arrow. */
export const hat = (n: number): { id: string; tag: string }[] => [
  { id: `hat:${n}:U`, tag: '↑' },
  { id: `hat:${n}:R`, tag: '→' },
  { id: `hat:${n}:D`, tag: '↓' },
  { id: `hat:${n}:L`, tag: '←' },
  { id: `hat:${n}:UR`, tag: '↗' },
  { id: `hat:${n}:DR`, tag: '↘' },
  { id: `hat:${n}:DL`, tag: '↙' },
  { id: `hat:${n}:UL`, tag: '↖' },
];

/** A four-way switch whose directions are buttons. */
export const fourWay = (up: number, right: number, down: number, left: number) => [
  { id: `button:${up}`, tag: '↑' },
  { id: `button:${right}`, tag: '→' },
  { id: `button:${down}`, tag: '↓' },
  { id: `button:${left}`, tag: '←' },
];

type DrawnControl = DeviceDrawingInput['controls'][number];

/** Where one named control of a known device is on its drawing, and how it is marked. */
export type Place = Pick<DrawnControl, 'at' | 'side' | 'glyph' | 'hidden'>;

/**
 * The controls of a drawing made from a known device's map (`../known`): every control
 * keeps the maker's name and the inputs the map gives it, so the drawing and the named
 * list can never disagree. A control without a place is left off (the drawings test
 * fails on that, so none ships without one).
 */
export function placeKnown(
  device: KnownDeviceInput,
  places: Record<string, Place>
): DrawnControl[] {
  const controls: DrawnControl[] = [];
  for (const control of device.controls) {
    const place = places[control.id];
    if (!place) continue;
    controls.push({
      id: control.id,
      name: control.name,
      ...place,
      inputs: control.inputs.map((input) => ({
        id: input.id,
        ...(input.tag ? { tag: input.tag } : {}),
      })),
    });
  }
  return controls;
}
