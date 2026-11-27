import { err, ok, type Result } from '../../../core/result';
import { actionOf, bindingName } from './actions';
import {
  parseControllerMap,
  serializeControllerMap,
  type ControllerMap,
  type ElementMap,
} from './rewired';

/**
 * One binding changed in a saved controller map: text in, text out, nothing else touched.
 * Pure; the registry and FileStore are change.ts's business.
 *
 * It composes only what the game itself was seen to write (docs/research/nuclear-option.md,
 * "The writer"), each the way the game writes a binding the player made on its controls
 * screen:
 *   - a button of the controller on a button-type action;
 *   - a button on one side of an axis action ("Zoom In", "Apply Brakes");
 *   - an axis of the controller on an axis action, as it is or reversed.
 * Everything else is refused with the reason: a key, a mouse button, half an axis, a hat.
 */

/** Rewired numbers the buttons of a controller it has no definition for from 32. */
const FIRST_BUTTON = 32;
/** The most buttons a DirectInput controller reports. */
const MAX_BUTTON = 128;

/** One side of an axis action: "+" its positive side (Zoom In), "-" its negative (Zoom Out). */
export type Side = '+' | '-';

export interface BindingEdit {
  /** The game's action id. */
  actionId: number;
  /** For an axis action: the side a button is bound to. Absent for the action as a whole. */
  side?: Side;
  /**
   * The button to bind a button action, or one side of an axis action, to, as RigReady
   * numbers buttons (1 is the first); null clears it.
   */
  button?: number | null;
  /**
   * The controller's axis to bind an axis action to as a whole: its number as the game
   * counts axes (0 is the first), and whether the game is to reverse it; null clears it.
   */
  axis?: { index: number; invert: boolean } | null;
}

/** What an action, or a side of one, is on: a button (1 the first) or an axis (0 the first). */
export type BoundTo =
  { kind: 'button'; button: number } | { kind: 'axis'; index: number; invert: boolean };

export interface EditOutcome {
  /** The document to store; the same text as before when nothing had to change. */
  text: string;
  /** What it was on before. */
  before: BoundTo[];
  /** Nothing had to change: it was already bound exactly so, or already unbound. */
  same: boolean;
  /**
   * What else is already on the button or the axis being bound, by the name the game's
   * controls screen gives it ("Fire", "Zoom In"): one press, or one movement, will do those too.
   */
  alsoOn: string[];
}

const PLAIN = {
  actionCategoryId: -1,
  keyboardKeyCode: 0,
  modifierKeys: [0, 0, 0] as [number, number, number],
  enabled: true,
};

/**
 * A binding of a controller button as the game writes one the player made: the action's
 * category left at -1, the positive half of a button's "axis" (axisRange 1), not inverted,
 * no key and no modifier keys, switched on. `contribution` is the side of the action the
 * button drives: 0 the action itself or an axis action's positive side, 1 its negative side.
 */
function buttonBinding(
  actionId: number,
  elementIdentifierId: number,
  contribution = 0
): ElementMap {
  return {
    ...PLAIN,
    actionId,
    elementType: 1,
    elementIdentifierId,
    axisRange: 1,
    invert: false,
    axisContribution: contribution,
  };
}

/** A whole axis of the controller on an axis action, as the game writes one the player made. */
function axisBinding(actionId: number, index: number, invert: boolean): ElementMap {
  return {
    ...PLAIN,
    actionId,
    elementType: 0,
    elementIdentifierId: index,
    axisRange: 0,
    invert,
    axisContribution: 0,
  };
}

const isPlainButton = (e: ElementMap): boolean =>
  e.elementType === 1 &&
  e.elementIdentifierId >= FIRST_BUTTON &&
  e.keyboardKeyCode === 0 &&
  e.modifierKeys.every((m) => m === 0);

/** A whole axis of the controller: not half of one, no key. */
const isPlainAxis = (e: ElementMap): boolean =>
  e.elementType === 0 &&
  e.axisRange === 0 &&
  e.elementIdentifierId >= 0 &&
  e.elementIdentifierId < FIRST_BUTTON &&
  e.keyboardKeyCode === 0 &&
  e.modifierKeys.every((m) => m === 0);

/** The name of what an element does: the action, or the side of an axis action it drives. */
const doingOf = (e: ElementMap): string =>
  bindingName(actionOf(e.actionId), e.elementType === 0 && e.axisRange === 0, e.axisContribution);

type Edited = Result<EditOutcome & { map: ControllerMap }>;

