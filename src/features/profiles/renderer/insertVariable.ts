import type { PathVariableChoice } from '../contract';

/**
 * What the Variables menu beside a path field does to the field's text when a variable is
 * chosen. Pure, so it can be tested without the component.
 */

const VARIABLE = /^\{([A-Z][A-Z0-9_]*)\}(?:[\\/](.*))?$/;
const ABSOLUTE = /^(?:[a-zA-Z]:[\\/]|\\\\)/;

const backslashes = (text: string): string => text.replace(/\//g, '\\');

/** The part of `absolute` below `base`, or undefined when it is not below it. */
function below(absolute: string, base: string): string | undefined {
  const target = backslashes(absolute).replace(/[\\]+$/, '');
  const folder = backslashes(base).replace(/[\\]+$/, '');
  if (target.toLowerCase() === folder.toLowerCase()) return '';
  if (target.toLowerCase().startsWith(`${folder.toLowerCase()}\\`)) {
    return target.slice(folder.length + 1);
  }
  return undefined;
}

/**
 * The field's text with `chosen` as its variable.
 *
 * - "{DCS_USER}/Config/options.lua" and {SAVED_GAMES} chosen: the same file, said through
 *   the other variable ("{SAVED_GAMES}/DCS/Config/options.lua") when both resolve on this
 *   PC and the chosen folder holds it; otherwise the variable is swapped and the rest kept.
 * - "C:\...\Saved Games\DCS\Config" and {DCS_USER} chosen: "{DCS_USER}/Config" when the
 *   folder is below the variable's; otherwise the variable alone replaces the path.
 * - "Config\options.lua" (relative) and a variable chosen: the variable goes in front.
 * - Nothing yet: "{NAME}/", ready for the rest to be typed.
 */
export function withVariable(
  current: string,
  chosen: PathVariableChoice,
  all: PathVariableChoice[]
): string {
  const text = current.trim();
  let rest: string | undefined;
  const stored = VARIABLE.exec(text);
  if (stored) {
    const [, name, tail = ''] = stored;
    const from = all.find((v) => v.name === name)?.path;
    if (from && chosen.path && name !== chosen.name) {
      rest = below(tail ? `${from}\\${backslashes(tail)}` : from, chosen.path);
    }
    rest ??= backslashes(tail);
  } else if (ABSOLUTE.test(text)) {
    rest = (chosen.path && below(text, chosen.path)) ?? '';
  } else {
    rest = backslashes(text);
  }
  const tail = rest.replace(/^\\+/, '').replace(/\\/g, '/');
  return `{${chosen.name}}/${tail}`;
}

/** The second line of a variable in the menu: what it means, and where it points here. */
export function variableSubtitle(variable: PathVariableChoice): string {
  return variable.path
    ? `${variable.label}: ${variable.path}`
    : `${variable.label}, not on this PC`;
}
