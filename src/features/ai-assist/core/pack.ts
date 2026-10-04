import * as yaml from 'js-yaml';
import { z } from 'zod';
import type { AircraftBindings, BoundAction } from '../../../core/bindings';
import { err, ok, type Result } from '../../../core/result';

/**
 * Binding guides ("knowledge packs"): for one aircraft, every important action in plain
 * language, in priority tiers, with where it belongs and a plan per kind of device. They
 * are data files (packs/*.yaml, documented in packs/README.md) so anyone can add an
 * aircraft without writing code. They work without any AI key.
 */

export const TIERS = ['must', 'should', 'nice'] as const;
export const TierSchema = z.enum(TIERS);
export type Tier = z.infer<typeof TierSchema>;

export const TIER_TITLES: Record<Tier, string> = {
  must: 'Must have to fly and fight',
  should: 'Should have',
  nice: 'Nice to have',
};

export const PLACES = ['hotas', 'panel', 'keyboard'] as const;
export const PlaceSchema = z.enum(PLACES);
export type Place = z.infer<typeof PlaceSchema>;

export const PLACE_TITLES: Record<Place, string> = {
  hotas: 'On the stick, throttle or pedals',
  panel: 'On a panel or button box',
  keyboard: 'Fine on the keyboard',
};

export const ROLES = ['stick', 'throttle', 'pedals', 'mfd', 'panel', 'keyboard'] as const;
export const RoleSchema = z.enum(ROLES);
export type PackRole = z.infer<typeof RoleSchema>;

export const ROLE_TITLES: Record<PackRole, string> = {
  stick: 'Stick',
  throttle: 'Throttle',
  pedals: 'Pedals',
  mfd: 'MFD frames',
  panel: 'Panels and button boxes',
  keyboard: 'Keyboard',
};

const text = (max: number) => z.string().trim().min(1).max(max);

/** One action of an item: an exact DCS action name with a plain label, or a pattern. */
const ActionSpecSchema = z.union([
  z.strictObject({ name: text(200), label: text(120) }),
  z.strictObject({ re: text(200) }),
]);
export type ActionSpec = z.infer<typeof ActionSpecSchema>;

export const PackItemSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/, 'lower-case letters, digits and dashes'),
  title: text(80),
  tier: TierSchema,
  place: PlaceSchema,
  role: RoleSchema,
  /** all: every action should be bound (the four trim directions); any: one is enough. */
  need: z.enum(['all', 'any']).default('all'),
  what: text(600),
  when: text(300),
  note: text(300).optional(),
  actions: z.array(ActionSpecSchema).min(1).max(40),
});
export type PackItem = z.infer<typeof PackItemSchema>;

export const PackSchema = z
  .strictObject({
    format: z.literal(1),
    aircraft: z.strictObject({
      /** DCS's input profile id (the Saved Games folder name): "FA-18C_hornet". */
      id: text(80),
      name: text(80),
    }),
    summary: text(800),
    /** Where the knowledge comes from, in plain words. */
    sources: z.array(text(600)).min(1),
    /** Set by RigReady on a guide an AI model drafted; never in a shipped pack. */
    drafted: z.strictObject({ by: text(80), at: text(40) }).optional(),
    roles: z.partialRecord(
      RoleSchema,
      z.strictObject({ summary: text(800), items: z.array(z.string()).max(60) })
    ),
    items: z.array(PackItemSchema).min(1).max(200),
  })
  .superRefine((pack, ctx) => {
    const ids = new Set<string>();
    for (const item of pack.items) {
      if (ids.has(item.id)) ctx.addIssue({ code: 'custom', message: `item ${item.id} twice` });
      ids.add(item.id);
      for (const spec of item.actions) {
        if ('re' in spec && !safeRegExp(spec.re)) {
          ctx.addIssue({ code: 'custom', message: `item ${item.id}: bad pattern ${spec.re}` });
        }
      }
    }
    for (const [role, plan] of Object.entries(pack.roles)) {
      for (const id of plan?.items ?? []) {
        if (!ids.has(id)) {
          ctx.addIssue({ code: 'custom', message: `roles.${role} names unknown item ${id}` });
        }
      }
    }
  });
export type Pack = z.infer<typeof PackSchema>;

/** The plain label of every action a pack names exactly, by DCS's own action name. */
export function plainLabels(pack: Pack | undefined): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const item of pack?.items ?? []) {
    for (const spec of item.actions) {
      if ('name' in spec) labels[spec.name] ??= spec.label;
    }
  }
  return labels;
}

function safeRegExp(source: string): RegExp | undefined {
  try {
    return new RegExp(source);
  } catch {
    // Not a valid pattern: the caller reports the pack line as wrong.
    return undefined;
  }
}

