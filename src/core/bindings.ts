import type { Result } from './result';

/**
 * "What is bound?", for every feature that is not the bindings feature of a game: the
 * input tester (what does this button do), cheat sheets, AI guidance.
 *
 * A bindings feature registers a reader for its game from its main.ts
 * (`ctx.bindings.register(reader)`); any other feature asks through `ctx.bindings`.
 * Read only: changing bindings stays inside the feature that owns the game's files.
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
  /** Every binding that can fire, in the device's own input order. */
  bindings: BoundInput[];
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
}

export class BindingRegistry {
  private readonly readers = new Map<string, BindingReader>();

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
