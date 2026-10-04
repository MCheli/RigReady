/**
 * The arguments of a Windows shortcut (.lnk). A shortcut stores them as one text; the
 * program that is started reads its arguments back out of it by Windows' own rules
 * (CommandLineToArgvW, the C runtime). These two functions are those rules, both ways, so
 * RigReady can hand a shortcut a list of values and read a list of values back.
 *
 * No shell is involved: Explorer starts the target itself and never interprets the text,
 * so `&`, `|`, `%` and `$( )` are ordinary characters in a value.
 */

/** One value as it must be written so that it is read back as exactly this value. */
function quoteWindowsArg(value: string): string {
  if (value.length > 0 && !/[\s"]/.test(value)) return value;
  let out = '"';
  let backslashes = 0;
  for (const ch of value) {
    if (ch === '\\') {
      backslashes++;
      continue;
    }
    if (ch === '"') {
      // Backslashes before a quote are doubled, and the quote itself is escaped.
      out += '\\'.repeat(backslashes * 2 + 1) + '"';
    } else {
      out += '\\'.repeat(backslashes) + ch;
    }
    backslashes = 0;
  }
  // Backslashes before the closing quote are doubled too.
  return `${out}${'\\'.repeat(backslashes * 2)}"`;
}

/** The values as the one text a shortcut stores. */
export function joinWindowsArgs(args: readonly string[]): string {
  return args.map(quoteWindowsArg).join(' ');
}

/** The values a program gets from the text a shortcut stores. */
export function splitWindowsArgs(text: string): string[] {
  const args: string[] = [];
  let current = '';
  let started = false;
  let quoted = false;
  let index = 0;
  while (index < text.length) {
    const ch = text[index]!;
    if (ch === '\\') {
      let count = 0;
      while (text[index] === '\\') {
        count++;
        index++;
      }
      if (text[index] === '"') {
        // 2n backslashes and a quote: n backslashes, and the quote opens or closes.
        // 2n+1 backslashes and a quote: n backslashes and a literal quote.
        current += '\\'.repeat(Math.floor(count / 2));
        if (count % 2 === 1) {
          current += '"';
          index++;
        }
      } else {
        current += '\\'.repeat(count);
      }
      started = true;
      continue;
    }
    if (ch === '"') {
      // Inside quotes, two quotes in a row are one literal quote.
      if (quoted && text[index + 1] === '"') {
        current += '"';
        index += 2;
        continue;
      }
      quoted = !quoted;
      started = true;
      index++;
      continue;
    }
    if (!quoted && /\s/.test(ch)) {
      if (started) args.push(current);
      current = '';
      started = false;
      index++;
      continue;
    }
    current += ch;
    started = true;
    index++;
  }
  if (started) args.push(current);
  return args;
}
