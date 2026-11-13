import * as yaml from 'js-yaml';
import { z } from 'zod';
import type { AircraftBindings, BoundAction, BoundInput } from '../../../core/bindings';
import { err, ok, type Result } from '../../../core/result';

/**
 * Binding guides ("knowledge packs"): for one aircraft, or one class of iRacing cars, every
 * important action in plain language, in priority tiers, with where it belongs and a plan per
 * kind of device. They are data files (packs/*.yaml, documented in packs/README.md) so anyone
 * can add one without writing code. They work without any AI key.
 */

/** The games a guide can be for. A file without `game` is for DCS, as every guide was before. */
export const GUIDE_GAMES = ['dcs', 'iracing'] as const;
export const GuideGameSchema = z.enum(GUIDE_GAMES);
export type GuideGame = z.infer<typeof GuideGameSchema>;

export const GUIDE_GAME_NAMES: Record<GuideGame, string> = { dcs: 'DCS World', iracing: 'iRacing' };

export const TIERS = ['must', 'should', 'nice'] as const;
export const TierSchema = z.enum(TIERS);
export type Tier = z.infer<typeof TierSchema>;

/** The DCS titles; `tierTitle` gives a game's own. */
export const TIER_TITLES: Record<Tier, string> = {
  must: 'Must have to fly and fight',
  should: 'Should have',
  nice: 'Nice to have',
};
const IRACING_TIER_TITLES: Record<Tier, string> = {
  ...TIER_TITLES,
  must: 'Must have to drive and race',
};
export const tierTitle = (game: GuideGame, tier: Tier): string =>
  (game === 'iracing' ? IRACING_TIER_TITLES : TIER_TITLES)[tier];

/** hotas is a DCS place, rim an iRacing one; panel and keyboard are both. */
export const PLACES = ['hotas', 'rim', 'panel', 'keyboard'] as const;
export const PlaceSchema = z.enum(PLACES);
export type Place = z.infer<typeof PlaceSchema>;

export const PLACE_TITLES: Record<Place, string> = {
  hotas: 'On the stick, throttle or pedals',
  rim: 'On the wheel, pedals or shifter',
  panel: 'On a panel or button box',
  keyboard: 'Fine on the keyboard',
};
export const placeTitle = (game: GuideGame, place: Place): string =>
  game === 'iracing' && place === 'panel' ? 'On a button box' : PLACE_TITLES[place];

/** stick, throttle and mfd are DCS roles, wheel and shifter iRacing ones. */
export const ROLES = [
  'stick',
  'throttle',
  'wheel',
  'pedals',
  'shifter',
  'mfd',
  'panel',
  'keyboard',
] as const;
export const RoleSchema = z.enum(ROLES);
export type PackRole = z.infer<typeof RoleSchema>;

export const ROLE_TITLES: Record<PackRole, string> = {
  stick: 'Stick',
  throttle: 'Throttle',
  wheel: 'Wheel rim',
  pedals: 'Pedals',
  shifter: 'Shifter and handbrake',
  mfd: 'MFD frames',
  panel: 'Panels and button boxes',
  keyboard: 'Keyboard',
};
export const roleTitle = (game: GuideGame, role: PackRole): string =>
  game === 'iracing' && role === 'panel' ? 'Button box' : ROLE_TITLES[role];

/** The places and roles each game's guides use, in the order a page shows them. */
export const GAME_PLACES: Record<GuideGame, readonly Place[]> = {
  dcs: ['hotas', 'panel', 'keyboard'],
  iracing: ['rim', 'panel', 'keyboard'],
};
export const GAME_ROLES: Record<GuideGame, readonly PackRole[]> = {
  dcs: ['stick', 'throttle', 'pedals', 'mfd', 'panel', 'keyboard'],
  iracing: ['wheel', 'pedals', 'shifter', 'panel', 'keyboard'],
};

const text = (max: number) => z.string().trim().min(1).max(max);

/**
 * What a pattern in a guide may be, whoever wrote the guide: shipped, drafted by AI, imported
 * or written by hand. A pattern is run as it is against every action name of an aircraft, so
 * it is kept quick to run: short, no group that repeats ("(a+)+"), "*", "+" or "{…}" at most
 * twice, and a guide holds a limited number of them. The shipped guides use far less.
 */
