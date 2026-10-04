import { z } from 'zod';
import type { AircraftBindings, BoundDevice } from '../../../core/bindings';
import type { InputDevice } from '../../../shared/models';
import { categorize, CATEGORY_IDS, shortAction, type CategoryId } from './categories';
import { appendUnplaced, generateLayout, shapeFromControls, type DeviceShape } from './generate';
import {
  compareControlIds,
  controlIdOf,
  controlName,
  DeviceLayoutSchema,
  HAT_ARROWS,
  modelKey,
  placedControls,
  type CrossPosition,
  type DeviceLayout,
} from './layout';

/**
 * The cheat sheet of one aircraft: every controller with its picture (layout) and what
 * each control does. Built from the game's effective bindings (core's BindingReader),
 * what the attached controllers say about themselves, the layouts and the user's notes.
 * This is the one model the screen, the PDF and the kneeboard pages are drawn from.
 */

export const SheetBindingSchema = z.object({
  actionId: z.string(),
  /** The game's plain-language name: "Weapon Release Button". */
  action: z.string(),
  /** A shorter wording for small labels. */
  short: z.string(),
  /** Held with the control, in plain language. Empty for the plain press. */
  modifiers: z.array(z.string()),
  category: z.array(z.string()),
  kind: z.enum(CATEGORY_IDS),
  source: z.enum(['user', 'default']),
  /** The same action is also on these controls ("Button 36", "Throttle: Button 25"). */
  alsoOn: z.array(z.string()),
});
export type SheetBinding = z.infer<typeof SheetBindingSchema>;

export const SheetControlSchema = z.object({
  /** button:12, axis:X, hat:1:U */
  id: z.string(),
  /** "Button 12" */
  name: z.string(),
  bindings: z.array(SheetBindingSchema),
  /** Several actions fire on the same press (same modifiers): usually a mistake. */
  conflict: z.boolean(),
  /** The user's own words for this control: "weapon release - hold". */
  note: z.string().optional(),
});
export type SheetControl = z.infer<typeof SheetControlSchema>;

export const LayoutSourceSchema = z.enum(['user', 'builtin', 'generated']);
export type LayoutSource = z.infer<typeof LayoutSourceSchema>;

export const SheetDeviceSchema = z.object({
  /** Stable for this device model on this rig: "4098:BEE1", "4098:BEE1#2" for a second one. */
  key: z.string(),
  guid: z.string().optional(),
  /** What the hardware calls itself. */
  name: z.string(),
  /** The name the owner gave it. */
  givenName: z.string().optional(),
  /** What to call it on the sheet: the given name, else the hardware name. */
  title: z.string(),
  vendorId: z.string().optional(),
  productId: z.string().optional(),
  connected: z.boolean(),
  /** What the controller reports about itself; absent when it is not attached. */
  reports: z
    .object({ buttons: z.number(), axes: z.array(z.string()), hats: z.number() })
    .optional(),
  layout: DeviceLayoutSchema,
  layoutSource: LayoutSourceSchema,
  /** Why the user's own layout was not used, when it could not be. */
  layoutProblem: z.string().optional(),
  /** Controls with something to say: a binding or a note. Every other control is empty. */
  controls: z.array(SheetControlSchema),
  /** Bindings on inputs that have no place on a controller picture, by the game's name. */
  other: z.array(z.object({ input: z.string(), label: z.string(), action: z.string() })),
  counts: z.object({
    /** Controls on the picture. */
    placed: z.number(),
    bound: z.number(),
    empty: z.number(),
    conflicts: z.number(),
    /** Buttons the device reports that the layout leaves out (none of them bound). */
    hidden: z.number(),
  }),
  /** The page where these bindings are edited. */
  route: z.string(),
});
export type SheetDevice = z.infer<typeof SheetDeviceSchema>;

export const SheetSchema = z.object({
  game: z.string(),
  gameName: z.string(),
  aircraft: z.object({ id: z.string(), name: z.string(), hasUserBindings: z.boolean() }),
  devices: z.array(SheetDeviceSchema),
});
export type Sheet = z.infer<typeof SheetSchema>;

/** Notes by device key, then control id. */
export type DeviceNotes = Record<string, Record<string, string>>;

export interface LayoutChoice {
  /** Absent when there is none to offer (a layout is generated) but there is something to say. */
  layout?: DeviceLayout;
  source: LayoutSource;
  problem?: string;
}

export interface SheetInputs {
  game: string;
  gameName: string;
  bindings: AircraftBindings;
  /** The controllers attached now. */
  controllers: InputDevice[];
  /** The layout for a device model: the user's, a shipped one, or none (then one is generated). */
  layoutFor(shape: DeviceShape): LayoutChoice | undefined;
  notes: DeviceNotes;
  /** The name the owner gave a device, when the game's reader did not say. */
  nameOf?(device: { vendorId: string; productId: string; guid?: string }): string | undefined;
  route(guid: string | undefined): string;
}

