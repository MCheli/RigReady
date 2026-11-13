/**
 * A text no longer than `max` characters. One that is longer is cut there, and says so:
 * an ellipsis and how much is left out, so nobody reads a cut line as the whole of it.
 */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const left = text.length - max;
  return `${text.slice(0, max)}… (${left} more ${left === 1 ? 'character' : 'characters'} not shown)`;
}