export const MAX_PATTERN = 100;
export const MAX_REPEATS = 2;
export const MAX_PATTERNS = 40;
const REPEATED_GROUP = /\)[*+{]/;
/** A pattern without its escaped characters, so "\+" is not counted as a repeat. */
const bare = (pattern: string): string => pattern.replace(/\\./g, '');

/** One action of an item: an exact DCS action name with a plain label, or a pattern. */
const ActionSpecSchema = z.union([
  z.strictObject({ name: text(200), label: text(120) }),
  z.strictObject({ re: text(MAX_PATTERN) }),
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
  /**
   * iRacing only: what the item's actions go on, where iRacing takes both (the throttle takes
   * an axis or a button). An axis is bound in iRacing itself; RigReady binds buttons and keys.
   */
  input: z.enum(['axis', 'button']).optional(),
  what: text(600),
  when: text(300),
  note: text(300).optional(),
  actions: z.array(ActionSpecSchema).min(1).max(40),
});
export type PackItem = z.infer<typeof PackItemSchema>;

/**
 * An iRacing guide names what it is for as `car` (a class such as "gt3", or one car's
 * folder); everything else reads it as `aircraft`, the name every guide had first.
 */
const carAsAircraft = (raw: unknown): unknown =>
  raw !== null &&
  typeof raw === 'object' &&
  !Array.isArray(raw) &&
  'car' in raw &&
  !('aircraft' in raw)
    ? (({ car, ...rest }: Record<string, unknown>) => ({ ...rest, aircraft: car }))(
        raw as Record<string, unknown>
      )
    : raw;

const PackObjectSchema = z
  .strictObject({
    format: z.literal(1),
    /** The game the guide is for; dcs when left out. */
    game: GuideGameSchema.default('dcs'),
    aircraft: z.strictObject({
      /**
       * DCS's input profile id (the Saved Games folder name): "FA-18C_hornet". For iRacing,
       * the class ("gt3") or "car:" and the car's folder name.
       */
      id: text(80),
      name: text(80),
      /**
       * Other input profiles the same guide is right for, word for word: the variants of
       * one aircraft whose controls DCS names the same ("Ka-50 III" next to "Ka-50").
       */
      also: z.array(text(80)).max(10).optional(),
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
    const patterns = pack.items.flatMap((i) => i.actions).filter((spec) => 're' in spec).length;
    if (patterns > MAX_PATTERNS) {
      ctx.addIssue({
        code: 'custom',
        message: `a guide may hold at most ${MAX_PATTERNS} patterns (this one has ${patterns})`,
      });
    }
    const places = GAME_PLACES[pack.game];
    const roles = GAME_ROLES[pack.game];
    for (const item of pack.items) {
      if (ids.has(item.id)) ctx.addIssue({ code: 'custom', message: `item ${item.id} twice` });
      ids.add(item.id);
      if (!places.includes(item.place)) {
        ctx.addIssue({
          code: 'custom',
          message: `item ${item.id}: place ${item.place} is not one of ${places.join(', ')}`,
        });
      }
      if (!roles.includes(item.role)) {
        ctx.addIssue({
          code: 'custom',
          message: `item ${item.id}: role ${item.role} is not one of ${roles.join(', ')}`,
        });
      }
      if (item.input !== undefined && pack.game !== 'iracing') {
        ctx.addIssue({ code: 'custom', message: `item ${item.id}: input is for iRacing guides` });
      }
      for (const spec of item.actions) {
        if (!('re' in spec)) continue;
        if (!safeRegExp(spec.re)) {
          ctx.addIssue({ code: 'custom', message: `item ${item.id}: bad pattern ${spec.re}` });
        } else if (REPEATED_GROUP.test(bare(spec.re))) {
          ctx.addIssue({
            code: 'custom',
            message: `item ${item.id}: a pattern may not repeat a group (${spec.re})`,
          });
        } else if ((bare(spec.re).match(/[*+{]/g) ?? []).length > MAX_REPEATS) {
          ctx.addIssue({
            code: 'custom',
            message: `item ${item.id}: a pattern may use *, + or {…} at most ${MAX_REPEATS} times (${spec.re})`,
          });
        }
      }
    }
    for (const [role, plan] of Object.entries(pack.roles)) {
      if (!roles.includes(role as PackRole)) {
        ctx.addIssue({
          code: 'custom',
          message: `roles.${role} is not one of ${roles.join(', ')}`,
        });
      }
      for (const id of plan?.items ?? []) {
        if (!ids.has(id)) {
          ctx.addIssue({ code: 'custom', message: `roles.${role} names unknown item ${id}` });
        }
      }
    }
  });
export const PackSchema = z.preprocess(carAsAircraft, PackObjectSchema);
export type Pack = z.infer<typeof PackObjectSchema>;

/**
 * The key a guide is found by: DCS's input profile id in lower case, or for another game the
 * game and the id ("iracing:gt3"). DCS ids are folder names, which never hold a colon.
 */
export const guideKey = (game: GuideGame, id: string): string =>
  game === 'dcs' ? id.toLowerCase() : `${game}:${id.toLowerCase()}`;

/** The game a guide key is for: "iracing:gt3" is iRacing, anything else DCS. */
export const gameOfKey = (key: string): GuideGame =>
  key.toLowerCase().startsWith('iracing:') ? 'iracing' : 'dcs';

/** The guide as a file: an iRacing guide says `car`, a DCS one has no `game` line, as before. */
export function packText(pack: Pack, head = ''): string {
  const { format, game, aircraft, ...rest } = pack;
  const shaped =
    game === 'dcs' ? { format, aircraft, ...rest } : { format, game, car: aircraft, ...rest };
  return `${head}${yaml.dump(shaped, { lineWidth: 100 })}`;
}

/** The plain label of every action a pack names exactly, by the game's own action name. */
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
    for (const id of [pack.value.aircraft.id, ...(pack.value.aircraft.also ?? [])]) {
      const key = guideKey(pack.value.game, id);
      if (packs.has(key)) throw new Error(`${file}: another binding guide is already for ${id}.`);
      packs.set(key, pack.value);
    }
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
  /** What the input is: a button, a hat direction, an axis or a key. */
  kind?: BoundInput['kind'];
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

export type ItemStatus = 'bound' | 'partial' | 'unbound' | 'inGame' | 'missing';

export interface ResolvedItem {
  item: PackItem;
  actions: ResolvedAction[];
  /**
   * bound: what the item needs is bound where it belongs (a controller, or anywhere for a
   * keyboard item); partial: some of it; unbound: none; inGame: none, and only the game itself
   * can bind it (an iRacing axis); missing: the game has none of its actions.
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
        kind: b.kind,
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
    const pattern = 're' in spec ? safeRegExp(spec.re) : undefined;
    const hits =
      'name' in spec
        ? actions.filter((a) => a.name === spec.name)
        : actions.filter((a) => pattern?.test(a.name));
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
    const resolved = matchActions(item, actions).map(({ action, label }): ResolvedAction => {
      // An iRacing item may say an action that takes both goes on an axis (the throttle):
      // that is bound in iRacing, never written by RigReady.
      const kind = item.input ?? action.kind;
      return {
        actionId: action.id,
        dcsName: action.name,
        label,
        kind,
        editable: action.editable && kind === action.kind,
        bound: index.get(action.id) ?? [],
      };
    });
    return { item, actions: resolved, status: itemStatus(item, resolved, pack.game) };
  });
}

export function itemStatus(
  item: PackItem,
  actions: ResolvedAction[],
  game: GuideGame = 'dcs'
): ItemStatus {
  if (actions.length === 0) return 'missing';
  // An item that goes on an axis (an iRacing pedal) is bound only by an axis: a throttle on a
  // button is not a throttle pedal set up.
  const counts = (a: ResolvedAction): boolean =>
    a.bound.some(
      (b) =>
        !b.ignored &&
        (item.place === 'keyboard' || !b.keyboard) &&
        (item.input !== 'axis' || b.kind === 'axis')
    );
  const bound = actions.filter(counts).length;
  if (bound === 0) {
    // In iRacing, what RigReady cannot bind is bound in iRacing's own Controls screen.
    return game === 'iracing' && !actions.some((a) => a.editable) ? 'inGame' : 'unbound';
  }
  if (item.need === 'any' || bound === actions.length) return 'bound';
  return 'partial';
}