/** Applies one edit to a parsed map; the map given is not changed. */
export function editMap(map: ControllerMap, edit: BindingEdit): Edited {
  if (map.kind !== 'JoystickMap') {
    return err(
      'nuclear-option.edit.kind',
      'RigReady changes bindings on a controller only. Change a key or a mouse button in the game.'
    );
  }
  // A controller Rewired has a definition of its own for (a gamepad) carries that
  // definition's id here and numbers its buttons its own way, which RigReady has not seen.
  if (!/^[0-]+$/.test(map.hardwareGuid)) {
    return err(
      'nuclear-option.edit.definition',
      'The game knows this controller by a definition of its own, and RigReady does not know how it numbers the buttons there. Change the binding in the game.'
    );
  }
  const action = actionOf(edit.actionId);
  if (action.name === `Action ${edit.actionId}`) {
    return err(
      'nuclear-option.edit.action',
      'RigReady does not know this action, so it does not bind it.'
    );
  }
  if (edit.axis !== undefined && edit.button !== undefined) {
    return err('nuclear-option.edit.both', 'A binding is a button or an axis, not both.');
  }
  if (edit.axis !== undefined) return editAxis(map, edit.actionId, edit.side, edit.axis);
  if (edit.button === undefined) {
    return err('nuclear-option.edit.nothing', 'Nothing was chosen to bind it to.');
  }
  if (action.kind === 'axis' && edit.side === undefined) {
    return err(
      'nuclear-option.edit.axis',
      `${action.name} is an axis: bind it to an axis of the controller, or bind a button to one of its sides (${action.positive} or ${action.negative}).`
    );
  }
  if (action.kind !== 'axis' && edit.side !== undefined) {
    return err('nuclear-option.edit.side', `${action.name} is a button and has no sides.`);
  }
  return editButton(map, edit.actionId, edit.side, edit.button);
}

/** Every field of every binding of a list, in one fixed order, to compare two lists by. */
const fields = (list: ElementMap[]): string =>
  JSON.stringify(
    list.map((e) => [
      e.actionCategoryId,
      e.actionId,
      e.elementType,
      e.elementIdentifierId,
      e.axisRange,
      e.invert,
      e.axisContribution,
      e.keyboardKeyCode,
      e.modifierKeys,
      e.enabled,
    ])
  );

/** Checks its own result and returns it: what was written reads back as the map that was meant. */
function checked(
  changed: ControllerMap,
  before: BoundTo[],
  alsoOn: string[]
): Result<EditOutcome & { map: ControllerMap }> {
  const text = serializeControllerMap(changed);
  const again = parseControllerMap(text);
  if (
    !again.ok ||
    fields(again.value.buttonMaps) !== fields(changed.buttonMaps) ||
    fields(again.value.axisMaps) !== fields(changed.axisMaps)
  ) {
    return err(
      'nuclear-option.edit.check',
      'The changed map did not read back as intended, so nothing was changed.'
    );
  }
  return ok({ map: changed, text, before, same: false, alsoOn });
}

/**
 * A list with one action's elements replaced by `made` (none when it is cleared). The action
 * keeps its place when it had one; a new binding goes last, where the game puts one the
 * player adds.
 */
function replaced(
  list: ElementMap[],
  mine: (e: ElementMap) => boolean,
  made: ElementMap | undefined
): ElementMap[] {
  const first = list.findIndex(mine);
  const others = list.filter((e) => !mine(e));
  if (!made) return others;
  if (first < 0) return [...others, made];
  return [
    ...list.slice(0, first).filter((e) => !mine(e)),
    made,
    ...list.slice(first + 1).filter((e) => !mine(e)),
  ];
}

