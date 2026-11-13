import type { ActivityEntry } from '../core/activity';

/**
 * How a call of an assistant ended, said to the person at the PC. The record's own message
 * is written for the assistant ("The user did not allow ..."), so the window never repeats
 * it for an outcome that was the person's own doing: the list of what assistants did and
 * the short line after a change both say "You said no."
 */
export function outcomeLine(entry: Pick<ActivityEntry, 'outcome' | 'message'>): string {
  const said = entry.message.trim();
  switch (entry.outcome) {
    case 'ok':
      // "Done" alone is what a call with nothing to say answers: not said twice.
      return said === '' || said === 'Done' ? 'Done.' : `Done. ${said}`;
    case 'error':
      return said === '' ? 'Failed.' : `Failed. ${said}`;
    case 'denied':
      return 'You said no.';
    case 'timeout':
      return 'Not answered in time, so it did not run.';
    case 'refused':
      return 'Not offered to assistants, so it did not run.';
    case 'busy':
      return 'RigReady was busy with another change, so it did not run.';
    case 'rate':
      return 'Too many calls at once, so it did not run.';
  }
}

/** What stands in the text to paste where a pairing's token is, until the user asks to see it. */
export const HIDDEN_TOKEN = '<token hidden>';

/** The text to paste as the page shows it: with the token only when the user asked to see it. */
export function textAsShown(text: string, token: string | undefined, shown: boolean): string {
  return token && !shown ? text.split(token).join(HIDDEN_TOKEN) : text;
}
