import { controlFromDirectInput, controlLabel, type BoundAircraft } from '../../../core/bindings';
import type { BindingReader } from '../../../core/bindings';
import { boundControl, boundInputsOf, type BoundInputs } from '../../../core/boundInputs';
import type { MainContext } from '../../../core/feature';
import type { DeviceNames } from '../../../core/names';
import { screenOf } from '../../../core/overlayPlace';
import type { Profile } from '../../../core/profile/schema';
import { err, fromThrown, ok, type Result } from '../../../core/result';
import type {
  DisplayInfo,
  InputDevice,
  InputState,
  VirtualPadStatus,
} from '../../../shared/models';
import { aircraftNamedBy, pickAircraft, type AircraftPick } from './aircraft';
import { shortDeviceName } from './deviceName';
import { PressFeed, type FeedLimits } from './feed';
import type { OverlaySource, OverlayState, PressAction, PressRow, WidgetState } from './model';
import { overlayScreens, placeSignature, resolvePlace, screenNames, storedMonitor } from './place';
import { PressTracker } from './presses';
import { NO_SETTINGS, type At, type OverlaySettings, type StoredMonitor } from './settings';
import { OverlayStore } from './store';
import {
  RECENT_PRESSES,
  recentPresses,
  WIDGET_KINDS,
  widgetKind,
  type RecentPressesOptions,
  type WidgetKind,
} from './widgets';

/**
 * The overlay as it runs: what is up over the game, where, and what it is fed.
 *
 * While the overlay is on, every widget has a see-through window of its own
 * (`ports.overlays`), and the presses of every controller are read from the shared input
 * reader, which reads while a game has the keyboard. A press is looked up in the bindings of
 * the game and aircraft the setup in use is for (`ctx.bindings`, the lookup the input tester
 * uses) and put in the list the windows draw.
 *
 * Nothing here runs on a timer. What can change behind its back (another setup played, the
 * screens rearranged, a binding changed in the game) is looked at again when the user
 * presses something and it has been a while, and whenever the Overlay page is read. An
 * overlay nobody presses anything for shows nothing, and does nothing.
 */

/** While presses come in, this often: another setup, other screens, a virtual controller. */
export const QUICK_CHECK_MS = 10_000;
/** And this often, the game's bindings and the names are read again. */
export const FULL_CHECK_MS = 120_000;
/** How long turning on waits for the input reader before saying it is not reading yet. */
export const INPUT_WAIT_MS = 4000;

/** The id of a widget's window on the overlays port, and the page it shows. */
export const panelId = (widget: string): string => `overlay-${widget}`;
export const panelRoute = (widget: string): string => `/overlay/${widget}`;

type Ctx = Pick<MainContext, 'ports' | 'log' | 'profiles' | 'games' | 'names' | 'bindings'>;

export interface OverlayEvents {
  /** The state changed: the page and the windows take this instead of reading again. */
  changed(state: OverlayState): void;
  /** The recent presses changed. */
  presses(rows: PressRow[]): void;
}

/** One line of the recent presses, as the list keeps it. */
interface Pressed {
  control: string;
  device: string;
  actions: PressAction[];
  known: boolean;
}

interface Source {
  setup?: { id: string; name: string };
  game?: { id: string; name: string };
  pick?: AircraftPick;
  choices: BoundAircraft[];
  /** The bindings in effect, by controller and input. Absent: they could not be read. */
  bound?: BoundInputs;
  problem?: string;
}

interface InputStatus {
  ok: boolean;
  problem?: string;
}

const NO_NAMES: DeviceNames = { nameOf: () => undefined };
const NO_SCREEN = 'No screen is on, so there is nothing to show the overlay on.';
/** Said after "the controllers are not being read", so it only says why. */
const INPUT_STARTING = 'The input reader is still starting.';

const usable = (display: DisplayInfo): boolean =>
  display.enabled && display.width > 0 && display.height > 0;

const limitsOf = (options: RecentPressesOptions): FeedLimits => ({
  lifetimeMs: options.lifetimeSeconds * 1000,
  rows: options.rows,
});

/** "Button 12", "Hat 1 up"; the input's own name when it is neither. */
function controlWords(input: string): string {
  const control = controlFromDirectInput(input);
  return control ? controlLabel(control) : input;
}

