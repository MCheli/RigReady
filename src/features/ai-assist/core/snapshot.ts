import type {
  AircraftBindings,
  BindingReader,
  BoundAction,
  BoundDevice,
  BoundDeviceRole,
} from '../../../core/bindings';
import { err, ok, type Result } from '../../../core/result';
import { describeInput, type Controls } from './inputs';
import type { GuideGame, Pack } from './pack';

/**
 * Everything about one aircraft the guide and the AI work from: its actions, what is bound
 * now, the controllers, and the guide for it. Built fresh for every request from
 * `ctx.bindings`, so it is always what DCS has now.
 */

export interface ControllerRef {
  /** Short id used in requests to the AI ("dev1"); never a GUID, serial or path. */
  ref: string;
  name: string;
  givenName?: string;
  guid: string;
  role: BoundDeviceRole;
  connected: boolean;
  controls: Controls;
}

export interface Snapshot {
  /** The game: a DCS aircraft, or an iRacing class or car. */
  game: GuideGame;
  aircraftId: string;
  aircraftName: string;
  actions: BoundAction[];
  bindings: AircraftBindings;
  /** Connected controllers that are used in DCS (not marked "not used"), in name order. */
  controllers: ControllerRef[];
  pack?: Pack;
  /** Whose guide `pack` is. Absent means the one RigReady ships. */
  guideKind?: GuideKind;
  /** For iRacing: the set of bindings this is about, and whether RigReady may change it now. */
  iracing?: {
    /** The iRacing bindings feature's set id: "all", or "car:<folder>". */
    set: string;
    /** "All cars", or the car's folder name. */
    setName: string;
    /** The control profile the set is in, when iRacing keeps profiles. */
    profile?: string;
    /** The simulator runs: it writes its files when it closes, so nothing is written now. */
    simRunning: boolean;
    notes: string[];
  };
}

export type GuideKind = 'shipped' | 'drafted' | 'own';

/** Whose guide it is, as a request says it: the model is told how far to rely on it. */
const GUIDE_SOURCE: Record<GuideKind, string> = {
  shipped: "RigReady's binding guide for this aircraft",
  drafted: 'a binding guide an AI model drafted for this aircraft; no person checked it',
  own: 'a binding guide the player wrote or was given for this aircraft; RigReady did not check its advice',
};
const IRACING_GUIDE_SOURCE: Record<GuideKind, string> = {
  shipped: "RigReady's binding guide for this class of car; not reviewed by a racing driver",
  drafted: 'a binding guide an AI model drafted for this car; no person checked it',
  own: 'a binding guide the player wrote or was given for this car; RigReady did not check its advice',
};

export async function takeSnapshot(
  reader: BindingReader,
  aircraftId: string,
  pack: Pack | undefined
): Promise<Result<Snapshot>> {
  if (!reader.actions) {
    return err(
      'ai.unsupported',
      `RigReady cannot list the actions of ${reader.gameName} aircraft.`
    );
  }
  const [actions, bindings] = await Promise.all([
    reader.actions(aircraftId),
    reader.bindings(aircraftId),
  ]);
  if (!actions.ok) return actions;
  if (!bindings.ok) return bindings;
  const controllers = bindings.value.devices
    .filter(
      (d): d is BoundDevice & { guid: string } =>
        d.kind === 'controller' && d.connected && d.guid !== undefined && d.role !== 'none'
    )
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((d, i): ControllerRef => ({
      ref: `dev${i + 1}`,
      name: d.name.trim(),
      ...(d.givenName ? { givenName: d.givenName } : {}),
      guid: d.guid.toUpperCase(),
      role: d.role ?? 'other',
      connected: d.connected,
      controls: d.controls ?? { buttons: 0, hats: 0, axes: [] },
    }));
  return ok({
    game: 'dcs',
    aircraftId,
    aircraftName: bindings.value.aircraft.name,
    actions: actions.value,
    bindings: bindings.value,
    controllers,
    ...(pack ? { pack } : {}),
  });
}

