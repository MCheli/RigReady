import { z } from 'zod';
import type {
  CaptureDefinition,
  CheckDefinition,
  CheckOutcome,
  NewCheckItem,
  RemediationDefinition,
} from '../../../core/checks/registry';
import { layoutToTargets, type DisplayLayoutStore } from '../../../core/displays/layouts';
import { err, ok, type Result } from '../../../core/result';
import type { DisplayInfo, DisplayTarget } from '../../../shared/models';
import type { LayoutApplier } from './applier';
import { monitorLabels, type MonitorNames } from './labels';
import { analyzeLayout, joinNames, LayoutTargetSchema, type LayoutTarget } from './plan';

export const DISPLAY_LAYOUT = 'display.layout';
export const DISPLAY_APPLY = 'display.applyLayout';

/**
 * A setup's monitor check. `displays` is the arrangement as it was captured; when the
 * check names a saved layout (`layoutId`), that layout is what counts, so changing the
 * saved "Flying" layout changes every setup that uses it. The copy in `displays` is used
 * only if the saved layout has been deleted.
 */
export const LayoutParamsSchema = z.object({
  layoutId: z.string().optional(),
  /** The saved layout's name when the setup was made, for the fix label. */
  layoutName: z.string().optional(),
  displays: z.array(LayoutTargetSchema).min(1),
});
export type LayoutParams = z.infer<typeof LayoutParamsSchema>;

export interface LayoutDeps {
  /** Friendly monitor names; never fails (no names is fine). */
  names(): Promise<MonitorNames>;
  layouts: Pick<DisplayLayoutStore, 'get' | 'list'>;
}

interface Expected {
  displays: LayoutTarget[];
  name?: string;
  note?: string;
}

async function expectedFor(params: LayoutParams, deps: LayoutDeps): Promise<Expected> {
  if (!params.layoutId) return { displays: params.displays };
  const saved = await deps.layouts.get(params.layoutId);
  if (saved.ok) return { displays: saved.value.displays, name: saved.value.name };
  const name = params.layoutName ?? params.layoutId;
  return {
    displays: params.displays,
    name,
    note: `The saved layout "${name}" no longer exists; compared with the copy kept in this setup.`,
  };
}

const monitors = (n: number): string => `${n} ${n === 1 ? 'monitor' : 'monitors'}`;

export function createLayoutCheck(deps: LayoutDeps): CheckDefinition<LayoutParams> {
  return {
    type: DISPLAY_LAYOUT,
    group: 'displays',
    label: 'Monitor layout',
    params: LayoutParamsSchema,
    async run(params, ctx): Promise<CheckOutcome> {
      const layout = await ctx.ports.displays.read();
      if (!layout.ok) return { pass: false, summary: layout.error.message };
      const expected = await expectedFor(params, deps);
      const analysis = analyzeLayout(expected.displays, layout.value.displays, await deps.names());
      const notes = expected.note ? [expected.note] : [];
      const { differences } = analysis;
      if (differences.length === 0) {
        const summary = expected.name
          ? `Arranged as "${expected.name}" (${monitors(analysis.enabledCount)} on)`
          : `${monitors(analysis.enabledCount)} arranged as expected`;
        return notes.length ? { pass: true, summary, details: notes } : { pass: true, summary };
      }
      return {
        pass: false,
        summary: differences.length === 1 ? differences[0]! : `${differences.length} differences`,
        details: [...(differences.length === 1 ? [] : differences), ...notes],
      };
    },
  };
}

export function createApplyLayoutRemediation(
  deps: LayoutDeps & { applier: Pick<LayoutApplier, 'applyAndWait'> }
): RemediationDefinition<LayoutParams> {
  return {
    type: DISPLAY_APPLY,
    label: 'Apply the monitor layout',
    order: 200,
    params: LayoutParamsSchema,
    describe: (p) =>
      p.layoutName ? `Apply the "${p.layoutName}" layout` : 'Apply the monitor layout',
    async run(params, ctx) {
      const current = await ctx.ports.displays.read();
      if (!current.ok) return current;
      const expected = await expectedFor(params, deps);
      const analysis = analyzeLayout(expected.displays, current.value.displays, await deps.names());
      if (analysis.missing.length > 0) {
        const n = analysis.missing.length;
        return err(
          'display.missing',
          `${joinNames(analysis.missing)} ${n === 1 ? 'is' : 'are'} not connected, so the layout was not applied.`,
          `Connect ${n === 1 ? 'it' : 'them'}, or apply the layout without ${n === 1 ? 'it' : 'them'} on the Monitors page.`
        );
      }
      if (analysis.problems.length > 0) {
        return err('display.invalid', 'The layout cannot be applied.', analysis.problems.join(' '));
      }
      if (analysis.changes.length === 0) return ok('The monitors already match the layout');
      // Waits for Keep or Go back: what follows in Make ready must know which layout is there.
      const applied = await deps.applier.applyAndWait(analysis.targets);
      if (!applied.ok) return applied;
      // Read back: "applied" is only said when the monitors are as the layout says.
      const after = await ctx.ports.displays.read();
      if (!after.ok) return after;
      const left = analyzeLayout(expected.displays, after.value.displays, await deps.names());
      if (left.changes.length > 0) {
        return err(
          'display.notApplied',
          'Windows accepted the layout, but the monitors are not arranged as it says.',
          left.changes.join('; ')
        );
      }
      const on = monitors(analysis.enabledCount);
      return ok(
        expected.name
          ? `Applied the "${expected.name}" layout to ${on}`
          : `Applied the layout to ${on}`
      );
    },
  };
}