/** A button on a button action, or on one side of an axis action. */
function editButton(
  map: ControllerMap,
  actionId: number,
  side: Side | undefined,
  button: number | null
): Edited {
  const action = actionOf(actionId);
  const name = side === undefined ? action.name : side === '-' ? action.negative : action.positive;
  if (!name) {
    return err('nuclear-option.edit.side', `${action.name} has no such side in the game.`);
  }
  if (map.source.buttons === 'absent') {
    return err(
      'nuclear-option.edit.shape',
      'This saved map has no list of button bindings to change.'
    );
  }
  if (button !== null && (!Number.isInteger(button) || button < 1 || button > MAX_BUTTON)) {
    return err('nuclear-option.edit.button', `A controller has buttons 1 to ${MAX_BUTTON}.`);
  }
  const contribution = side === '-' ? 1 : 0;
  // A side of an axis action is told from the other side by what it contributes.
  const mine = (e: ElementMap): boolean =>
    e.actionId === actionId && (side === undefined || e.axisContribution === contribution);
  const had = map.buttonMaps.filter(mine);
  // A binding that is not a plain controller button (written some way this code never saw)
  // is not something to replace on a guess.
  if (had.some((e) => !isPlainButton(e))) {
    return err(
      'nuclear-option.edit.unknown',
      `${name} has a binding here that RigReady does not understand, so it was left alone.`
    );
  }
  // A button action bound to an axis of the controller is not something this code has seen.
  if (side === undefined && map.axisMaps.some((e) => e.actionId === actionId)) {
    return err(
      'nuclear-option.edit.unknown',
      `${name} is bound to an axis here. Change that in the game.`
    );
  }
  // Half an axis can drive a side too. The side would then be shown as "not bound" here
  // while it is bound, so it is left to the game.
  if (side !== undefined && map.axisMaps.some((e) => e.actionId === actionId && !isPlainAxis(e))) {
    return err(
      'nuclear-option.edit.unknown',
      `${action.name} has half an axis bound here, which RigReady does not change. Change ${name} in the game.`
    );
  }
  const before = had.map((e): BoundTo => ({
    kind: 'button',
    button: e.elementIdentifierId - FIRST_BUTTON + 1,
  }));
  const target = button === null ? null : button - 1 + FIRST_BUTTON;
  // The same binding already: every field as it would be written, but for the two in which
  // the game's own default for a button differs from one the player makes (category 0 and
  // axisRange 0, against -1 and 1): a default on the button asked for is that button.
  const wanted = target === null ? undefined : buttonBinding(actionId, target, contribution);
  const same =
    wanted === undefined
      ? had.length === 0
      : had.length === 1 &&
        fields([
          { ...had[0]!, actionCategoryId: wanted.actionCategoryId, axisRange: wanted.axisRange },
        ]) === fields([wanted]);
  const alsoOn =
    target === null
      ? []
      : [
          ...new Set(
            [...map.buttonMaps, ...map.axisMaps]
              .filter(
                (e) =>
                  e.enabled && e.elementType === 1 && e.elementIdentifierId === target && !mine(e)
              )
              .map(doingOf)
          ),
        ];
  if (same) return ok({ map, text: serializeControllerMap(map), before, same, alsoOn });
  const buttonMaps = replaced(map.buttonMaps, mine, wanted);
  return checked(
    {
      ...map,
      buttonMaps,
      // An empty list is written as the game writes one; one that gets its first binding opens.
      source: { ...map.source, buttons: buttonMaps.length === 0 ? 'self-closed' : 'open' },
    },
    before,
    alsoOn
  );
}

/** An axis of the controller on an axis action as a whole. */
function editAxis(
  map: ControllerMap,
  actionId: number,
  side: Side | undefined,
  axis: { index: number; invert: boolean } | null
): Edited {
  const action = actionOf(actionId);
  if (action.kind !== 'axis') {
    return err(
      'nuclear-option.edit.notAxis',
      `${action.name} is a button. RigReady binds it to a button of the controller, not to an axis.`
    );
  }
  if (side !== undefined) {
    return err(
      'nuclear-option.edit.half',
      'RigReady binds an axis of the controller to an axis action as a whole, not to one side of it. Bind half an axis in the game.'
    );
  }
  if (map.source.axes === 'absent') {
    return err(
      'nuclear-option.edit.shape',
      'This saved map has no list of axis bindings to change.'
    );
  }
  if (
    axis !== null &&
    (!Number.isInteger(axis.index) || axis.index < 0 || axis.index >= FIRST_BUTTON)
  ) {
    return err(
      'nuclear-option.edit.axisNumber',
      'The game counts a controller’s axes from 0 to 31.'
    );
  }
  const mine = (e: ElementMap): boolean => e.actionId === actionId;
  const had = map.axisMaps.filter(mine);
  // Half an axis on the action, or anything else this code never saw, is left alone.
  if (had.some((e) => !isPlainAxis(e))) {
    return err(
      'nuclear-option.edit.unknown',
      `${action.name} has a binding here that RigReady does not understand, so it was left alone.`
    );
  }
  const before = had.map((e): BoundTo => ({
    kind: 'axis',
    index: e.elementIdentifierId,
    invert: e.invert,
  }));
  const wanted = axis === null ? undefined : axisBinding(actionId, axis.index, axis.invert);
  const same =
    wanted === undefined
      ? had.length === 0
      : had.length === 1 &&
        fields([{ ...had[0]!, actionCategoryId: wanted.actionCategoryId }]) === fields([wanted]);
  const alsoOn =
    axis === null
      ? []
      : [
          ...new Set(
            map.axisMaps
              .filter(
                (e) =>
                  e.enabled &&
                  e.elementType === 0 &&
                  e.elementIdentifierId === axis.index &&
                  !mine(e)
              )
              .map(doingOf)
          ),
        ];
  if (same) return ok({ map, text: serializeControllerMap(map), before, same, alsoOn });
  const axisMaps = replaced(map.axisMaps, mine, wanted);
  return checked(
    {
      ...map,
      axisMaps,
      source: { ...map.source, axes: axisMaps.length === 0 ? 'self-closed' : 'open' },
    },
    before,
    alsoOn
  );
}