/** What an action is bound to now, keyed by action id, in the request's own terms. */
function boundNow(snapshot: Snapshot): Map<string, string[]> {
  const refByGuid = new Map(snapshot.controllers.map((c) => [c.guid, c.ref]));
  const map = new Map<string, string[]>();
  for (const device of snapshot.bindings.devices) {
    const ref =
      device.kind === 'keyboard'
        ? 'keyboard'
        : device.guid
          ? refByGuid.get(device.guid.toUpperCase())
          : undefined;
    if (!ref) continue;
    for (const b of device.bindings) {
      const list = map.get(b.actionId) ?? [];
      list.push(`${ref}:${[...b.modifiers, b.input].join('+')}`);
      map.set(b.actionId, list);
    }
  }
  return map;
}

/** Keeps data on one line and within bounds, whatever a game file contains. */
export const oneLine = (text: string, max = 160): string =>
  text.replace(/[\r\n\t]+/g, ' ').slice(0, max);

/**
 * The large, stable part of a request: the aircraft, its guide and every action with what
 * it is bound to now. Cached by the API between requests. Data only; no paths, GUIDs,
 * serials or names the owner gave to things.
 */
export function contextText(snapshot: Snapshot): string {
  const lines: string[] = [];
  const iracing = snapshot.game === 'iracing';
  if (iracing) {
    lines.push(`<car>`);
    lines.push(
      `iRacing: ${oneLine(snapshot.aircraftName)}; the bindings for ${oneLine(snapshot.iracing?.setName ?? 'All cars')}`
    );
    lines.push(`</car>`);
  } else {
    lines.push(`<aircraft>`);
    lines.push(
      `DCS World aircraft: ${oneLine(snapshot.aircraftName)} (input profile ${oneLine(snapshot.aircraftId)})`
    );
    lines.push(`</aircraft>`);
  }
  if (snapshot.pack) {
    const source = (iracing ? IRACING_GUIDE_SOURCE : GUIDE_SOURCE)[snapshot.guideKind ?? 'shipped'];
    lines.push(`<guide source="${source}">`);
    lines.push(oneLine(snapshot.pack.summary, 800));
    for (const item of snapshot.pack.items) {
      lines.push(
        `- ${item.id} | tier ${item.tier} | belongs on ${item.place} (${item.role}) | ${oneLine(item.title)}: ${oneLine(item.what, 400)}`
      );
    }
    lines.push(`</guide>`);
  }
  const bound = boundNow(snapshot);
  // iRacing's own id is its name: one column is enough.
  lines.push(
    iracing
      ? `<actions columns="id | kind | writable | group | bound now">`
      : `<actions columns="id | kind | writable | category | name | bound now">`
  );
  for (const a of snapshot.actions) {
    if (iracing) {
      lines.push(
        [
          a.id,
          a.kind,
          a.editable ? 'yes' : 'no',
          oneLine(a.category.join('/'), 80),
          (bound.get(a.id) ?? []).join(', ') || '-',
        ].join(' | ')
      );
      continue;
    }
    lines.push(
      [
        a.id,
        a.kind,
        a.editable ? 'yes' : 'no',
        oneLine(a.category.join('/'), 80),
        oneLine(a.name),
        (bound.get(a.id) ?? []).join(', ') || '-',
      ].join(' | ')
    );
  }
  lines.push(`</actions>`);
  return lines.join('\n');
}

/** The user's controllers as sent: names, roles, control counts and axis names only. */
export function devicesText(snapshot: Snapshot): string {
  if (snapshot.game === 'iracing') {
    // iRacing's file names a controller and its inputs, not what the controller has.
    const lines = [`<devices columns="ref | DirectInput name">`];
    for (const c of snapshot.controllers) lines.push(`${c.ref} | ${oneLine(c.name, 100)}`);
    lines.push(`keyboard | Keyboard`);
    lines.push(`</devices>`);
    return lines.join('\n');
  }
  const lines = [`<devices columns="ref | DirectInput name | used as | buttons | hats | axes">`];
  for (const c of snapshot.controllers) {
    lines.push(
      [
        c.ref,
        oneLine(c.name, 100),
        c.role,
        c.controls.buttons,
        c.controls.hats,
        c.controls.axes.join(',') || '-',
      ].join(' | ')
    );
  }
  lines.push(`keyboard | Keyboard | keyboard | - | - | -`);
  lines.push(`</devices>`);
  return lines.join('\n');
}

/** "Stick (WINWING Orion ...) · Button 3" for showing a device input in the app. */
export function inputText(controller: ControllerRef | undefined, input: string): string {
  const label = describeInput(input)?.label ?? input;
  return controller ? `${controller.givenName ?? controller.name} · ${label}` : label;
}
