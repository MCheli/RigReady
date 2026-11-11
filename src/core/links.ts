/**
 * The links RigReady hands to another program (`AppWindow.openLink`): web pages, and the
 * install links of the AI assistants it can connect. Every other scheme is refused, so a
 * link built from data can never start a program of its own choosing.
 */
export const OPENABLE_LINK_SCHEMES = [
  'https:',
  'cursor:',
  'vscode:',
  'vscode-insiders:',
  'lmstudio:',
  'goose:',
] as const;

/** Longer than any install link RigReady builds; a longer one is refused. */
const MAX_LINK = 8192;

/** True when `url` is a link `AppWindow.openLink` may hand on. */
export function isOpenableLink(url: string): boolean {
  if (url.length > MAX_LINK || /[\s\u0000-\u001f]/.test(url)) return false;
  let scheme: string;
  try {
    scheme = new URL(url).protocol;
  } catch {
    // Not a link at all.
    return false;
  }
  return (OPENABLE_LINK_SCHEMES as readonly string[]).includes(scheme);
}
