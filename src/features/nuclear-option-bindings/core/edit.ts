import { err, ok, type Result } from '../../../core/result';
import { actionOf } from './actions';
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
 * "The writer"): a button of a controller bound to a button-type action, written the way
 * the game writes a binding the player made on its controls screen. Everything else is
 * refused with the reason: an axis, a key, a mouse button, one side of an axis action.
 */

/** Rewired numbers the buttons of a controller it has no definition for from 32. */
const FIRST_BUTTON = 32;
/** The most buttons a DirectInput controller reports. */
const MAX_BUTTON = 128;

export interface BindingEdit {
  /** The game's action id. */
  actionId: number;
  /** The button to bind it to, as RigReady numbers buttons (1 is the first); null clears it. */
  button: number | null;
}

export interface EditOutcome {
  /** The document to store; the same text as before when nothing had to change. */
  text: string;
  /** The buttons the action was on before, as RigReady numbers them. */
  before: number[];
  /** Nothing had to change: the action was already bound to that button, or already unbound. */
  same: boolean;
  /** Other actions already on the button being bound, by id: the press will do those too. */
  alsoOnButton: number[];
}

/**
 * A binding of a controller button as the game writes one the player made: the action's
 * category left at -1, the positive half of a button's "axis" (axisRange 1), not inverted,
 * the positive side of the action, no key and no modifier keys, switched on.
 */
function buttonBinding(actionId: number, elementIdentifierId: number): ElementMap {
  return {
    actionCategoryId: -1,
    actionId,
    elementType: 1,
    elementIdentifierId,
    axisRange: 1,
    invert: false,
    axisContribution: 0,
    keyboardKeyCode: 0,
    modifierKeys: [0, 0, 0],
    enabled: true,
  };
}

const isPlainButton = (e: ElementMap): boolean =>
  e.elementType === 1 &&
  e.elementIdentifierId >= FIRST_BUTTON &&
  e.keyboardKeyCode === 0 &&
  e.modifierKeys.every((m) => m === 0);

/** Applies one edit to a parsed map; the map given is not changed. */
export function editMap(
  map: ControllerMap,
  edit: BindingEdit
): Result<EditOutcome & { map: ControllerMap }> {
  if (map.kind !== 'JoystickMap') {
    return err(
      'nuclear-option.edit.kind',
      'RigReady changes bindings on a controller only. Change a key or a mouse button in the game.'
    );
  }
  if (map.source.buttons === 'absent') {
    return err(
      'nuclear-option.edit.shape',
      'This saved map has no list of button bindings to change.'
    );
  }
  const action = actionOf(edit.actionId);
  if (action.name === `Action ${edit.actionId}`) {
    return err(
      'nuclear-option.edit.action',
      'RigReady does not know this action, so it does not bind it.'
    );
  }
  if (action.kind !== 'button') {
    return err(
      'nuclear-option.edit.axis',
      `${action.name} is an axis. RigReady binds buttons only; bind an axis in the game.`
    );
  }
  if (
    edit.button !== null &&
    (!Number.isInteger(edit.button) || edit.button < 1 || edit.button > MAX_BUTTON)
  ) {
    return err('nuclear-option.edit.button', `A controller has buttons 1 to ${MAX_BUTTON}.`);
  }
  const mine = map.buttonMaps.filter((e) => e.actionId === edit.actionId);
  // A binding of this action that is not a plain controller button (written some way this
  // code never saw) is not something to replace on a guess.
  if (mine.some((e) => !isPlainButton(e))) {
    return err(
      'nuclear-option.edit.unknown',
      `${action.name} has a binding here that RigReady does not understand, so it was left alone.`
    );
  }
  if (map.axisMaps.some((e) => e.actionId === edit.actionId)) {
    return err(
      'nuclear-option.edit.unknown',
      `${action.name} is bound to an axis here. Change that in the game.`
    );
  }
  const before = mine.map((e) => e.elementIdentifierId - FIRST_BUTTON + 1);
  const target = edit.button === null ? null : edit.button - 1 + FIRST_BUTTON;
  const same =
    target === null
      ? mine.length === 0
      : mine.length === 1 && mine[0]!.elementIdentifierId === target && mine[0]!.enabled;
  const alsoOnButton =
    target === null
      ? []
      : [
          ...new Set(
            [...map.buttonMaps, ...map.axisMaps]
              .filter((e) => e.enabled && e.elementType === 1 && e.elementIdentifierId === target)
              .map((e) => e.actionId)
              .filter((id) => id !== edit.actionId)
          ),
        ];
  if (same) {
    return ok({ map, text: serializeControllerMap(map), before, same, alsoOnButton });
  }
  // The action keeps its place in the list when it had one; a new binding goes last, where
  // the game puts one the player adds.
  const first = map.buttonMaps.findIndex((e) => e.actionId === edit.actionId);
  const others = map.buttonMaps.filter((e) => e.actionId !== edit.actionId);
  const buttonMaps =
    target === null
      ? others
      : first < 0
        ? [...others, buttonBinding(edit.actionId, target)]
        : [
            ...map.buttonMaps.slice(0, first).filter((e) => e.actionId !== edit.actionId),
            buttonBinding(edit.actionId, target),
            ...map.buttonMaps.slice(first + 1).filter((e) => e.actionId !== edit.actionId),
          ];
  const changed: ControllerMap = {
    ...map,
    buttonMaps,
    // An empty list is written as the game writes one; a list that gets its first binding opens.
    source: { ...map.source, buttons: buttonMaps.length === 0 ? 'self-closed' : 'open' },
  };
  const text = serializeControllerMap(changed);
  // Its own check: what was written reads back as exactly the map that was meant.
  const again = parseControllerMap(text);
  if (
    !again.ok ||
    JSON.stringify(again.value.buttonMaps) !== JSON.stringify(buttonMaps) ||
    JSON.stringify(again.value.axisMaps) !== JSON.stringify(map.axisMaps)
  ) {
    return err(
      'nuclear-option.edit.check',
      'The changed map did not read back as intended, so nothing was changed.'
    );
  }
  return ok({ map: changed, text, before, same, alsoOnButton });
}

/** Applies one edit to the stored text of a map. */
export function editMapText(document: string, edit: BindingEdit): Result<EditOutcome> {
  const map = parseControllerMap(document);
  if (!map.ok) return map;
  const edited = editMap(map.value, edit);
  if (!edited.ok) return edited;
  const { text, before, same, alsoOnButton } = edited.value;
  return ok({ text, before, same, alsoOnButton });
}
