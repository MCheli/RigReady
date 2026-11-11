import type { KnownControlSchema } from './schema';
import type { z } from 'zod';

/** Small helpers so a device's map reads like the maker's button list. */

type Control = z.input<typeof KnownControlSchema>;
type Axis = 'X' | 'Y' | 'Z' | 'RX' | 'RY' | 'RZ' | 'SLIDER1' | 'SLIDER2';

/** One button. */
export function button(id: string, name: string, n: number): Control {
  return { id, name, inputs: [{ id: `button:${n}` }] };
}

/** A switch or rocker with several positions, each its own button: [number, "Fwd"]. */
export function positions(id: string, name: string, items: [number, string][]): Control {
  return { id, name, inputs: items.map(([n, tag]) => ({ id: `button:${n}`, tag })) };
}

/** A hat whose directions are buttons, with an optional press in the middle. */
export function hatButtons(
  id: string,
  name: string,
  ways: { U: number; R: number; D: number; L: number; C?: number }
): Control {
  const items: [number, string][] = [
    [ways.U, '↑'],
    [ways.R, '→'],
    [ways.D, '↓'],
    [ways.L, '←'],
  ];
  if (ways.C !== undefined) items.push([ways.C, 'Press']);
  return positions(id, name, items);
}

const EIGHT = ['U', 'UR', 'R', 'DR', 'D', 'DL', 'L', 'UL'] as const;
const FOUR = ['U', 'R', 'D', 'L'] as const;
const ARROW: Record<(typeof EIGHT)[number], string> = {
  U: '↑',
  UR: '↗',
  R: '→',
  DR: '↘',
  D: '↓',
  DL: '↙',
  L: '←',
  UL: '↖',
};

/** A POV hat, 8-way unless the switch has only four directions (a coolie). */
export function pov(id: string, name: string, hat = 1, ways: 4 | 8 = 8): Control {
  return {
    id,
    name,
    inputs: (ways === 8 ? EIGHT : FOUR).map((d) => ({ id: `hat:${hat}:${d}`, tag: ARROW[d] })),
  };
}

/** Axes that belong together ("Stick": roll, pitch), each with its word. */
export function axes(id: string, name: string, items: [Axis, string][]): Control {
  return { id, name, inputs: items.map(([axis, tag]) => ({ id: `axis:${axis}`, tag })) };
}

/** One axis. */
export function axis(id: string, name: string, which: Axis): Control {
  return { id, name, inputs: [{ id: `axis:${which}` }] };
}
