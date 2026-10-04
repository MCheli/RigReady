import type { Result } from './result';

/**
 * "What is bound?", for every feature that is not the bindings feature of a game: the
 * input tester (what does this button do), cheat sheets, AI guidance.
 *
 * A bindings feature registers a reader for its game from its main.ts
 * (`ctx.bindings.register(reader)`); any other feature asks through `ctx.bindings`.
 * Changing bindings stays inside the feature that owns the game's files: another
 * feature may only hand it a proposal (`reader.proposals`), which that feature previews,
 * backs up, writes as one undoable change, and can undo.
 */

/** An aircraft, car or other vehicle a game keeps a set of bindings for. */
export interface BoundAircraft {
  /** The game's own id for it: "FA-18C_hornet". */
  id: string;
  /** "F/A-18C". */
  name: string;
  /** True when the user has bindings of their own for it (not only the game's defaults). */
  hasUserBindings: boolean;
  /**
   * True for the one set of bindings a game uses for everything ("All cars"): there is
   * nothing to tell apart, so a page about it is titled by the game.
   */
  general?: boolean;
}

export type BoundInputKind = 'button' | 'hat' | 'axis' | 'key';

export const HAT_DIRECTIONS = ['U', 'UR', 'R', 'DR', 'D', 'DL', 'L', 'UL'] as const;
export type BoundHatDirection = (typeof HAT_DIRECTIONS)[number];

/**
 * Which control of a controller an input is, in one vocabulary for every game (the way
 * DirectInput numbers a device): button 1 is the first button, hat 1 the first POV hat,
 * axes are X, Y, Z, RX, RY, RZ, SLIDER1, SLIDER2. Games name inputs their own way
 * (JOY_BTN3, "button2", id 34); consumers that draw or match controls use this instead.
 */
export type BoundControl =
  | { kind: 'button'; index: number }
  | { kind: 'hat'; hat: number; direction: BoundHatDirection }
  | { kind: 'axis'; axis: string };

/** The control a DirectInput-style input name means: JOY_BTN3, JOY_BTN_POV1_U, JOY_RZ, JOY_SLIDER1. */
export function controlFromDirectInput(input: string): BoundControl | undefined {
  const button = /^JOY_BTN(\d{1,3})$/.exec(input);
  if (button) {
    const index = Number(button[1]);
    return index > 0 ? { kind: 'button', index } : undefined;
  }
  const hat = /^JOY_BTN_POV(\d)_(U|UR|R|DR|D|DL|L|UL)$/.exec(input);
  if (hat) {
    const n = Number(hat[1]);
    return n > 0 ? { kind: 'hat', hat: n, direction: hat[2] as BoundHatDirection } : undefined;
  }
  const axis = /^JOY_(X|Y|Z|RX|RY|RZ|SLIDER\d)$/.exec(input);
  if (axis) return { kind: 'axis', axis: axis[1]! };
  return undefined;
}

/**
 * A control by its DirectInput-style name (the reverse of controlFromDirectInput): what
 * press detection calls the control the user just used, whatever game is asked about it.
 */
export function directInputName(control: BoundControl): string {
  if (control.kind === 'button') return `JOY_BTN${control.index}`;
  if (control.kind === 'hat') return `JOY_BTN_POV${control.hat}_${control.direction}`;
  return `JOY_${control.axis}`;
}

/** "Button 3", "Hat 1 up", "X axis": a control in words, the same for every game. */
export function controlLabel(control: BoundControl): string {
  if (control.kind === 'button') return `Button ${control.index}`;
  if (control.kind === 'hat') return `Hat ${control.hat} ${HAT_WORDS[control.direction]}`;
  return AXIS_WORDS[control.axis] ?? `${control.axis} axis`;
}

const HAT_WORDS: Record<BoundHatDirection, string> = {
  U: 'up',
  UR: 'up-right',
  R: 'right',
  DR: 'down-right',
  D: 'down',
  DL: 'down-left',
  L: 'left',
  UL: 'up-left',
};
const AXIS_WORDS: Record<string, string> = {
  X: 'X axis',
  Y: 'Y axis',
  Z: 'Z axis',
  RX: 'X rotation',
  RY: 'Y rotation',
  RZ: 'Z rotation',
  SLIDER1: 'Slider 1',
  SLIDER2: 'Slider 2',
};

