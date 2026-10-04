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
}

export type BoundInputKind = 'button' | 'hat' | 'axis' | 'key';

/** One action on one input of a device, as it is in effect now. */
export interface BoundInput {
  /** The game's name for the input: JOY_BTN3, JOY_BTN_POV1_U, JOY_X, LShift. */
  input: string;
  /** "Button 3", "Hat 1 up", "X axis". */
  inputLabel: string;
  kind: BoundInputKind;
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
  /** Every action the aircraft has, bound or not. Optional: not every game can list them. */
  actions?(aircraftId: string): Promise<Result<BoundAction[]>>;
  /** Preview, write and undo changes proposed by another feature. Optional. */
  proposals?: BindingProposals;
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
