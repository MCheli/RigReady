import type { PickerChoice, PickerInfo } from '../contract';
import { fieldsOf, type Field } from './schemaForm';

/**
 * The rules of a field that is chosen by name from a list (a saved monitor layout, a
 * virtual controller, a game) in place of a typed id: what the list shows, what choosing
 * fills in, and how a fix that picks from the same list as its check follows the check.
 * Pure, so the rules are tested without a window.
 */

type Params = Record<string, unknown>;

export interface PickerItem {
  value: string;
  title: string;
  subtitle?: string;
}

export interface PickerNote {
  text: string;
  tone: 'muted' | 'warn' | 'bad';
}

/** Said under a list when what the setup uses is not in it any more. */
export const GONE = 'The one this setup uses is no longer in the list. Choose another.';

/** The picker that chooses this field, when one does. */
export function pickerOf(pickers: PickerInfo[] | undefined, key: string): PickerInfo | undefined {
  return pickers?.find((p) => p.param === key);
}

/** The params a picker fills in by itself: the form does not ask for them. */
export function filledKeys(pickers: PickerInfo[] | undefined): Set<string> {
  return new Set((pickers ?? []).flatMap((p) => p.fills));
}

function savedValue(picker: PickerInfo, params: Params, fallback?: unknown): string | undefined {
  const value = params[picker.param] ?? fallback;
  return typeof value === 'string' && value !== '' ? value : undefined;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * What tells one row of a list from every other. The value, except where two choices have
 * the same one (the saved bindings of two games, made in the same moment): those are told
 * apart by what each fills in as well.
 */
export function choiceKey(picker: PickerInfo, choice: PickerChoice): string {
  const shared = picker.choices.filter((c) => c.value === choice.value).length > 1;
  return shared ? `${choice.value}\n${JSON.stringify(choice.fill ?? {})}` : choice.value;
}

/**
 * The choice the params name, when it is in the list. Of two with the same value it is
 * the one that fills in what the params have: the saved bindings of the setup's own game.
 */
export function chosenOf(
  picker: PickerInfo,
  params: Params,
  fallback?: unknown
): PickerChoice | undefined {
  const value = savedValue(picker, params, fallback);
  if (value === undefined) return undefined;
  const named = picker.choices.filter((c) => c.value === value);
  const agrees = (choice: PickerChoice): number =>
    Object.entries(choice.fill ?? {}).filter(([key, filled]) => same(params[key], filled)).length;
  return named.reduce<PickerChoice | undefined>(
    (best, choice) => (best === undefined || agrees(choice) > agrees(best) ? choice : best),
    undefined
  );
}

/** The row of the list that is chosen now: what `pickerItems` calls it. */
export function selectedKey(
  picker: PickerInfo,
  params: Params,
  fallback?: unknown
): string | undefined {
  const choice = chosenOf(picker, params, fallback);
  return choice ? choiceKey(picker, choice) : savedValue(picker, params, fallback);
}

/** What the setup uses is not among the choices (it was deleted, or the list was not read). */
export function isMissing(picker: PickerInfo, params: Params, fallback?: unknown): boolean {
  return (
    savedValue(picker, params, fallback) !== undefined &&
    chosenOf(picker, params, fallback) === undefined
  );
}

/** The name the setup remembers for what it uses, when it remembers one. */
function savedName(picker: PickerInfo, params: Params): string | undefined {
  for (const key of picker.fills) {
    const value = params[key];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return undefined;
}

/**
 * The rows of the list. What the setup already uses is never dropped from it: when it is
 * no longer among the choices it stays as the first row and says so.
 */
export function pickerItems(picker: PickerInfo, params: Params, fallback?: unknown): PickerItem[] {
  const items = picker.choices.map((c) => ({
    value: choiceKey(picker, c),
    title: c.current ? `${c.label} (in use now)` : c.label,
    ...(c.detail ? { subtitle: c.detail } : {}),
  }));
  if (!isMissing(picker, params, fallback)) return items;
  const value = savedValue(picker, params, fallback)!;
  const name = savedName(picker, params) ?? value;
  // A list that could not be read says nothing about whether it is still there.
  return [{ value, title: picker.problem ? name : `${name} (no longer in the list)` }, ...items];
}

/**
 * The line under the list: why it is empty, that the saved one is gone, or what the chosen
 * one is. Two things of the same name are told apart by this line with the list closed.
 */
export function pickerNote(
  picker: PickerInfo,
  params: Params,
  fallback?: unknown
): PickerNote | undefined {
  if (picker.problem) return { text: picker.problem, tone: 'bad' };
  if (isMissing(picker, params, fallback)) return { text: GONE, tone: 'warn' };
  if (picker.choices.length === 0) return { text: picker.empty, tone: 'muted' };
  const choice = chosenOf(picker, params, fallback);
  if (choice) return choice.detail ? { text: choice.detail, tone: 'muted' } : undefined;
  if (picker.unpicked && picker.fills.some((key) => params[key] !== undefined)) {
    return { text: picker.unpicked, tone: 'muted' };
  }
  return undefined;
}

/**
 * The params after choosing a row of the list (by what `pickerItems` calls it). A choice
 * sets the field and everything the choice fills in; what an earlier choice filled in
 * does not linger. Clearing takes the
 * field out and what it filled, except the fields in `keep` (those the type cannot do
 * without, such as the monitors of a layout check).
 */
export function applyChoice(
  params: Params,
  picker: PickerInfo,
  value: string | null | undefined,
  keep: Iterable<string> = []
): Params {
  const next = { ...params };
  if (value === undefined || value === null || value === '') {
    const kept = new Set(keep);
    delete next[picker.param];
    for (const key of picker.fills) if (!kept.has(key)) delete next[key];
    return next;
  }
  const choice = picker.choices.find((c) => choiceKey(picker, c) === value);
  // The saved one that is no longer in the list, chosen again: nothing changes.
  if (!choice) return next;
  for (const key of picker.fills) delete next[key];
  return { ...next, [picker.param]: choice.value, ...(choice.fill ?? {}) };
}

/** True when the picker must be answered: its field is required, or one it fills is and is empty. */
export function pickerRequired(picker: PickerInfo, required: Set<string>, params: Params): boolean {
  if (required.has(picker.param)) return true;
  return picker.fills.some((key) => required.has(key) && params[key] === undefined);
}

/** What the editor calls a check that has no name of its own yet. */
export const NEW_CHECK = 'New check';

/**
 * The name a check takes from what was chosen for it: "Monitor layout: Flying". Only a check
 * still named "New check", or still named after its last choice, follows the list: a name
 * the person typed is theirs and is never replaced.
 */
export function titleFromChoice(
  title: string,
  typeLabel: string,
  pickers: PickerInfo[] | undefined,
  before: Params,
  after: Params
): string | undefined {
  const named = pickers?.find((p) => p.fills.length > 0);
  if (!named) return undefined;
  const nameOf = (params: Params): string | undefined => {
    const choice = chosenOf(named, params);
    return choice ? `${typeLabel}: ${choice.label}` : undefined;
  };
  if (title !== NEW_CHECK && title !== nameOf(before)) return undefined;
  return nameOf(after);
}

/**
 * The name a step takes when its type is changed. A step is named after its type ("Start the
 * app") until the person names it, so only a step still carrying that name follows
 * the type: a name the person typed is theirs and is never replaced. "New start the app"
 * is what earlier versions called an unnamed step, and is treated the same.
 */
export function titleFromType(
  title: string,
  before: string | undefined,
  after: string
): string | undefined {
  const unnamed =
    title.trim() === '' ||
    (before !== undefined && (title === before || title === `New ${before.toLowerCase()}`));
  return unnamed ? after : undefined;
}

export interface Followed {
  /** What is followed, for the line that says so: "layout", "game and aircraft". */
  label: string;
  /** The params of the fix that take their values from the check. */
  keys: string[];
}

/**
 * What a fix takes from its check: every list both pick from, for the same field, with
 * what the list fills in and what it says the two share. A check of a saved layout and the
 * fix that applies a saved layout mean the same layout, so the editor asks once.
 */
export function followedBy(
  check: PickerInfo[] | undefined,
  fix: PickerInfo[] | undefined
): Followed | undefined {
  const shared = (check ?? []).filter((c) =>
    (fix ?? []).some((f) => f.list === c.list && f.param === c.param)
  );
  if (shared.length === 0) return undefined;
  return {
    label: shared.map((p) => p.label.toLowerCase()).join(' and '),
    keys: [...new Set(shared.flatMap((p) => [p.param, ...p.fills, ...(p.shares ?? [])]))],
  };
}

/**
 * True while the fix says exactly what the check says in the followed fields. A fix that
 * was given something else (in the file, by hand) is not following: its own list is shown,
 * so a difference is never hidden.
 */
export function follows(check: Params, fix: Params, followed: Followed): boolean {
  return followed.keys.every((key) => same(check[key], fix[key]));
}

/** The fix's params with the followed fields as the check has them. */
export function mergeFollowed(fix: Params, check: Params, followed: Followed): Params {
  const next = { ...fix };
  for (const key of followed.keys) {
    if (check[key] === undefined) delete next[key];
    else next[key] = JSON.parse(JSON.stringify(check[key])) as unknown;
  }
  return next;
}

export interface FormPick {
  info: PickerInfo;
  items: PickerItem[];
  /** The row that is chosen now, when one is. */
  selected?: string;
  note?: PickerNote;
  required: boolean;
}

export interface FormRow {
  field: Field;
  /** Set when the field is chosen by name from a list. */
  pick?: FormPick;
}

/** The fields a type cannot be saved without. */
export function requiredKeys(schema: Record<string, unknown> | undefined): Set<string> {
  return new Set(
    fieldsOf(schema)
      .filter((f) => f.required)
      .map((f) => f.key)
  );
}

/**
 * What the form of a check, fix or step asks for, in order. Left out: what a list fills in
 * by itself (a layout's name and monitors), and what a fix takes from its check.
 */
export function formRows(
  schema: Record<string, unknown> | undefined,
  params: Params,
  pickers?: PickerInfo[],
  followed?: Followed
): FormRow[] {
  const required = requiredKeys(schema);
  const hidden = new Set([...filledKeys(pickers), ...(followed?.keys ?? [])]);
  return fieldsOf(schema)
    .filter((field) => !hidden.has(field.key))
    .map((field) => {
      const info = pickerOf(pickers, field.key);
      if (!info) return { field };
      const note = pickerNote(info, params, field.default);
      const selected = selectedKey(info, params, field.default);
      return {
        field,
        pick: {
          info,
          items: pickerItems(info, params, field.default),
          ...(selected !== undefined ? { selected } : {}),
          ...(note ? { note } : {}),
          required: pickerRequired(info, required, params),
        },
      };
    });
}