/**
 * Whether a controller is the virtual one RigReady itself has plugged in. It repeats what
 * the real controllers do, so its presses would show everything twice.
 */
function isOwnPad(device: InputDevice, pad: VirtualPadStatus | undefined): boolean {
  if (!pad?.plugged) return false;
  const ids = `${device.vendorId}:${device.productId}`.toUpperCase();
  if (pad.kind === 'ds4') return ids === '054C:05C4';
  return ids === '045E:028E' || /xbox 360 for windows/i.test(device.name);
}

export class OverlayService {
  private readonly store: OverlayStore;
  private readonly tracker = new PressTracker();
  private readonly feed: PressFeed<Pressed>;

  /** The settings as last read, and why they could not be read when they could not. */
  private settings: OverlaySettings = NO_SETTINGS;
  private settingsProblem: string | undefined;
  private pressOptions: RecentPressesOptions = recentPresses.read(undefined);

  private source: Source = { choices: [] };
  /** The setup that was last played when the source was read. */
  private lastSetup: string | undefined;
  private deviceNames: DeviceNames = NO_NAMES;
  private readonly deviceLabels = new Map<string, string>();
  private displays: DisplayInfo[] = [];
  private monitorNames: Record<string, string> = {};
  private pad: VirtualPadStatus | undefined;

  /** The windows that are up, by widget: what each was last shown with. */
  private readonly shown = new Map<string, string>();
  private readonly moving = new Set<string>();
  private readonly problems = new Map<string, string>();

  private stopInput: (() => void) | undefined;
  private stopBindings: (() => void) | undefined;
  private input: InputStatus = { ok: false, problem: INPUT_STARTING };
  private inputStarting: Promise<void> | undefined;
  /** The state the page and the windows were last told, to tell them only what is new. */
  private told = '';

