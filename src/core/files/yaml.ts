import * as yaml from 'js-yaml';

/**
 * How many values one document may stand for once its aliases (`*name`) are followed.
 * RigReady writes its YAML without aliases (`noRefs`), so they come only from a hand-edited
 * file or from a file made to do harm. An alias costs nothing to load, but a few nested
 * ones multiply: under a kilobyte of YAML can stand for a billion strings, and writing
 * such a setup out again, or walking it, would hold the app for hours. A setup of RigReady
 * is a few thousand values; a million leaves room for any real file.
 */
export const MAX_YAML_VALUES = 1_000_000;

/** What a single document may hold in aliases before the count of values is even looked at. */
const MAX_ALIASES = 10_000;

/** Counts the values `root` stands for, following shared ones each time; stops past `limit`. */
function exceeds(root: unknown, limit: number): boolean {
  let count = 0;
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const value = stack.pop();
    if (++count > limit) return true;
    if (value === null || typeof value !== 'object') continue;
    for (const child of Array.isArray(value) ? value : Object.values(value)) stack.push(child);
  }
  return false;
}

/**
 * Loads YAML that came from a file: a setup, a shared setup, a backup. Throws like
 * `yaml.load` (a syntax error, or a document that stands for more than MAX_YAML_VALUES
 * values) so callers keep reporting it as YAML that is not valid.
 */
export function loadDataYaml(text: string): unknown {
  const value = yaml.load(text, { maxAliases: MAX_ALIASES });
  if (exceeds(value, MAX_YAML_VALUES)) {
    throw new Error(
      `The YAML stands for more than ${MAX_YAML_VALUES.toLocaleString('en')} values once its aliases are followed.`
    );
  }
  return value;
}
