import { z } from 'zod';
import type {
  AircraftBindings,
  BoundAction,
  BoundDevice,
  BoundInput,
} from '../../../core/bindings';
import { err, ok, type Result } from '../../../core/result';
import { ChangePreviewSchema } from '../../../shared/changePreview';
import type { Envelope } from '../../../shared/ipc';
import type { Pack } from './pack';
import type { ControllerRef } from './snapshot';

/**
 * The binding guide for iRacing. Guides are by class of car (GT3, formula, ...), not per car:
 * every car has the same 369 actions, and what matters differs by class. The bindings come
 * from the iRacing bindings feature, which owns iRacing's files: the guide reads a set through
 * its channels and binds one button or key at a time through its change channels, the same
 * preview, backup and Undo the iRacing bindings page uses. Nothing here reads or writes a file.
 */

/** Guide ids for iRacing start with this; DCS ids are folder names and never hold a colon. */
export const IRACING_PREFIX = 'iracing:';
/** The iRacing bindings feature's id of a car's own set: "car:<folder>". */
const CAR_SET = 'car:';
/** Its id of the set for all cars. */
export const ALL_CARS = 'all';

/** The classes RigReady ships a guide for, in the order the page lists them. */
export const IRACING_CLASSES = ['gt3', 'gt4', 'prototypes', 'formula', 'oval', 'dirt'] as const;

export const isIracingId = (id: string): boolean => id.toLowerCase().startsWith(IRACING_PREFIX);

// ---------------------------------------------------------------------------
// What the iRacing bindings feature answers: only the fields used here are read.
// ---------------------------------------------------------------------------

const SetSchema = z.object({
  id: z.string(),
  name: z.string(),
  general: z.boolean(),
  profile: z.string().optional(),
});

export const IracingOverviewSchema = z.object({
  installed: z.boolean(),
  simRunning: z.boolean(),
  sets: z.array(SetSchema),
  source: z.object({ problem: z.string().optional() }).optional(),
  /** Changing a binding is on in this run of RigReady. */
  editing: z.boolean(),
});
export type IracingOverview = z.infer<typeof IracingOverviewSchema>;

const ActionSchema = z.object({
  id: z.string(),
  group: z.string(),
  accepts: z.array(z.enum(['axis', 'button', 'key'])),
  binding: z
    .object({
      kind: z.enum(['axis', 'button', 'key', 'unknown']),
      device: z.string(),
      deviceName: z.string(),
      input: z.string(),
    })
    .optional(),
});

export const IracingSetSchema = z.object({
  set: SetSchema,
  devices: z.array(
    z.object({
      key: z.string(),
      kind: z.enum(['controller', 'keyboard']),
      name: z.string(),
      givenName: z.string().optional(),
      state: z.string(),
    })
  ),
  actions: z.array(ActionSchema),
  notes: z.array(z.string()),
});
export type IracingSet = z.infer<typeof IracingSetSchema>;

/** What a binding is to be, as the iRacing bindings feature takes it. */
export const IracingWantedSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('button'),
    /** The controller's DirectInput instance GUID, as a press gives it. */
    device: z.string().max(64),
    /** The first button is 1. */
    button: z.number().int().min(1).max(128),
  }),
  z.object({
    /** A key as the window saw it; the iRacing feature turns it into iRacing's key code. */
    kind: z.literal('keyPress'),
    key: z.string().max(40),
    code: z.string().max(40),
    shiftKey: z.boolean(),
    ctrlKey: z.boolean(),
    altKey: z.boolean(),
    metaKey: z.boolean().optional(),
  }),
]);
export type IracingWanted = z.infer<typeof IracingWantedSchema>;

export const IracingReviewSchema = z.object({
  action: z.object({ id: z.string(), name: z.string() }),
  before: z.string(),
  after: z.string(),
  same: z.boolean(),
  conflicts: z.array(z.object({ id: z.string(), name: z.string(), cameraEditor: z.boolean() })),
  blocked: z.string().optional(),
  preview: ChangePreviewSchema,
  seen: z.string(),
});
export type IracingReview = z.infer<typeof IracingReviewSchema>;

export const IracingChangedSchema = z.object({ changed: z.boolean(), message: z.string() });
export type IracingChanged = z.infer<typeof IracingChangedSchema>;

export interface IracingRequest {
  set: string;
  action: string;
  binding: IracingWanted;
  seen?: string;
}

/** iRacing's bindings as the guide reaches them. */
export interface IracingBindings {
  overview(): Promise<Result<IracingOverview>>;
  set(id: string): Promise<Result<IracingSet>>;
  changePreview(request: IracingRequest): Promise<Result<IracingReview>>;
  change(request: IracingRequest): Promise<Result<IracingChanged>>;
}

/**
 * The iRacing bindings feature's channels, called with the same validation a window gets.
 * An answer in a form this does not know is an error, never a guess.
 */
export function iracingThroughChannels(
  invoke: (channel: string, input?: unknown) => Promise<Envelope>
): IracingBindings {
  async function call<T>(channel: string, input: unknown, schema: z.ZodType<T>) {
    const answer = await invoke(`iracing-bindings:${channel}`, input);
    if (!answer.ok) return answer;
    const parsed = schema.safeParse(answer.value);
    return parsed.success
      ? ok(parsed.data)
      : err(
          'ai.iracingAnswer',
          'The iRacing bindings answered in a form the binding guide does not know.',
          z.prettifyError(parsed.error)
        );
  }
  return {
    overview: () => call('overview', undefined, IracingOverviewSchema),
    set: (id) => call('set', { id }, IracingSetSchema),
    changePreview: (request) => call('changePreview', request, IracingReviewSchema),
    change: (request) => call('change', request, IracingChangedSchema),
  };
}

