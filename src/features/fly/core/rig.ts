import { z } from 'zod';
import { matchMonitors } from '../../../core/displays/identity';
import type { MainContext } from '../../../core/feature';
import type { Profile } from '../../../core/profile/schema';
import { DisplayTargetSchema, type DisplayInfo, type DisplayTarget } from '../../../shared/models';
import type { RigGlance } from '../contract';

/**
 * The rig at a glance: the monitors as they are now, each with what is different from what
 * the setup expects of it. Read through the display port; the checklist row stays the word
 * on whether the arrangement is right, this only says where to look.
 */

type Ctx = Pick<MainContext, 'ports' | 'checks' | 'layouts' | 'names'>;

/**
 * The arrangement a setup's monitor item holds: a saved layout by its id, or the
 * arrangement as it was captured. Read by its shape, whatever check type keeps it.
 */
const ArrangementSchema = z.object({
  layoutId: z.string().optional(),
  displays: z.array(DisplayTargetSchema).min(1),
});

/** A name per monitor: the owner's, or the monitor's own, numbered when several share it. */
export function monitorNames(
  monitors: { id: string; name: string }[],
  given: Record<string, string> = {}
): Map<string, string> {
  const totals = new Map<string, number>();
  for (const m of monitors) totals.set(m.name, (totals.get(m.name) ?? 0) + 1);
  const seen = new Map<string, number>();
  const labels = new Map<string, string>();
  for (const m of monitors) {
    const n = (seen.get(m.name) ?? 0) + 1;
    seen.set(m.name, n);
    const total = totals.get(m.name) ?? 1;
    const base = m.name || 'Monitor';
    labels.set(
      m.id.toLowerCase(),
      given[m.id.toLowerCase()]?.trim() || (total > 1 ? `${base} (${n} of ${total})` : base)
    );
  }
  return labels;
}

export interface MonitorIssues {
  /** By the id of the connected monitor: what is different, in a few words. */
  issues: Map<string, string>;
  /** By the id of the connected monitor: the name the setup knows it by. */
  labels: Map<string, string>;
  /** Monitors the setup wants on that are not connected, by name. */
  missing: string[];
}

/** What is different about each connected monitor, compared with the arrangement a setup expects. */
export function monitorIssues(
  expected: DisplayTarget[],
  actual: DisplayInfo[],
  given: Record<string, string> = {}
): MonitorIssues {
  const names = monitorNames(expected, given);
  const matches = matchMonitors(expected, actual);
  const on = matches.filter((m) => m.expected.enabled && m.actual);
  // Positions are relative to the main display, which Windows puts at 0,0.
  const main =
    on.find((m) => m.expected.primary) ??
    on.find((m) => m.expected.x === 0 && m.expected.y === 0) ??
    on[0];
  const dx = main?.expected.x ?? 0;
  const dy = main?.expected.y ?? 0;
  const issues = new Map<string, string>();
  const labels = new Map<string, string>();
  const missing: string[] = [];
  for (const match of matches) {
    const want = match.expected;
    const have = match.actual;
    const name = names.get(want.id.toLowerCase()) ?? want.name;
    if (!have) {
      // Not connected is as good as off.
      if (want.enabled) missing.push(name);
      continue;
    }
    labels.set(have.id, name);
    const issue = !want.enabled
      ? have.enabled
        ? 'on, expected off'
        : undefined
      : !have.enabled
        ? 'off, expected on'
        : have.rotation !== want.rotation
          ? `rotated ${have.rotation}°, expected ${want.rotation}°`
          : want.width !== undefined &&
              want.height !== undefined &&
              (have.width !== want.width || have.height !== want.height)
            ? `${have.width}x${have.height}, expected ${want.width}x${want.height}`
            : have.x !== want.x - dx || have.y !== want.y - dy
              ? 'not where the setup expects it'
              : match === main && !have.primary
                ? 'not the main display'
                : undefined;
    if (issue) issues.set(have.id, issue);
  }
  return { issues, labels, missing };
}

/** The setup's monitor item and the arrangement it expects, when it has one. */
async function expectedOf(
  ctx: Ctx,
  profile: Profile
): Promise<{ itemId: string; targets: DisplayTarget[] } | undefined> {
  for (const item of profile.checks) {
    if (item.disabled || ctx.checks.check(item.type)?.group !== 'displays') continue;
    const arrangement = ArrangementSchema.safeParse(item.params);
    if (!arrangement.success) continue;
    if (arrangement.data.layoutId) {
      // A saved layout is what counts while it exists; the copy in the setup otherwise.
      const saved = await ctx.layouts.get(arrangement.data.layoutId);
      if (saved.ok) return { itemId: item.id, targets: saved.value.displays };
    }
    return { itemId: item.id, targets: arrangement.data.displays };
  }
  return undefined;
}

export async function rigGlance(ctx: Ctx, profile: Profile): Promise<RigGlance> {
  const layout = await ctx.ports.displays.read();
  if (!layout.ok) return { monitors: [], missing: [], error: layout.error.message };
  const given = await ctx.names.monitors();
  const expected = await expectedOf(ctx, profile);
  const own = monitorNames(layout.value.displays, given);
  const compared = expected
    ? monitorIssues(expected.targets, layout.value.displays, given)
    : { issues: new Map<string, string>(), labels: new Map<string, string>(), missing: [] };
  return {
    monitors: layout.value.displays.map((d) => {
      const issue = compared.issues.get(d.id);
      return {
        id: d.id,
        label: compared.labels.get(d.id) ?? own.get(d.id.toLowerCase()) ?? 'Monitor',
        x: d.x,
        y: d.y,
        width: d.width,
        height: d.height,
        rotation: d.rotation,
        enabled: d.enabled,
        primary: d.primary,
        ...(issue ? { issue } : {}),
      };
    }),
    missing: compared.missing,
    ...(expected ? { itemId: expected.itemId } : {}),
  };
}