const sameGuid = (a: string | undefined, b: string | undefined): boolean =>
  a !== undefined && b !== undefined && a.toUpperCase() === b.toUpperCase();

/** "WINWING Orion Joystick Base 2 + JGRIP-F16" reads better without the shouting. */
export function tidyName(name: string): string {
  return name
    .replace(/\s+/g, ' ')
    .replace(/^WINWING\b/, 'WinWing')
    .trim();
}

/** Keys for the devices of a sheet: the model, numbered when the rig has several of it. */
export function deviceKeys(
  devices: Pick<BoundDevice, 'vendorId' | 'productId' | 'guid' | 'name'>[]
) {
  const base = devices.map((d) =>
    d.vendorId && d.productId ? modelKey(d.vendorId, d.productId) : `name:${d.name.trim()}`
  );
  const seen = new Map<string, number>();
  // Identical devices are numbered in GUID order, so the numbers do not depend on list order.
  const order = devices
    .map((d, i) => ({ i, guid: (d.guid ?? '').toUpperCase() }))
    .sort((a, b) => a.guid.localeCompare(b.guid) || a.i - b.i);
  const keys = new Array<string>(devices.length);
  for (const { i } of order) {
    const n = (seen.get(base[i]!) ?? 0) + 1;
    seen.set(base[i]!, n);
    keys[i] = n === 1 ? base[i]! : `${base[i]}#${n}`;
  }
  return keys;
}