/** One action on one input of a device, as it is in effect now. */
export interface BoundInput {
  /** The game's name for the input: JOY_BTN3, JOY_BTN_POV1_U, JOY_X, LShift. */
  input: string;
  /** "Button 3", "Hat 1 up", "X axis". */
  inputLabel: string;
  kind: BoundInputKind;
  /**
   * The control on the controller, whatever the game calls it. Absent for keys and for
   * inputs that are not one control of a controller.
   */
  control?: BoundControl;
  /** Modifiers that must be held with it, in plain language ("LCtrl", "Button 5 on Stick"). */
  modifiers: string[];
  /** Stable id of the action within the aircraft. */
  actionId: string;
  /** Plain-language name of the action: "Weapon Release Button". */
  action: string;
  /** Category path, outermost first; empty when the game gives none. */
  category: string[];
  /** The user's own binding, or one the game ships (its defaults or its template for the device). */
  source: 'user' | 'default';
}

/** What a controller is used for in the game, as the bindings feature knows it. */
export type BoundDeviceRole = 'stick' | 'throttle' | 'pedals' | 'panel' | 'mfd' | 'none' | 'other';

/** A device as the game knows it, with what its inputs do. */
export interface BoundDevice {
  kind: 'controller' | 'keyboard' | 'mouse' | 'other';
  /** The name the game knows the device by (the DirectInput product name). */
  name: string;
  /** The name the owner gave it, when there is one. */
  givenName?: string;
  /** DirectInput instance GUID (upper case, no braces); absent for keyboard and mouse. */
  guid?: string;
  vendorId?: string;
  productId?: string;
  /** Attached right now. */
  connected: boolean;
  /** What the device is used for (the user's choice, or the bindings feature's guess). */
  role?: BoundDeviceRole;
  /** The controls a controller has, when known: button and hat counts, axis names (X, RZ, SLIDER1). */
  controls?: { buttons: number; hats: number; axes: string[] };
  /** Every binding that can fire, in the device's own input order. */
  bindings: BoundInput[];
}

/** One action an aircraft has, bound or not. */
export interface BoundAction {
  /** Stable id within the aircraft, the same as BoundInput.actionId. */
  id: string;
  /** The game's own name for it: "Sensor Control Switch - Fwd". */
  name: string;
  category: string[];
  /** A button-type action (also bindable to a hat direction or a key) or an axis. */
  kind: 'button' | 'axis';
  /** False when the bindings feature can show the action but cannot write a binding for it. */
  editable: boolean;
}

/**
 * A change another feature proposes (the AI guidance, a guided walkthrough). It never
 * writes anything itself: the bindings feature that owns the game's files previews it,
 * writes it with a backup as one undoable change, and can undo it.
 */
export interface ProposedBindingChange {
  op: 'bind' | 'unbind';
  /** The controller (DirectInput instance GUID), or the keyboard when absent. */
  deviceGuid?: string;
  /** The game's input name: JOY_BTN5, JOY_BTN_POV1_U, JOY_RZ, or a key name. */
  input: string;
  /** The game's modifier names that must be held with it ("LCtrl"); usually none. */
  modifiers?: string[];
  actionId: string;
}

export interface BindingProposal {
  aircraftId: string;
  /** One line for the journal and the review: "Bind 4 actions from the guide (F/A-18C)". */
  summary: string;
  changes: ProposedBindingChange[];
}

/** Exactly what a proposal would write, file by file, before anything is written. */
export interface ProposalPlan {
  summary: string;
  files: {
    path: string;
    action: 'create' | 'change' | 'delete' | 'rename';
    to?: string;
    title: string;
    /** What changes, in plain language, one line each. */
    lines: string[];
    /** The exact text change. */
    diff: { type: 'same' | 'add' | 'del' | 'gap'; text: string }[];
  }[];
  notes: string[];
  /** Set when the plan cannot be applied now (the game is running), with the reason. */
  blocked?: string;
}

export interface ProposalApplied {
  /** The journal group, for Undo. */
  groupId: string;
  summary: string;
  files: number;
}

/** The bindings feature's review-and-write path, offered to other features. */
export interface BindingProposals {
  plan(proposal: BindingProposal): Promise<Result<ProposalPlan>>;
  apply(proposal: BindingProposal): Promise<Result<ProposalApplied>>;
  undo(groupId: string): Promise<Result<void>>;
}

