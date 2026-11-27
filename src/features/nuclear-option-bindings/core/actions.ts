/**
 * Nuclear Option's actions, as its Rewired Input Manager defines them (read from the
 * game's data files, build 26327221) and as its controls screen names them.
 * Source: docs/research/nuclear-option.md, "Map categories and actions".
 *
 * A game update can add actions. One that is not here is still shown, as "Action <id>".
 */

export interface GameAction {
  id: number;
  /** The name the controls screen shows; for an axis, the name of the axis as a whole. */
  name: string;
  kind: 'axis' | 'button';
  /** An axis's two sides, as the screen names them when a button or key drives one. */
  positive?: string;
  negative?: string;
  category: string;
}

const FLIGHT = 'Flight Controls';
const CAMERA = 'Camera Controls';
const GAMEPLAY = 'Gameplay';
const CHAT = 'Chat';
const EDITOR = 'Mission Editor';
const DEBUG = 'Debug';

const axis = (
  id: number,
  name: string,
  positive: string,
  negative: string,
  category: string
): GameAction => ({ id, name, kind: 'axis', positive, negative, category });
const button = (id: number, name: string, category: string): GameAction => ({
  id,
  name,
  kind: 'button',
  category,
});

export const ACTIONS: readonly GameAction[] = [
  axis(0, 'Pitch Axis', 'Pitch Up', 'Pitch Down', FLIGHT),
  axis(1, 'Roll Axis', 'Roll Right', 'Roll Left', FLIGHT),
  axis(2, 'Yaw Axis', 'Yaw Right', 'Yaw Left', FLIGHT),
  axis(4, 'Throttle Axis', 'Increase Throttle', 'Decrease Throttle', FLIGHT),
  button(5, 'Fire', FLIGHT),
  axis(6, 'Brake Axis', 'Apply Brakes', 'Brake Axis -', FLIGHT),
  button(7, 'Target Select', FLIGHT),
  button(8, 'Target Cancel', FLIGHT),
  button(9, 'Next Weapon', FLIGHT),
  button(10, 'Next Countermeasure', FLIGHT),
  button(11, 'Toggle Gear', FLIGHT),
  button(12, 'Countermeasures', FLIGHT),
  button(13, 'Toggle Night Vision', FLIGHT),
  button(14, 'Toggle Flight Assist', FLIGHT),
  button(15, 'Toggle Radar', FLIGHT),
  button(16, 'Eject', FLIGHT),
  button(17, 'Center View', CAMERA),
  button(18, 'Switch View', CAMERA),
  button(19, 'Pause', GAMEPLAY),
  button(20, 'Toggle Slow Motion', GAMEPLAY),
  button(21, 'Toggle Map', GAMEPLAY),
  axis(22, 'Tilt View', 'Tilt Up', 'Tilt Down', CAMERA),
  axis(23, 'Pan View', 'Pan Right', 'Pan Left', CAMERA),
  axis(25, 'Zoom View', 'Zoom In', 'Zoom Out', CAMERA),
  button(26, 'Free Look', CAMERA),
  axis(27, 'Field of View', 'Increase FoV', 'Decrease FoV', CAMERA),
  axis(28, 'Move Longitudinal', 'Move Forward', 'Move Backward', CAMERA),
  axis(29, 'Move Lateral', 'Move Right', 'Move Left', CAMERA),
  button(30, 'Toggle mission debug menu', DEBUG),
  button(31, 'Open Chat', GAMEPLAY),
  button(34, 'Submit Chat', CHAT),
  button(35, 'Cancel Chat', CHAT),
  axis(36, 'Move Map Horizontal', 'Move Map Right', 'Move Map Left', GAMEPLAY),
  axis(37, 'Move Map Vertical', 'Move Map Up', 'Move Map Down', GAMEPLAY),
  axis(38, 'Custom Axis 1', 'Custom Axis 1 Up', 'Custom Axis 1 Down', FLIGHT),
  button(39, 'Toggle debug graphs', DEBUG),
  button(40, 'Toggle performance numbers', DEBUG),
  button(41, 'Focus Unit', EDITOR),
  button(42, 'Delete Unit', EDITOR),
  button(43, 'Open Radial Menu', FLIGHT),
  axis(44, 'Radial Menu Horizontal', 'Radial Menu Right', 'Radial Menu Left', GAMEPLAY),
  axis(45, 'Radial Menu Vertical', 'Radial Menu Up', 'Radial Menu Down', GAMEPLAY),
  button(46, 'Axis Modifier', FLIGHT),
  button(47, 'Camera Jump', CAMERA),
  axis(48, 'Move Vertical', 'Move Up', 'Move Down', CAMERA),
  button(49, 'Toggle Navigation Lights', FLIGHT),
  button(50, 'Toggle Engine', FLIGHT),
  button(51, 'Previous Weapon', FLIGHT),
  button(52, 'Link Guns', FLIGHT),
  button(53, 'Open Weapon Wheel', FLIGHT),
  button(54, 'Toggle Turret Control', FLIGHT),
  button(55, 'Spectate Previous Aircraft', CAMERA),
  button(56, 'Look At Enemy Aircraft', CAMERA),
  button(57, 'Jump to Enemy Aircraft', CAMERA),
  button(58, 'Look At Target', CAMERA),
  button(59, 'Vote Kick Yes', CHAT),
  button(60, 'Vote Kick No', CHAT),
  button(61, 'Select Unit Mode', EDITOR),
  button(62, 'Translate Unit Mode', EDITOR),
  button(63, 'Rotate Unit Mode', EDITOR),
  button(64, 'Toggle Left Panel', EDITOR),
];

const BY_ID = new Map(ACTIONS.map((a) => [a.id, a]));

/** An action by its id; one the table does not have is named by its number. */
export function actionOf(id: number): GameAction {
  return (
    BY_ID.get(id) ?? { id, name: `Action ${id}`, kind: 'button', category: 'Not known to RigReady' }
  );
}

/**
 * The name of what a binding does: the action, or one side of an axis action when a
 * button, a key or half an axis drives it (`side` 0 the positive side, 1 the negative).
 */
export function bindingName(action: GameAction, wholeAxis: boolean, side: number): string {
  if (action.kind !== 'axis' || wholeAxis) return action.name;
  return (side === 1 ? action.negative : action.positive) ?? action.name;
}

/**
 * The id of what a binding does, for the rest of the app: the action's id, or for one side
 * of an axis action that id with ":+" or ":-". Zoom In and Zoom Out are two things to bind
 * and two things to ask in the trainer, though the game has them as one action.
 */
export function bindingActionId(action: GameAction, wholeAxis: boolean, side: number): string {
  if (action.kind !== 'axis' || wholeAxis) return String(action.id);
  return `${action.id}:${side === 1 ? '-' : '+'}`;
}

/** The categories a saved map belongs to, as the controls screen's tabs name them. */
export const MAP_CATEGORIES: Record<number, string> = {
  0: 'Game',
  1: 'Chat',
  2: 'Mission Editor',
  3: 'Debug',
};

export const mapCategoryName = (id: number): string => MAP_CATEGORIES[id] ?? `Category ${id}`;