/** The capture screen's answer to "save this arrangement as a layout named ...". */
const SAVE_AS = 'saveAs';

/**
 * When a setup is created with a monitor check and a layout name was given, the
 * arrangement is saved under that name and the check refers to the saved layout.
 */
export async function adoptLayoutItem(
  item: NewCheckItem,
  layouts: Pick<DisplayLayoutStore, 'create'>
): Promise<Result<NewCheckItem>> {
  const { [SAVE_AS]: asked, ...params } = item.params;
  const strip = (p: Record<string, unknown>): Record<string, unknown> => {
    const { [SAVE_AS]: _saveAs, ...rest } = p;
    return rest;
  };
  const plain: NewCheckItem = {
    ...item,
    params,
    ...(item.remediation
      ? { remediation: { ...item.remediation, params: strip(item.remediation.params) } }
      : {}),
  };
  const name = typeof asked === 'string' ? asked.trim() : '';
  if (!name) return ok(plain);
  const parsed = LayoutParamsSchema.safeParse(params);
  if (!parsed.success) return ok(plain);
  const created = await layouts.create(name, parsed.data.displays);
  if (!created.ok) return created;
  const named = { ...params, layoutId: created.value.id, layoutName: created.value.name };
  return ok({
    ...plain,
    title: `Monitor layout: ${created.value.name}`,
    params: named,
    ...(plain.remediation ? { remediation: { ...plain.remediation, params: named } } : {}),
  });
}

/** One line per monitor, as the capture screen shows it. */
export function describeTargets(targets: DisplayTarget[], names: MonitorNames): string[] {
  const labels = monitorLabels(targets, names);
  return targets.map((d) => {
    const label = labels.get(d.id.toLowerCase());
    return d.enabled
      ? `${label}: ${d.width}x${d.height} at ${d.x},${d.y}${d.rotation ? `, rotated ${d.rotation}°` : ''}${d.primary ? ', main' : ''}`
      : `${label}: off`;
  });
}

export function targetFromDisplay(display: DisplayInfo): DisplayTarget {
  return layoutToTargets({ displays: [display] })[0]!;
}

/**
 * "Capture current state" proposes one monitor check: the arrangement as it is now. When
 * it is exactly one of the saved layouts, the check refers to that layout by name.
 */
export function createDisplayCapture(deps: LayoutDeps): CaptureDefinition {
  return {
    id: 'displays',
    label: 'Monitors',
    async capture(ctx) {
      const layout = await ctx.ports.displays.read();
      if (!layout.ok) return layout;
      const displays = layoutToTargets(layout.value);
      if (displays.length === 0) return ok([]);
      const names = await deps.names();
      const saved = await deps.layouts.list();
      const same = saved.ok
        ? saved.value.find(
            (l) =>
              analyzeLayout(l.displays, layout.value.displays, names).differences.length === 0 &&
              l.displays.length >= displays.length
          )
        : undefined;
      const params: LayoutParams = same
        ? { layoutId: same.id, layoutName: same.name, displays }
        : { displays };
      const lines = describeTargets(displays, names);
      const title = same ? `Monitor layout: ${same.name}` : 'Monitor layout';
      return ok([
        {
          key: 'displays:layout',
          group: 'displays' as const,
          // Not one of the saved layouts yet: offer to make it one, so other setups and
          // Stand down can use the same arrangement by name.
          ...(same
            ? {}
            : {
                ask: {
                  param: SAVE_AS,
                  label: 'Save this arrangement as a layout named',
                  placeholder: 'Flying',
                  hint: 'Optional. Changing the saved layout later changes every setup that uses it.',
                },
              }),
          title,
          description: (same ? [`Your saved layout "${same.name}"`, ...lines] : lines).join(' · '),
          selectedByDefault: true,
          check: {
            type: DISPLAY_LAYOUT,
            title,
            required: true,
            params,
            remediation: { type: DISPLAY_APPLY, params },
          },
        },
      ]);
    },
  };
}