export function buildSheet(inputs: SheetInputs): Sheet {
  const bound = inputs.bindings.devices.filter((d) => d.kind === 'controller');
  // A controller the game's reader did not list (it has nothing for it) still gets a sheet.
  const extra: BoundDevice[] = inputs.controllers
    .filter((c) => !bound.some((d) => sameGuid(d.guid, c.guid)))
    .map((c) => ({
      kind: 'controller',
      name: c.name,
      guid: c.guid.toUpperCase(),
      ...(c.vendorId ? { vendorId: c.vendorId } : {}),
      ...(c.productId ? { productId: c.productId } : {}),
      connected: true,
      bindings: [],
    }));
  const all = [...bound, ...extra].filter((d) => d.connected || d.bindings.length > 0);
  const keys = deviceKeys(all);

  const titles = all.map((device) => {
    const given =
      device.givenName ??
      (device.vendorId && device.productId
        ? inputs.nameOf?.({
            vendorId: device.vendorId,
            productId: device.productId,
            ...(device.guid ? { guid: device.guid } : {}),
          })
        : undefined);
    return { given, title: given ?? tidyName(device.name) };
  });

  // Where every action is, across the whole rig, to say "also on ...".
  const places = new Map<string, { device: number; control: string }[]>();
  all.forEach((device, index) => {
    for (const binding of device.bindings) {
      const id = controlIdOf(binding.input);
      if (!id) continue;
      const list = places.get(binding.actionId) ?? [];
      if (!list.some((p) => p.device === index && p.control === id)) {
        list.push({ device: index, control: id });
      }
      places.set(binding.actionId, list);
    }
  });

  const devices = all.map((device, index): SheetDevice => {
    const controller = inputs.controllers.find((c) => sameGuid(c.guid, device.guid));
    const controls = new Map<string, SheetControl>();
    const other: SheetDevice['other'] = [];
    const control = (id: string): SheetControl => {
      let entry = controls.get(id);
      if (!entry) {
        entry = { id, name: controlName(id), bindings: [], conflict: false };
        controls.set(id, entry);
      }
      return entry;
    };
    for (const binding of device.bindings) {
      const id = controlIdOf(binding.input);
      if (!id) {
        other.push({ input: binding.input, label: binding.inputLabel, action: binding.action });
        continue;
      }
      const alsoOn = (places.get(binding.actionId) ?? [])
        .filter((p) => !(p.device === index && p.control === id))
        .map((p) =>
          p.device === index
            ? controlName(p.control)
            : `${titles[p.device]!.title}: ${controlName(p.control)}`
        );
      control(id).bindings.push({
        actionId: binding.actionId,
        action: binding.action,
        short: shortAction(binding.action),
        modifiers: binding.modifiers,
        category: binding.category,
        kind: categorize(binding.action, binding.category),
        source: binding.source,
        alsoOn,
      });
    }
    for (const entry of controls.values()) {
      const together = new Map<string, number>();
      for (const binding of entry.bindings) {
        const key = [...binding.modifiers].sort().join('+');
        together.set(key, (together.get(key) ?? 0) + 1);
      }
      entry.conflict = [...together.values()].some((n) => n > 1);
      // The plain press first, then the modifier variants.
      entry.bindings.sort((a, b) => a.modifiers.length - b.modifiers.length);
    }
    const key = keys[index]!;
    for (const [id, note] of Object.entries(inputs.notes[key] ?? {})) {
      if (note.trim()) control(id).note = note.trim();
    }

    const shape: DeviceShape = controller
      ? {
          name: tidyName(device.name),
          vendorId: controller.vendorId || device.vendorId || '0000',
          productId: controller.productId || device.productId || '0000',
          buttons: controller.numButtons,
          axes: controller.axisNames,
          hats: controller.numHats,
        }
      : shapeFromControls(
          {
            name: tidyName(device.name),
            ...(device.vendorId ? { vendorId: device.vendorId } : {}),
            ...(device.productId ? { productId: device.productId } : {}),
          },
          controls.keys()
        );
    const chosen = inputs.layoutFor(shape);
    const base = chosen?.layout ?? generateLayout(shape);
    // Nothing that does something is ever left off the picture.
    const active = [...controls.values()]
      .filter((c) => c.bindings.length > 0 || c.note)
      .map((c) => c.id);
    const layout = appendUnplaced(base, active);
    const placed = placedControls(layout);

    const list = [...controls.values()].sort((a, b) => compareControlIds(a.id, b.id));
    const boundCount = [...placed].filter(
      (id) => (controls.get(id)?.bindings.length ?? 0) > 0
    ).length;
    let hidden = 0;
    for (let n = 1; n <= shape.buttons; n++) if (!placed.has(`button:${n}`)) hidden++;

    return {
      key,
      ...(device.guid ? { guid: device.guid.toUpperCase() } : {}),
      name: device.name.trim(),
      ...(titles[index]!.given ? { givenName: titles[index]!.given } : {}),
      title: titles[index]!.title,
      ...(device.vendorId ? { vendorId: device.vendorId } : {}),
      ...(device.productId ? { productId: device.productId } : {}),
      connected: device.connected,
      ...(controller
        ? {
            reports: {
              buttons: controller.numButtons,
              axes: controller.axisNames,
              hats: controller.numHats,
            },
          }
        : {}),
      layout,
      layoutSource: chosen?.layout ? chosen.source : 'generated',
      ...(chosen?.problem ? { layoutProblem: chosen.problem } : {}),
      controls: list,
      other,
      counts: {
        placed: placed.size,
        bound: boundCount,
        empty: placed.size - boundCount,
        conflicts: list.filter((c) => c.conflict).length,
        hidden,
      },
      route: inputs.route(device.guid),
    };
  });

  // What the hands are on first (stick, throttle, pedals: the user's bindings and a flight
  // or engine axis), busiest first; then the other devices the user bound something on,
  // then those with only the game's defaults, then the bare ones, in the game's order.
  const rank = (device: SheetDevice): number => {
    const own = device.controls.some((c) => c.bindings.some((b) => b.source === 'user'));
    if (!own) return device.counts.bound > 0 ? 1 : 0;
    const flown = device.controls.some(
      (c) =>
        c.id.startsWith('axis:') &&
        c.bindings.some((b) => b.kind === 'flight' || b.kind === 'engine')
    );
    return flown ? 3 : 2;
  };
  devices.sort(
    (a, b) => rank(b) - rank(a) || (rank(a) === 3 ? b.counts.bound - a.counts.bound : 0)
  );

  return {
    game: inputs.game,
    gameName: inputs.gameName,
    aircraft: inputs.bindings.aircraft,
    devices,
  };
}

/** What is printed on the device at a control, from the layout: "OSB 6", "TRIM hat ↑". */
export function physicalLabels(layout: DeviceLayout): Map<string, string> {
  const labels = new Map<string, string>();
  for (const control of layout.controls) {
    if (control.kind === 'cross') {
      for (const [position, id] of Object.entries(control.inputs) as [CrossPosition, string][]) {
        labels.set(id, `${control.label ?? 'Switch'} ${HAT_ARROWS[position]}`);
      }
    } else if (control.label) {
      labels.set(control.input, control.label);
    }
  }
  // A control in a labelled frame carries the frame's name: "FLAP: AUTO".
  for (const control of layout.controls) {
    if (control.kind === 'cross') continue;
    const cx = control.x + control.w / 2;
    const cy = control.y + control.h / 2;
    const group = layout.groups.find(
      (g) => cx >= g.x && cx <= g.x + g.w && cy >= g.y && cy <= g.y + g.h
    );
    if (!group || /^(more controls|other|buttons?|axes|hats?)\b/i.test(group.label)) continue;
    const own = labels.get(control.input);
    labels.set(control.input, own ? `${group.label} ${own}` : group.label);
  }
  return labels;
}