export interface ClearOutcome {
  /** The document to store; the same text as before when the map had no bindings. */
  text: string;
  /** How many bindings were taken out: buttons and axes. */
  removed: number;
}

/**
 * Every binding of a controller's saved map taken out: buttons and axes. What is left is
 * the map as the game itself saves one with nothing bound (`<buttonMaps /><axisMaps />`),
 * which it does for a controller's Chat, Mission Editor and Debug maps. Nothing is composed,
 * so a binding written in a way RigReady does not understand goes like the others.
 */
export function clearMapText(document: string): Result<ClearOutcome> {
  const parsed = parseControllerMap(document);
  if (!parsed.ok) return parsed;
  const map = parsed.value;
  if (map.kind !== 'JoystickMap') {
    return err(
      'nuclear-option.edit.kind',
      'RigReady clears the bindings of a controller only. Change the keyboard’s or the mouse’s in the game.'
    );
  }
  if (!/^[0-]+$/.test(map.hardwareGuid)) {
    return err(
      'nuclear-option.edit.definition',
      'The game knows this controller by a definition of its own, and RigReady has not seen how it saves that one with nothing bound. Clear its bindings in the game.'
    );
  }
  // The same rule as for one binding: a document this code would not write back character
  // for character has parts it did not understand, so it is left alone.
  if (serializeControllerMap(map) !== document) {
    return err(
      'nuclear-option.edit.form',
      'The game’s saved bindings for this controller are written in a form RigReady would not write back exactly, so it does not change them. Clear them in the game.'
    );
  }
  const removed = map.buttonMaps.length + map.axisMaps.length;
  if (removed === 0) return ok({ text: document, removed });
  const closed = (form: ControllerMap['source']['buttons']): ControllerMap['source']['buttons'] =>
    form === 'absent' ? 'absent' : 'self-closed';
  const text = serializeControllerMap({
    ...map,
    buttonMaps: [],
    axisMaps: [],
    source: {
      ...map.source,
      buttons: closed(map.source.buttons),
      axes: closed(map.source.axes),
    },
  });
  // Its own check: what was written reads back as the same map with nothing bound, and
  // nothing but bindings went.
  const again = parseControllerMap(text);
  if (
    !again.ok ||
    again.value.buttonMaps.length !== 0 ||
    again.value.axisMaps.length !== 0 ||
    again.value.source.head !== map.source.head ||
    again.value.source.tail !== map.source.tail ||
    text.includes('ActionElementMap')
  ) {
    return err(
      'nuclear-option.edit.check',
      'The cleared map did not read back as intended, so nothing was changed.'
    );
  }
  return ok({ text, removed });
}

/** Applies one edit to the stored text of a map. */
export function editMapText(document: string, edit: BindingEdit): Result<EditOutcome> {
  const map = parseControllerMap(document);
  if (!map.ok) return map;
  // Writing a map writes every binding in it again. A document this code would not write
  // back character for character as it stands (a number written "005", say) would have
  // bindings changed that nobody asked to change, so it is left alone.
  if (serializeControllerMap(map.value) !== document) {
    return err(
      'nuclear-option.edit.form',
      'The game’s saved bindings for this controller are written in a form RigReady would not write back exactly, so it does not change them. Change the binding in the game.'
    );
  }
  const edited = editMap(map.value, edit);
  if (!edited.ok) return edited;
  const { text, before, same, alsoOn } = edited.value;
  return ok({ text, before, same, alsoOn });
}
