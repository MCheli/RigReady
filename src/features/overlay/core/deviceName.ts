/**
 * A controller's name, short enough for one line of the overlay. Controllers call themselves
 * by everything they are made of ("WinWing THROTTLE BASE1 + F15EX HANDLE L + F15EX HANDLE R");
 * a glance over a cockpit needs "which hand". The name the user gave the device is always
 * used as it is (see `core/service.ts`); this is for a device without one.
 */

/** The longest name shown without cutting it. */
export const DEVICE_NAME_LENGTH = 26;

export function shortDeviceName(name: string, longest: number = DEVICE_NAME_LENGTH): string {
  // What it is built on comes first; what is mounted on it follows a " + ".
  const base = (name.split(/\s+\+\s+/)[0] ?? '').replace(/\s+/g, ' ').trim();
  const whole = base === '' ? name.replace(/\s+/g, ' ').trim() : base;
  if (whole.length <= longest) return whole;
  const cut = whole.slice(0, longest - 1);
  // Back to the end of a word, unless the cut is at one already or that would leave next
  // to nothing.
  const space = cut.lastIndexOf(' ');
  const wholeWords = whole[longest - 1] === ' ' || space < Math.floor(longest / 2);
  const kept = wholeWords ? cut : cut.slice(0, space);
  return `${kept.trimEnd()}…`;
}