export interface ActionPlace {
  deviceKey: string;
  device: string;
  control: string;
  /** "Button 20" */
  controlName: string;
  /** "Weapon release", when the layout names the control. */
  physical?: string;
  modifiers: string[];
  note?: string;
}

export interface ActionEntry {
  actionId: string;
  action: string;
  kind: CategoryId;
  category: string[];
  source: 'user' | 'default';
  places: ActionPlace[];
}

/** "I want to do X: which control?" Every bound action with where it is, by name. */
export function actionIndex(sheet: Sheet, deviceKeys?: string[]): ActionEntry[] {
  const entries = new Map<string, ActionEntry>();
  for (const device of sheet.devices) {
    if (deviceKeys && !deviceKeys.includes(device.key)) continue;
    const physical = physicalLabels(device.layout);
    for (const control of device.controls) {
      for (const binding of control.bindings) {
        let entry = entries.get(binding.actionId);
        if (!entry) {
          entry = {
            actionId: binding.actionId,
            action: binding.action,
            kind: binding.kind,
            category: binding.category,
            source: binding.source,
            places: [],
          };
          entries.set(binding.actionId, entry);
        }
        if (binding.source === 'user') entry.source = 'user';
        const label = physical.get(control.id);
        entry.places.push({
          deviceKey: device.key,
          device: device.title,
          control: control.id,
          controlName: control.name,
          ...(label ? { physical: label } : {}),
          modifiers: binding.modifiers,
          ...(control.note ? { note: control.note } : {}),
        });
      }
    }
  }
  return [...entries.values()].sort((a, b) => a.action.localeCompare(b.action));
}

/** The kinds of action that matter most in the air, in the order a summary lists them. */
const SUMMARY_KINDS: CategoryId[] = [
  'weapons',
  'sensors',
  'countermeasures',
  'flight',
  'comms',
  'airframe',
  'engine',
];

/**
 * The most important actions for a one-page summary: the user's own bindings of the
 * kinds used in flight, hands-on controls (stick, throttle, pedals: devices with axes
 * bound to flight controls) before panels.
 */
export function summaryActions(sheet: Sheet, lines = 44): ActionEntry[] {
  const handsOn = new Set(
    sheet.devices
      .filter((d) =>
        d.controls.some(
          (c) =>
            c.id.startsWith('axis:') &&
            c.bindings.some((b) => b.kind === 'flight' || b.kind === 'engine')
        )
      )
      .map((d) => d.key)
  );
  const score = (entry: ActionEntry): number => {
    const kind = SUMMARY_KINDS.indexOf(entry.kind);
    const hotas = entry.category.some((c) => /hotas/i.test(c)) ? 0 : 1;
    const hands = entry.places.some((p) => handsOn.has(p.deviceKey)) ? 0 : 1;
    return hands * 100 + hotas * 20 + (kind < 0 ? 15 : kind);
  };
  const ranked = actionIndex(sheet)
    .filter(
      (entry) => entry.source === 'user' && entry.kind !== 'displays' && entry.kind !== 'view'
    )
    .map((entry) => ({ entry, score: score(entry) }))
    .sort((a, b) => a.score - b.score || a.entry.action.localeCompare(b.entry.action));
  // The page holds so many lines; an action on several controls takes one line per control.
  const chosen: ActionEntry[] = [];
  let used = 0;
  for (const { entry } of ranked) {
    const needs = Math.max(1, entry.places.length);
    if (used + needs > lines) break;
    chosen.push(entry);
    used += needs;
  }
  return chosen.sort(
    (a, b) => orderOf(a.kind) - orderOf(b.kind) || a.action.localeCompare(b.action)
  );
}

const orderOf = (kind: CategoryId): number => {
  const at = SUMMARY_KINDS.indexOf(kind);
  return at < 0 ? SUMMARY_KINDS.length : at;
};

/** A short stable fingerprint of text (FNV-1a, two passes): for "did anything change", not for security. */
export function fingerprintOf(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193);
    b = Math.imul(b ^ ((code << 5) | (code >>> 3)), 0x811c9dc5) + i;
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

/**
 * What a device's page shows, as a fingerprint: its name, its layout, every binding and
 * note. Two sheets with the same fingerprint print the same page.
 */
export function deviceFingerprint(device: SheetDevice): string {
  return fingerprintOf(
    JSON.stringify([
      device.title,
      device.layout,
      device.controls.map((c) => [
        c.id,
        c.note ?? '',
        c.bindings.map((b) => [b.actionId, b.action, b.modifiers, b.kind]),
      ]),
    ])
  );
}