export interface AircraftBindings {
  aircraft: BoundAircraft;
  devices: BoundDevice[];
}

export interface BindingReader {
  /** Game module id: "dcs". One reader per game. */
  game: string;
  /** "DCS World". */
  gameName: string;
  /** True when the game's bindings can be read on this PC. Cheap: no binding file is parsed. */
  available(): Promise<boolean>;
  /** The aircraft the game has bindings for, the user's own first. */
  aircraft(): Promise<Result<BoundAircraft[]>>;
  /** The bindings in effect for one aircraft, per device. */
  bindings(aircraftId: string): Promise<Result<AircraftBindings>>;
  /**
   * The in-app route of the page that shows these bindings, opened on a device (by
   * DirectInput instance GUID) and an aircraft when given.
   */
  route(target?: { guid?: string; aircraftId?: string }): string;
  /**
   * True when `route({ guid })` opens the page on that one controller. A game whose page
   * is about the game as a whole leaves it out, and a list of devices then does not offer
   * a link to it from every controller.
   */
  routesToDevice?: boolean;
  /** Every action the aircraft has, bound or not. Optional: not every game can list them. */
  actions?(aircraftId: string): Promise<Result<BoundAction[]>>;
  /** Preview, write and undo changes proposed by another feature. Optional. */
  proposals?: BindingProposals;
}

/** What a bindings feature says after it changed a game's bindings. */
export interface BindingsChanged {
  /** Game module id. */
  game: string;
  /** The aircraft whose bindings changed; absent when several or all may have. */
  aircraftId?: string;
}

/**
 * Plain-language names for a game's actions ("Sensor Control Switch - Fwd" is "Sensor
 * select: HUD"), from whoever knows them (the binding guide's shipped label files). Any
 * feature that shows actions reads them through `ctx.bindings.labels(game, aircraftId)`
 * and shows the game's own name beside them: a label is for reading, never for matching.
 */
export interface ActionLabelSource {
  id: string;
  /** Game module id: "dcs". */
  game: string;
  /** Plain label by the game's own action name, for one aircraft. Empty when it has none. */
  labels(aircraftId: string): Promise<Record<string, string>>;
}

export class BindingRegistry {
  private readonly readers = new Map<string, BindingReader>();
  private readonly labelSources: ActionLabelSource[] = [];
  private readonly changeListeners = new Set<(change: BindingsChanged) => void>();

  /**
   * Called by the feature that owns a game's binding files after it changed them (an
   * edit, a restore, an undo of its own), so features that show bindings refresh.
   */
  notifyChanged(change: BindingsChanged): void {
    for (const listener of [...this.changeListeners]) {
      try {
        listener(change);
      } catch {
        // A listener that fails must not stop the others or the change that was just made.
      }
    }
  }

  /** Subscribes to binding changes; returns the unsubscribe function. */
  onChanged(listener: (change: BindingsChanged) => void): () => void {
    this.changeListeners.add(listener);
    return () => {
      this.changeListeners.delete(listener);
    };
  }

  registerLabels(source: ActionLabelSource): void {
    if (this.labelSources.some((s) => s.id === source.id)) {
      throw new Error(`Action labels registered twice: ${source.id}`);
    }
    this.labelSources.push(source);
  }

  /** Plain labels of one aircraft's actions, by the game's action name. Never fails. */
  async labels(game: string, aircraftId: string): Promise<Record<string, string>> {
    const merged: Record<string, string> = {};
    for (const source of this.labelSources) {
      if (source.game !== game) continue;
      try {
        // The first source to name an action wins.
        for (const [name, label] of Object.entries(await source.labels(aircraftId))) {
          merged[name] ??= label;
        }
      } catch {
        // A label source that fails leaves the game's own names in place.
      }
    }
    return merged;
  }

  register(reader: BindingReader): void {
    if (this.readers.has(reader.game)) {
      throw new Error(`Bindings of ${reader.game} already have a reader`);
    }
    this.readers.set(reader.game, reader);
  }

  get(game: string): BindingReader | undefined {
    return this.readers.get(game);
  }

  all(): BindingReader[] {
    return [...this.readers.values()].sort((a, b) => a.gameName.localeCompare(b.gameName));
  }
}
