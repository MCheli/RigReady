/**
 * How a release says it is a security release, so the installed app can say so more
 * insistently than it says "a new version is downloaded" (docs/RELEASING.md, "Security
 * fixes"). The marker is the text `[security]` in the release's title, or at the start of
 * its notes: on its first line, or within its first 300 characters when the notes arrive
 * as one line (GitHub hands them over as HTML, which the updater flattens).
 */
export const SECURITY_MARKER = '[security]';

const MARKER = /\[security\]/i;
/** How much of the notes is looked at: the updater keeps this much of them. */
const NOTES_HEAD = 300;

export function isSecurityRelease(
  releaseName: string | null | undefined,
  notes: string | null | undefined
): boolean {
  if (releaseName && MARKER.test(releaseName)) return true;
  if (!notes) return false;
  const firstLine = notes.replace(/^\s+/, '').split(/\r?\n/)[0] ?? '';
  return MARKER.test(firstLine.slice(0, NOTES_HEAD));
}