/** Reads one pack file. Anything that does not fit the format fails with what is wrong. */
export function parsePack(source: string, file = 'pack'): Result<Pack> {
  let raw: unknown;
  try {
    raw = yaml.load(source, { schema: yaml.JSON_SCHEMA });
  } catch (e) {
    return err('pack.yaml', `${file} is not valid YAML.`, e instanceof Error ? e.message : '');
  }
  const parsed = PackSchema.safeParse(raw);
  if (!parsed.success) {
    return err(
      'pack.invalid',
      `${file} is not a valid binding guide.`,
      z.prettifyError(parsed.error)
    );
  }
  return ok(parsed.data);
}

/** The shipped packs, keyed by aircraft id. A broken shipped file is a bug: it throws. */
export function shippedPacks(files: Record<string, string>): Map<string, Pack> {
  const packs = new Map<string, Pack>();
  for (const [file, source] of Object.entries(files)) {
    const pack = parsePack(source, file);
    if (!pack.ok) throw new Error(`${pack.error.message}\n${pack.error.detail ?? ''}`);
    packs.set(pack.value.aircraft.id.toLowerCase(), pack.value);
  }
  return packs;
}

// ---------------------------------------------------------------------------
// Matching a pack to the aircraft's actions and current bindings.
// ---------------------------------------------------------------------------

/** Where an action is bound now, in plain language. */
export interface CurrentBinding {
  device: string;
  deviceGuid?: string;
  keyboard: boolean;
  input: string;
  inputLabel: string;
  modifiers: string[];
  source: 'user' | 'default';
  /** On a device the user marked as not used in the game (a wheel's defaults): does not count. */
  ignored?: boolean;
}

export interface ResolvedAction {
  actionId: string;
  /** DCS's own name, always shown beside the plain label. */
  dcsName: string;
  label: string;
  kind: 'button' | 'axis';
  editable: boolean;
  bound: CurrentBinding[];
}

export type ItemStatus = 'bound' | 'partial' | 'unbound' | 'missing';

export interface ResolvedItem {
  item: PackItem;
  actions: ResolvedAction[];
  /**
   * bound: what the item needs is bound where it belongs (a controller, or anywhere for a
   * keyboard item); partial: some of it; unbound: none; missing: this DCS has none of its actions.
   */
  status: ItemStatus;
}

function bindingIndex(bindings: AircraftBindings): Map<string, CurrentBinding[]> {
  const index = new Map<string, CurrentBinding[]>();
  for (const device of bindings.devices) {
    if (device.kind !== 'controller' && device.kind !== 'keyboard') continue;
    for (const b of device.bindings) {
      const list = index.get(b.actionId) ?? [];
      list.push({
        device: device.givenName ?? device.name,
        ...(device.guid ? { deviceGuid: device.guid } : {}),
        keyboard: device.kind === 'keyboard',
        input: b.input,
        inputLabel: b.inputLabel,
        modifiers: b.modifiers,
        source: b.source,
        ...(device.role === 'none' ? { ignored: true } : {}),
      });
      index.set(b.actionId, list);
    }
  }
  return index;
}

/** The aircraft's actions an item names, in the item's order. */
export function matchActions(
  item: PackItem,
  actions: BoundAction[]
): { action: BoundAction; label: string }[] {
  const found: { action: BoundAction; label: string }[] = [];
  const seen = new Set<string>();
  for (const spec of item.actions) {
    const hits =
      'name' in spec
        ? actions.filter((a) => a.name === spec.name)
        : actions.filter((a) => safeRegExp(spec.re)?.test(a.name));
    for (const action of hits) {
      if (seen.has(action.id)) continue;
      seen.add(action.id);
      found.push({ action, label: 'label' in spec ? spec.label : action.name });
    }
  }
  return found;
}

export function resolvePack(
  pack: Pack,
  actions: BoundAction[],
  bindings: AircraftBindings
): ResolvedItem[] {
  const index = bindingIndex(bindings);
  return pack.items.map((item) => {
    const resolved = matchActions(item, actions).map(({ action, label }): ResolvedAction => ({
      actionId: action.id,
      dcsName: action.name,
      label,
      kind: action.kind,
      editable: action.editable,
      bound: index.get(action.id) ?? [],
    }));
    return { item, actions: resolved, status: itemStatus(item, resolved) };
  });
}

export function itemStatus(item: PackItem, actions: ResolvedAction[]): ItemStatus {
  if (actions.length === 0) return 'missing';
  const counts = (a: ResolvedAction): boolean =>
    a.bound.some((b) => !b.ignored && (item.place === 'keyboard' || !b.keyboard));
  const bound = actions.filter(counts).length;
  if (bound === 0) return 'unbound';
  if (item.need === 'any' || bound === actions.length) return 'bound';
  return 'partial';
}
