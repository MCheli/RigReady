import { formatLuaNumber } from '../../../core/lua/data';
import type { CheckItem, Profile } from '../../../core/profile/schema';
import { describeChange, OPTION_LABELS, type DcsOptions } from './options';

/**
 * Setups that follow "Use in DCS". A setup made earlier can expect options.lua as it was
 * before RigReady's screen setup was used: its "DCS graphics options" check then fails, and
 * its fix would put the old window back and undo the screen setup. These functions say which
 * items of a setup expect exactly the old values, and move them to the new ones. An item that
 * expects anything else is the user's own choice and is never touched.
 */

export const OPTIONS_CHECK = 'dcs.options';
export const SET_OPTIONS_FIX = 'dcs.setOptions';
export const MONITOR_CHECK = 'dcs.monitorSetup';

/** The options.lua keys "Use in DCS" sets that a setup's checks can expect. */
export const FOLLOWED_KEYS = ['multiMonitorSetup', 'width', 'height', 'fullScreen'] as const;
export type FollowedKey = (typeof FOLLOWED_KEYS)[number];
export type Followed = Pick<DcsOptions, FollowedKey>;

/** As options.lua compares: a monitor setup's name without regard to case. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase();
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9;
  return a === b;
}

/** The followed keys whose value is not the same before and after. */
export function changedKeys(before: DcsOptions, after: DcsOptions): FollowedKey[] {
  return FOLLOWED_KEYS.filter(
    (key) => after[key] !== undefined && !sameValue(before[key], after[key])
  );
}

/** One item of a setup moved to the new values, and what changes, in words. */
export interface ItemFollow {
  itemId: string;
  title: string;
  /** "width 7424 → 5120" */
  changes: string[];
  /** The item's fix changes too. */
  fix: boolean;
}

export interface SetupFollow {
  profile: Profile;
  items: ItemFollow[];
}

type Moved = { params: Record<string, unknown>; changes: string[] } | 'other';

/**
 * Params of an options check or of its fix: every changed key it names with the old value
 * takes the new one. 'other' when it names a changed key with a value that is neither.
 */
function moveOptions(
  params: Record<string, unknown>,
  keys: FollowedKey[],
  before: DcsOptions,
  after: DcsOptions
): Moved {
  const next = { ...params };
  const changes: string[] = [];
  for (const key of keys) {
    const value = params[key];
    if (value === undefined || sameValue(value, after[key])) continue;
    if (!sameValue(value, before[key])) return 'other';
    next[key] = after[key];
    changes.push(describeChange({ key, before: before[key], after: after[key]! }));
  }
  return { params: next, changes };
}

const size = (width: unknown, height: unknown): string =>
  `${formatLuaNumber(Number(width))} × ${formatLuaNumber(Number(height))}`;

/** Params of a monitor setup check: `setup` follows the monitor setup key, `window` the size. */
function moveMonitor(
  params: Record<string, unknown>,
  keys: FollowedKey[],
  before: DcsOptions,
  after: DcsOptions
): Moved {
  const next = { ...params };
  const changes: string[] = [];
  const setup = params['setup'];
  if (typeof setup === 'string' && keys.includes('multiMonitorSetup')) {
    if (!sameValue(setup, after.multiMonitorSetup)) {
      if (!sameValue(setup, before.multiMonitorSetup)) return 'other';
      next['setup'] = after.multiMonitorSetup;
      changes.push(
        describeChange({
          key: 'multiMonitorSetup',
          before: before.multiMonitorSetup,
          after: after.multiMonitorSetup!,
        })
      );
    }
  }
  const window = params['window'] as { width?: unknown; height?: unknown } | undefined;
  if (window && (keys.includes('width') || keys.includes('height'))) {
    const isAfter = sameValue(window.width, after.width) && sameValue(window.height, after.height);
    if (!isAfter) {
      const isBefore =
        sameValue(window.width, before.width) && sameValue(window.height, before.height);
      if (!isBefore || after.width === undefined || after.height === undefined) return 'other';
      next['window'] = { width: after.width, height: after.height };
      changes.push(
        `window ${size(window.width, window.height)} → ${size(after.width, after.height)}`
      );
    }
  }
  return { params: next, changes };
}

/** The item moved to the new values, or undefined when it expects nothing that changed, or something else. */
export function followItem(
  item: CheckItem,
  before: DcsOptions,
  after: DcsOptions
): { item: CheckItem; follow: ItemFollow } | undefined {
  const keys = changedKeys(before, after);
  if (keys.length === 0) return undefined;
  let check: Moved;
  let fix: Moved | undefined;
  if (item.type === OPTIONS_CHECK) {
    check = moveOptions(item.params, keys, before, after);
    if (item.remediation?.type === SET_OPTIONS_FIX) {
      fix = moveOptions(item.remediation.params, keys, before, after);
    }
  } else if (item.type === MONITOR_CHECK) {
    check = moveMonitor(item.params, keys, before, after);
  } else {
    return undefined;
  }
  // The check and its fix are one item: both expect the old values, or it is left alone.
  if (check === 'other' || fix === 'other') return undefined;
  const fixChanges = fix?.changes ?? [];
  if (check.changes.length === 0 && fixChanges.length === 0) return undefined;
  return {
    item: {
      ...item,
      params: check.params,
      ...(item.remediation && fix && fixChanges.length
        ? { remediation: { ...item.remediation, params: fix.params } }
        : {}),
    },
    follow: {
      itemId: item.id,
      title: item.title,
      changes: [...new Set([...check.changes, ...fixChanges])],
      fix: fixChanges.length > 0,
    },
  };
}

/** The setup with every item that expects exactly the old values moved; undefined when none does. */
export function followSetup(
  profile: Profile,
  before: DcsOptions,
  after: DcsOptions
): SetupFollow | undefined {
  const items: ItemFollow[] = [];
  const checks = profile.checks.map((item) => {
    const moved = followItem(item, before, after);
    if (!moved) return item;
    items.push(moved.follow);
    return moved.item;
  });
  return items.length ? { profile: { ...profile, checks }, items } : undefined;
}

/**
 * The fix of an options check, after the check was moved from `before` to `after` by hand
 * (the Play screen's "Update the setup"): the keys the fix sets to the old value take the new
 * one, and nothing else changes. Undefined when nothing does.
 */
export function followFix(
  fix: Record<string, unknown>,
  before: Record<string, unknown>,
  after: Record<string, unknown>
): Record<string, unknown> | undefined {
  const next = { ...fix };
  let changed = false;
  for (const key of FOLLOWED_KEYS) {
    if (sameValue(before[key], after[key]) || after[key] === undefined) continue;
    if (fix[key] !== undefined && sameValue(fix[key], before[key])) {
      next[key] = after[key];
      changed = true;
    }
  }
  return changed ? next : undefined;
}

/** "width 5120 and height 2464", "monitor setup "rigready"" */
export function valuesPhrase(values: Followed): string {
  const parts = FOLLOWED_KEYS.filter((key) => values[key] !== undefined).map((key) => {
    const value = values[key];
    const shown =
      typeof value === 'string'
        ? `"${value}"`
        : typeof value === 'boolean'
          ? value
            ? 'on'
            : 'off'
          : formatLuaNumber(Number(value));
    return `${OPTION_LABELS[key]} ${shown}`;
  });
  return parts.length <= 1
    ? (parts[0] ?? '')
    : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
