/**
 * What kind of thing a device of a setup is: the picture and the word for it. The kinds,
 * the rule that tells them from a name, and the picture and the word for each live in
 * core: setups made from the rig and the Devices page use them too.
 */

import { deviceKind, KIND_ICON, KIND_NAME, type DeviceKind } from '../../../core/gearKind';

export { deviceKind, KIND_ICON, KIND_NAME, type DeviceKind };

/**
 * Names short enough for a row of chips: the word most of the devices begin with (their
 * maker: "WINWING MFD1-L", "WINWING UFC1 + HUD1") is left out, since it tells them apart
 * from nothing. Only when more than half of them share it, and only when the short names
 * still tell every device apart; a name that would be left with next to nothing keeps the
 * word. The whole name stays in the tooltip.
 */
export function chipNames(names: string[]): string[] {
  const whole = names.map((name) => name.trim());
  const first = (name: string): string => name.split(/\s+/)[0] ?? '';
  const counts = new Map<string, number>();
  for (const name of whole) {
    const word = first(name).toLowerCase();
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  const [make, count] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
  // A word, not a number, that more than half of the devices begin with.
  if (count < 2 || count * 2 <= whole.length || !/^[a-z][\w-]*$/.test(make)) return whole;
  const short = whole.map((name) => {
    const word = first(name);
    const rest = name.slice(word.length).trim();
    return word.toLowerCase() === make && rest.length >= 3 ? rest : name;
  });
  const distinct = new Set(short.map((name) => name.toLowerCase())).size;
  return distinct === new Set(whole.map((name) => name.toLowerCase())).size ? short : whole;
}