// ---------------------------------------------------------------------------
// What the guide page lists: the classes, and each car with its own controls.
// ---------------------------------------------------------------------------

export interface IracingEntry {
  /** "iracing:gt3", or "iracing:car:<folder>" for a car with controls of its own. */
  id: string;
  name: string;
  /** The iRacing bindings feature's set it reads and binds: "all", or "car:<folder>". */
  set: string;
  kind: 'class' | 'car';
  /** The car's folder name as iRacing has it, for a car. */
  folder?: string;
}

export function iracingEntries(
  overview: IracingOverview,
  classes: { id: string; name: string }[]
): IracingEntry[] {
  const entries: IracingEntry[] = classes.map((c) => ({
    id: `${IRACING_PREFIX}${c.id}`,
    name: c.name,
    set: ALL_CARS,
    kind: 'class',
  }));
  for (const set of overview.sets) {
    if (set.general || !set.id.startsWith(CAR_SET)) continue;
    const folder = set.id.slice(CAR_SET.length);
    entries.push({
      id: `${IRACING_PREFIX}${set.id}`,
      name: `${folder} (own controls)`,
      set: set.id,
      kind: 'car',
      folder,
    });
  }
  return entries;
}

/**
 * A class a car's folder name says it is in, with the part of the name that says so. Only
 * what the name itself says: iRacing's folders are not a list of classes, so a car whose
 * name has none of these gets no suggestion.
 */
const CLASS_IN_NAME: [RegExp, string][] = [
  [/gt3/i, 'gt3'],
  [/gt4/i, 'gt4'],
  [/gtp|lmdh|lmp[123]/i, 'prototypes'],
  [/dirt/i, 'dirt'],
];

export function classInName(folder: string): { classId: string; token: string } | undefined {
  for (const [pattern, classId] of CLASS_IN_NAME) {
    const found = pattern.exec(folder);
    if (found) return { classId, token: found[0].toLowerCase() };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// One set, in the terms every guide is matched in.
// ---------------------------------------------------------------------------

const UNREAD = 'A binding RigReady cannot read';

/**
 * The set's actions and bindings as a guide is matched against them. iRacing's own id is
 * the action's name ("BrakeBiasInc"): that is the name its controls file and the iRacing
 * bindings page give it. An action that only takes an axis is bound in iRacing; any other
 * takes a button or a key, which RigReady writes while editing is on.
 */
export function iracingParts(
  entry: IracingEntry,
  view: IracingSet,
  editing: boolean
): { actions: BoundAction[]; bindings: AircraftBindings; controllers: ControllerRef[] } {
  const actions: BoundAction[] = view.actions.map((a) => {
    const axisOnly = a.accepts.length > 0 && a.accepts.every((k) => k === 'axis');
    return {
      id: a.id,
      name: a.id,
      category: [a.group],
      kind: axisOnly ? 'axis' : 'button',
      editable: editing && (a.accepts.includes('button') || a.accepts.includes('key')),
    };
  });
  const devices = new Map<string, BoundDevice>();
  const deviceFor = (key: string, kind: 'key' | 'unknown' | 'axis' | 'button'): BoundDevice => {
    const id = kind === 'key' ? 'keyboard' : kind === 'unknown' ? '' : key;
    let device = devices.get(id);
    if (!device) {
      const known = view.devices.find((d) => d.key === id);
      device =
        kind === 'key'
          ? { kind: 'keyboard', name: 'Keyboard', connected: true, bindings: [] }
          : kind === 'unknown'
            ? // A binding whose bytes RigReady does not understand is still a binding.
              { kind: 'controller', name: 'iRacing', connected: false, bindings: [] }
            : {
                kind: 'controller',
                name: known?.name ?? 'Unknown controller',
                ...(known?.givenName ? { givenName: known.givenName } : {}),
                guid: id.toUpperCase(),
                connected: known?.state === 'connected',
                bindings: [],
              };
      devices.set(id, device);
    }
    return device;
  };
  for (const a of view.actions) {
    const b = a.binding;
    if (!b) continue;
    const input: BoundInput = {
      input: b.kind === 'unknown' ? UNREAD : b.input,
      inputLabel: b.kind === 'unknown' ? UNREAD : b.input,
      kind: b.kind === 'axis' ? 'axis' : b.kind === 'key' ? 'key' : 'button',
      modifiers: [],
      actionId: a.id,
      action: a.id,
      category: [a.group],
      source: 'user',
    };
    deviceFor(b.device, b.kind).bindings.push(input);
  }
  const controllers: ControllerRef[] = view.devices
    .filter((d) => d.kind === 'controller' && d.state === 'connected')
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((d, i) => ({
      ref: `dev${i + 1}`,
      name: d.name.trim(),
      ...(d.givenName ? { givenName: d.givenName } : {}),
      guid: d.key.toUpperCase(),
      role: 'other',
      connected: true,
      controls: { buttons: 0, hats: 0, axes: [] },
    }));
  return {
    actions,
    bindings: {
      aircraft: { id: entry.id, name: entry.name, hasUserBindings: true },
      devices: [...devices.values()],
    },
    controllers,
  };
}

/** The shipped iRacing class guides, in the page's order. */
export function classGuides(packs: Iterable<Pack>): Pack[] {
  const byClass = new Map<string, Pack>();
  for (const pack of packs) {
    if (pack.game === 'iracing') byClass.set(pack.aircraft.id.toLowerCase(), pack);
  }
  const order: readonly string[] = IRACING_CLASSES;
  return [...byClass.entries()]
    .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
    .map(([, pack]) => pack);
}