  private quickAt = 0;
  private fullAt = 0;
  private checking = false;
  /** One thing at a time: what changes the overlay runs in the order it was asked for. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly ctx: Ctx,
    private readonly events: OverlayEvents,
    /** How long the switch waits for the input reader before it answers without it. */
    private readonly inputWaitMs = INPUT_WAIT_MS
  ) {
    this.store = new OverlayStore(ctx.ports.files, ctx.ports.folders);
    this.feed = new PressFeed(limitsOf(this.pressOptions));
  }

  // ---- what the page and the windows ask ----

  /** Everything the Overlay page shows, read fresh. */
  state(): Promise<Result<OverlayState>> {
    return this.run(async () => {
      await this.refresh(true);
      return ok(this.announce());
    });
  }

  /**
   * The state as the overlay last worked it out, with nothing read again: for a window of
   * the overlay, which opens over the game and should cost nothing there.
   */
  current(): Result<OverlayState> {
    try {
      return ok(this.build());
    } catch (e) {
      return fromThrown('overlay.failed', 'The overlay could not be read.', e);
    }
  }

  /** The recent presses as they are now: for a window that just opened. */
  recent(): Result<{ rows: PressRow[] }> {
    try {
      return ok({ rows: this.rows(this.now()) });
    } catch (e) {
      return fromThrown('overlay.failed', 'The recent presses could not be read.', e);
    }
  }

  /** The user's switch. On: the overlay is up now and whenever RigReady runs. */
  setOn(on: boolean): Promise<Result<OverlayState>> {
    return this.run(async () => {
      const written = await this.store.update((current) => ({ ...current, on }));
      if (!written.ok) return written;
      await this.refresh(true);
      if (on) await this.inputKnown();
      return ok(this.announce());
    });
  }

  /** Sets a widget's options, all of them. */
  setOptions(widget: string, options: unknown): Promise<Result<OverlayState>> {
    return this.run(async () => {
      const kind = widgetKind(widget);
      if (!kind) return noWidget(widget);
      const checked = kind.check(options);
      if (!checked.ok) return checked;
      const written = await this.store.update((current) => ({
        ...current,
        widgets: {
          ...current.widgets,
          [kind.id]: { ...current.widgets[kind.id], options: checked.value },
        },
      }));
      if (!written.ok) return written;
      await this.refresh(false);
      // Fewer rows or a shorter time apply to what is shown already.
      if (kind.id === RECENT_PRESSES && this.settings.on)
        this.events.presses(this.rows(this.now()));
      return ok(this.announce());
    });
  }

  /**
   * Puts a widget at a place, on a screen that is on when one is named and on the screen it
   * already belongs to otherwise.
   */
  place(
    widget: string,
    to: { screen?: string | undefined; at: At }
  ): Promise<Result<OverlayState>> {
    return this.run(async () => {
      const kind = widgetKind(widget);
      if (!kind) return noWidget(widget);
      await this.readDisplays();
      let monitor: StoredMonitor | undefined;
      if (to.screen !== undefined) {
        const id = to.screen.toLowerCase();
        const display = this.displays.find((d) => d.id.toLowerCase() === id && usable(d));
        if (!display) return err('overlay.screen', 'That screen is not on.');
        monitor = storedMonitor(display, this.nameOf(display));
      }
      const written = await this.store.update((current) => {
        const kept = monitor ?? current.widgets[kind.id]?.place?.monitor;
        return {
          ...current,
          widgets: {
            ...current.widgets,
            [kind.id]: {
              options: {},
              ...current.widgets[kind.id],
              place: { ...(kept ? { monitor: kept } : {}), at: to.at },
            },
          },
        };
      });
      if (!written.ok) return written;
      await this.refresh(false);
      return ok(this.announce());
    });
  }

  /**
   * Starts and ends placing a widget by hand. While it is being placed its window takes the
   * mouse and can be dragged; ending it keeps the place it was dragged to, on the screen it
   * was dragged to, and lets the mouse through again.
   */
  move(widget: string, moving: boolean): Promise<Result<OverlayState>> {
    return this.run(async () => {
      const kind = widgetKind(widget);
      if (!kind) return noWidget(widget);
      if (moving) {
        await this.refresh(false);
        if (!this.settings.on) return err('overlay.off', 'Turn the overlay on first.');
        this.moving.add(kind.id);
        await this.show(kind);
        if (!this.shown.has(kind.id)) {
          this.moving.delete(kind.id);
          this.announce();
          return err(
            'overlay.notShown',
            this.problems.get(kind.id) ?? 'The overlay could not be shown.'
          );
        }
        return ok(this.announce());
      }
      if (!this.moving.has(kind.id)) return ok(this.announce());
      const kept = await this.keepPlace(kind);
      this.moving.delete(kind.id);
      await this.refresh(false);
      const state = this.announce();
      return kept.ok ? ok(state) : kept;
    });
  }

  /**
   * The aircraft or car the labels are for, for the setup in use; null goes back to what
   * RigReady works out by itself.
   */
  chooseAircraft(aircraftId: string | null): Promise<Result<OverlayState>> {
    return this.run(async () => {
      await this.readSettings();
      await this.readSource();
      const { game, setup, choices } = this.source;
      const key = setup?.id ?? '';
      if (aircraftId !== null) {
        if (!game || choices.length === 0) {
          return err(
            'overlay.aircraft',
            'There are no bindings to choose an aircraft or car from.'
          );
        }
        if (!choices.some((choice) => choice.id === aircraftId)) {
          return err(
            'overlay.aircraft',
            `${game.name} has no bindings for that aircraft or car.`,
            aircraftId
          );
        }
      }
      const written = await this.store.update((current) => {
        const { [key]: _before, ...others } = current.aircraft;
        return {
          ...current,
          aircraft:
            aircraftId !== null && game
              ? { ...others, [key]: { game: game.id, aircraftId } }
              : others,
        };
      });
      if (!written.ok) return written;
      this.settings = written.value;
      await this.readSource();
      return ok(this.announce());
    });
  }

  // ---- the life of the app ----

  /** At startup: the overlay comes up when it was left on. */
  start(): Promise<void> {
    return this.run(async () => {
      await this.readSettings();
      if (this.settings.on) {
        await this.refresh(true);
        this.announce();
      }
      return ok(undefined);
    }).then((done) => {
      if (!done.ok) this.ctx.log.warn('the overlay could not start', done.error);
    });
  }

  /** On quit: stops listening and takes the windows away. */
  async dispose(): Promise<void> {
    this.unlisten();
    for (const widget of [...this.shown.keys()]) {
      this.shown.delete(widget);
      try {
        await this.ctx.ports.overlays.hidePanel(panelId(widget));
      } catch (e) {
        this.ctx.log.warn('an overlay window could not be closed', e);
      }
    }
  }

  /** Resolves when nothing that was asked for is still running. */
  async idle(): Promise<void> {
    let seen: unknown;
    do {
      seen = this.queue;
      await this.queue;
      await this.inputStarting;
    } while (seen !== this.queue);
  }

  // ---- presses ----

  private onInput(states: InputState[]): void {
    try {
      const changes = this.tracker.changes(states, () => this.ctx.ports.input.devices());
      if (changes.length === 0) return;
      const now = this.now();
      this.checkIfDue(now);
      let changed = false;
      for (const change of changes) {
        const device = change.device;
        if (isOwnPad(device, this.pad)) continue;
        const key = device.guid || `${device.index}|${device.name}`;
        if (change.kind === 'release') {
          changed = this.feed.release(now, key, change.input) || changed;
          continue;
        }
        const known = this.source.bound !== undefined;
        const actions = (boundControl(this.source.bound, device.guid, change.input)?.actions ?? [])
          .map(({ action, modifiers }) => ({ action, modifiers }))
          // What works on its own before what needs something held with it.
          .sort((a, b) => Number(a.modifiers.length > 0) - Number(b.modifiers.length > 0));
        if (known && actions.length === 0 && !this.pressOptions.showUnbound) continue;
        this.feed.press(now, key, change.input, {
          control: controlWords(change.input),
          device: this.deviceLabel(device),
          actions,
          known,
        });
        changed = true;
      }
      if (changed) this.events.presses(this.rows(now));
    } catch (e) {
      // One state that cannot be made sense of must not end the listening.
      this.ctx.log.warn('a controller state could not be read for the overlay', e);
    }
  }

  private rows(now: number): PressRow[] {
    return this.feed.rows(now).map((entry) => ({
      id: entry.id,
      count: entry.count,
      stamp: entry.stamp,
      ageMs: Math.max(0, now - entry.stamp),
      ...entry.what,
    }));
  }

  private deviceLabel(device: InputDevice): string {
    const key = device.guid || `${device.index}|${device.name}`;
    let label = this.deviceLabels.get(key);
    if (label === undefined) {
      let given: string | undefined;
      try {
        given = this.deviceNames
          .nameOf({
            vendorId: device.vendorId,
            productId: device.productId,
            ...(device.guid ? { guid: device.guid } : {}),
          })
          ?.trim();
      } catch (e) {
        // A name is never worth losing a press for.
        this.ctx.log.warn('a device name could not be looked up', e);
      }
      label = given || shortDeviceName(device.name);
      this.deviceLabels.set(key, label);
    }
    return label;
  }

  /** Looks at what may have changed behind the overlay's back, when it has been a while. */
  private checkIfDue(now: number): void {
    if (this.checking) return;
    const full = now - this.fullAt >= FULL_CHECK_MS;
    if (!full && now - this.quickAt < QUICK_CHECK_MS) return;
    this.checking = true;
    void this.run(async () => {
      await this.refresh(full);
      this.announce();
      return ok(undefined);
    }).finally(() => {
      this.checking = false;
    });
  }

  // ---- reading the world ----

  /**
   * Reads what the overlay depends on and brings the windows in line with it. `full` also
   * reads the game's bindings and the names again; without it they are read only when
   * another setup was played since.
   */
  private async refresh(full: boolean): Promise<void> {
    const now = this.now();
    this.quickAt = now;
    await this.readSettings();
    await this.readDisplays();
    await this.readPad();
    if (full || (await this.lastPlayed()) !== this.lastSetup) {
      this.fullAt = now;
      await this.readSource();
      await this.readNames();
      this.tracker.keep(this.ctx.ports.input.devices());
    }
    await this.reconcile();
  }

  private async readSettings(): Promise<void> {
    const read = await this.store.read();
    if (read.ok) {
      this.settings = read.value;
      this.settingsProblem = undefined;
    } else {
      // What was in effect stays in effect; the page says that the file is in trouble.
      this.settingsProblem = read.error.message;
    }
    this.pressOptions = recentPresses.read(this.settings.widgets[RECENT_PRESSES]?.options);
    // Left out from now on, and off the list at once: what the game has nothing on. Before
    // the number of lines is applied, so that none of them makes a line with words give way.
    if (!this.pressOptions.showUnbound) {
      this.feed.drop((what) => what.known && what.actions.length === 0);
    }
    this.feed.configure(limitsOf(this.pressOptions), this.now());
  }

  private async readDisplays(): Promise<void> {
    try {
      const read = await this.ctx.ports.displays.read();
      if (read.ok) this.displays = read.value.displays;
      else this.ctx.log.warn('the screens could not be read for the overlay', read.error);
      this.monitorNames = await this.ctx.names.monitors();
    } catch (e) {
      this.ctx.log.warn('the screens could not be read for the overlay', e);
    }
  }

  private async readPad(): Promise<void> {
    try {
      const status = await this.ctx.ports.pads.status();
      this.pad = status.ok ? status.value : undefined;
    } catch {
      // Without an answer, every controller is taken for a real one.
      this.pad = undefined;
    }
  }

  private async readNames(): Promise<void> {
    this.deviceNames = await this.ctx.names.devices();
    this.deviceLabels.clear();
  }

  private async lastPlayed(): Promise<string | undefined> {
    try {
      return await this.ctx.profiles.lastProfileId();
    } catch {
      // Not knowing which setup was played last is not an error here: the first one there
      // is stands in, and the page names the setup the words come from.
      return undefined;
    }
  }

  /** The setup in use: the one played last, or the first there is. */
  private async setupInUse(): Promise<Profile | undefined> {
    this.lastSetup = await this.lastPlayed();
    try {
      const all = await this.ctx.profiles.list();
      if (!all.ok) return undefined;
      return all.value.find((profile) => profile.id === this.lastSetup) ?? all.value[0];
    } catch {
      // Setups that cannot be read are no setup here: the overlay then goes by the
      // bindings that are on this PC, as it does before a setup is made.
      return undefined;
    }
  }

  /** Where the words for a press come from: the setup in use, its game, the aircraft. */
  private async readSource(): Promise<void> {
    const setup = await this.setupInUse();
    const source: Source = { choices: [] };
    if (setup) source.setup = { id: setup.id, name: setup.name };
    const reader = await this.readerFor(setup, source);
    if (reader) {
      source.game = { id: reader.game, name: reader.gameName };
      try {
        const listed = await reader.aircraft();
        if (!listed.ok) {
          source.problem = listed.error.message;
        } else {
          source.choices = listed.value;
          const chosen = this.settings.aircraft[setup?.id ?? ''];
          const pick = pickAircraft({
            aircraft: listed.value,
            chosen: chosen?.game === reader.game ? chosen.aircraftId : undefined,
            named: aircraftNamedBy(setup?.checks ?? []),
            setupName: setup?.name,
          });
          if (!pick) {
            source.problem = `${reader.gameName} has no bindings yet, so presses are shown without what they do.`;
          } else {
            source.pick = pick;
            const bindings = await reader.bindings(pick.aircraft.id);
            if (bindings.ok) source.bound = boundInputsOf(reader, bindings.value);
            else source.problem = bindings.error.message;
          }
        }
      } catch (e) {
        this.ctx.log.warn(`the bindings of ${reader.gameName} could not be read`, e);
        source.problem = `The bindings of ${reader.gameName} could not be read, so presses are shown without what they do.`;
      }
    }
    this.source = source;
  }

  /**
   * The game whose bindings are read: the game of the setup in use and no other, so that
   * the labels are never those of a game that is not being played. Without a setup (or
   * with one for no game in particular) it is the game whose bindings are on this PC when
   * there is exactly one; with several, nothing says which is played, and none is guessed.
   */
  private async readerFor(
    setup: Profile | undefined,
    source: Source
  ): Promise<BindingReader | undefined> {
    const { bindings, games } = this.ctx;
    const found = async (reader: BindingReader): Promise<boolean> => {
      try {
        return await reader.available();
      } catch {
        // A reader that fails here is the same as bindings that are not there.
        return false;
      }
    };
    if (setup?.game) {
      const reader = bindings.get(setup.game);
      const name =
        reader?.gameName ??
        (setup.game === 'other' ? setup.gameName : games.get(setup.game)?.name) ??
        'the game of this setup';
      if (reader && (await found(reader))) return reader;
      source.game = { id: setup.game, name };
      source.problem = reader
        ? `The bindings of ${name} were not found on this PC, so presses are shown without what they do.`
        : `RigReady cannot read the bindings of ${name}, so presses are shown without what they do.`;
      return undefined;
    }
    const here: BindingReader[] = [];
    for (const reader of bindings.all()) {
      if (await found(reader)) here.push(reader);
    }
    if (here.length === 1) return here[0];
    source.problem =
      here.length === 0
        ? 'No game whose bindings RigReady can read was found on this PC, so presses are shown without what they do.'
        : 'RigReady can read the bindings of more than one game here and no setup says which one you play, so presses are shown without what they do.';
    return undefined;
  }

  // ---- the windows ----

  /** Brings what is up in line with the settings. */
  private async reconcile(): Promise<void> {
    if (!this.settings.on) {
      await this.takeDown();
      return;
    }
    this.listen();
    for (const kind of WIDGET_KINDS) await this.show(kind);
  }

  private listen(): void {
    if (this.stopInput) return;
    // What is held when the listening starts is how the controllers rest.
    this.tracker.reset();
    this.stopInput = this.ctx.ports.input.subscribe((states) => this.onInput(states));
    void this.watchInput();
    this.stopBindings = this.ctx.bindings.onChanged(() => {
      void this.run(async () => {
        await this.readSource();
        this.announce();
        return ok(undefined);
      });
    });
  }

  private unlisten(): void {
    this.stopInput?.();
    this.stopInput = undefined;
    this.stopBindings?.();
    this.stopBindings = undefined;
  }

  private async takeDown(): Promise<void> {
    this.unlisten();
    this.tracker.reset();
    this.feed.clear();
    this.moving.clear();
    this.problems.clear();
    this.input = { ok: false, problem: INPUT_STARTING };
    for (const widget of [...this.shown.keys()]) await this.hide(widget);
  }

  private async hide(widget: string): Promise<void> {
    this.shown.delete(widget);
    const hidden = await this.ctx.ports.overlays.hidePanel(panelId(widget));
    if (!hidden.ok) this.ctx.log.warn('an overlay window could not be closed', hidden.error);
  }

  /** Shows a widget's window where it belongs, or leaves it when it is there already. */
  private async show(kind: WidgetKind): Promise<void> {
    const { overlays } = this.ctx.ports;
    const stored = this.settings.widgets[kind.id];
    const size = kind.size(stored?.options);
    const place = resolvePlace(stored?.place, kind.defaultAt, this.displays);
    if (!place) {
      this.problems.set(kind.id, NO_SCREEN);
      this.moving.delete(kind.id);
      if (this.shown.has(kind.id)) await this.hide(kind.id);
      return;
    }
    const movable = this.moving.has(kind.id);
    const signature = placeSignature(place, size, movable);
    if (this.shown.get(kind.id) === signature) {
      // Still there? A window can be closed from outside (the app's main window closing).
      const there = await overlays.panelPlace(panelId(kind.id));
      if (there.ok && there.value) return;
    }
    const { x, y, width, height } = place.display;
    const shown = await overlays.showPanel({
      id: panelId(kind.id),
      route: panelRoute(kind.id),
      screen: { x, y, width, height },
      width: size.width,
      height: size.height,
      at: place.at,
      movable,
    });
    if (shown.ok) {
      this.shown.set(kind.id, signature);
      this.problems.delete(kind.id);
    } else {
      this.shown.delete(kind.id);
      this.moving.delete(kind.id);
      this.problems.set(kind.id, shown.error.message);
      this.ctx.log.warn(`the overlay window "${kind.id}" could not be shown`, shown.error);
    }
  }

  /** Keeps the place the user dragged a widget's window to. */
  private async keepPlace(kind: WidgetKind): Promise<Result<void>> {
    const notKept = (detail?: string): Result<void> =>
      err(
        'overlay.place',
        'The new place could not be read, so the overlay is back where it was.',
        detail
      );
    const where = await this.ctx.ports.overlays.panelPlace(panelId(kind.id));
    if (!where.ok) return notKept(where.error.message);
    if (!where.value) return notKept();
    await this.readDisplays();
    const display = screenOf(this.displays.filter(usable), where.value.screen);
    if (!display) return notKept();
    const place = { monitor: storedMonitor(display, this.nameOf(display)), at: where.value.at };
    const written = await this.store.update((current) => ({
      ...current,
      widgets: {
        ...current.widgets,
        [kind.id]: { options: {}, ...current.widgets[kind.id], place },
      },
    }));
    return written.ok ? ok(undefined) : written;
  }

  // ---- the input reader ----

  /**
   * Makes sure the input reader runs. The overlay does not wait for it here: the page is
   * told whether the controllers are read as soon as that is known. (A game's bindings may
   * wait for it all the same: those of DCS are read with the list of attached controllers.
   * The reader gives up by itself after a quarter of a minute, so that wait has an end.)
   */
  private watchInput(): Promise<void> {
    this.inputStarting ??= Promise.resolve()
      .then(() => this.ctx.ports.input.start())
      .then(
        (started): InputStatus =>
          started.ok ? { ok: true } : { ok: false, problem: started.error.message },
        (e): InputStatus => {
          this.ctx.log.warn('the input reader could not be started for the overlay', e);
          return { ok: false, problem: 'The controllers could not be read.' };
        }
      )
      .then((status) => {
        this.inputStarting = undefined;
        // Turned off while the reader started: there is nothing to say about it.
        if (!this.stopInput) return;
        this.input = status;
        this.announce();
      });
    return this.inputStarting;
  }

  /**
   * For the switch the user just flipped: waits a few seconds for the reader and no longer,
   * so that the answer says whether the controllers are read whenever that is quick to know.
   */
  private async inputKnown(): Promise<void> {
    if (!this.stopInput || this.input.ok) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      this.watchInput(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, this.inputWaitMs);
      }),
    ]).finally(() => clearTimeout(timer));
  }

  // ---- the state ----

  private nameOf(display: DisplayInfo): string {
    return screenNames(this.displays, this.monitorNames).get(display.id.toLowerCase()) ?? 'Screen';
  }

  private build(): OverlayState {
    const names = screenNames(this.displays, this.monitorNames);
    const on = this.settings.on;
    const widgets: WidgetState[] = WIDGET_KINDS.map((kind) => {
      const stored = this.settings.widgets[kind.id];
      const options = kind.options(stored?.options);
      const size = kind.size(options);
      const place = resolvePlace(stored?.place, kind.defaultAt, this.displays);
      const problem = on ? this.problems.get(kind.id) : undefined;
      return {
        id: kind.id,
        title: kind.title,
        summary: kind.summary,
        options,
        width: size.width,
        height: size.height,
        place: {
          ...(place
            ? {
                screen: place.display.id,
                screenName: names.get(place.display.id.toLowerCase()) ?? 'Screen',
              }
            : {}),
          at: place?.at ?? stored?.place?.at ?? kind.defaultAt,
          ...(place?.away ? { away: place.away } : {}),
        },
        showing: this.shown.has(kind.id),
        moving: this.moving.has(kind.id),
        ...(problem ? { problem } : {}),
      };
    });
    const { setup, game, pick, choices, problem } = this.source;
    const source: OverlaySource = {
      ...(setup ? { setup } : {}),
      ...(game ? { game } : {}),
      ...(pick
        ? { aircraft: { id: pick.aircraft.id, name: pick.aircraft.name, how: pick.how } }
        : {}),
      choices: choices.map(({ id, name, hasUserBindings }) => ({ id, name, hasUserBindings })),
      ...(problem ? { problem } : {}),
    };
    return {
      on,
      widgets,
      screens: overlayScreens(this.displays, this.monitorNames),
      source,
      // Known only while the overlay is on: that is when the controllers are read for it.
      ...(on ? { input: { ...this.input } } : {}),
      ...(this.settingsProblem ? { problem: this.settingsProblem } : {}),
    };
  }

  /**
   * The state as it is now. The page and the windows are told when it is not what they
   * were last told, whatever brought the change about, so none of them shows an old one.
   */
  private announce(): OverlayState {
    const state = this.build();
    const told = JSON.stringify(state);
    if (told !== this.told) {
      this.told = told;
      this.events.changed(state);
    }
    return state;
  }

  private now(): number {
    return this.ctx.ports.clock.now().getTime();
  }

  /** Runs one thing after the other, and turns anything thrown into an answer. */
  private run<T>(work: () => Promise<Result<T>>): Promise<Result<T>> {
    const done = this.queue
      .then(work)
      .catch((e): Result<T> => fromThrown('overlay.failed', 'The overlay could not do that.', e));
    this.queue = done;
    return done;
  }
}

function noWidget(widget: string): Result<never> {
  return err('overlay.widget', 'The overlay has no such part.', widget);
}
