import { z } from 'zod';
import type {
  CaptureDefinition,
  CheckDefinition,
  RemediationDefinition,
} from '../../../core/checks/registry';
import { ok } from '../../../core/result';
import {
  DisplayTargetSchema,
  type DisplayInfo,
  type DisplayLayout,
  type DisplayTarget,
} from '../../../shared/models';
import type { RevertGuard } from './revertGuard';

export const DISPLAY_LAYOUT = 'display.layout';
export const DISPLAY_APPLY = 'display.applyLayout';

export const LayoutParamsSchema = z.object({ displays: z.array(DisplayTargetSchema).min(1) });
export type LayoutParams = z.infer<typeof LayoutParamsSchema>;

/** "USB_Monitor (2 of 3)" when several expected monitors share a name. */
export function displayLabels(displays: { id: string; name: string }[]): Map<string, string> {
  const totals = new Map<string, number>();
  for (const d of displays) totals.set(d.name, (totals.get(d.name) ?? 0) + 1);
  const seen = new Map<string, number>();
  const labels = new Map<string, string>();
  for (const d of displays) {
    const name = d.name || 'Monitor';
    const total = totals.get(d.name) ?? 1;
    const n = (seen.get(d.name) ?? 0) + 1;
    seen.set(d.name, n);
    labels.set(d.id.toLowerCase(), total > 1 ? `${name} (${n} of ${total})` : name);
  }
  return labels;
}

/** One line per difference between what the profile expects and what is true. Empty when they match. */
export function diffLayout(expected: DisplayTarget[], actual: DisplayLayout): string[] {
  const labels = displayLabels(expected);
  const current = new Map(actual.displays.map((d) => [d.id, d]));
  const differences: string[] = [];
  for (const want of expected) {
    const label = labels.get(want.id.toLowerCase())!;
    const have = current.get(want.id.toLowerCase());
    if (!have) {
      differences.push(
        want.enabled ? `${label} is not connected` : `${label} is not connected (expected off)`
      );
      continue;
    }
    if (!want.enabled) {
      if (have.enabled) differences.push(`${label} is on, expected off`);
      continue;
    }
    if (!have.enabled) {
      differences.push(`${label} is off, expected on`);
      continue;
    }
    if (have.rotation !== want.rotation) {
      differences.push(`${label} is rotated ${have.rotation}°, expected ${want.rotation}°`);
    }
    if (
      want.width !== undefined &&
      want.height !== undefined &&
      (have.width !== want.width || have.height !== want.height)
    ) {
      differences.push(
        `${label} is ${have.width}x${have.height}, expected ${want.width}x${want.height}`
      );
    }
    if (have.x !== want.x || have.y !== want.y) {
      differences.push(`${label} is at ${have.x},${have.y}, expected ${want.x},${want.y}`);
    }
    if (want.primary && !have.primary) differences.push(`${label} is not the main display`);
  }
  return differences;
}

export const displayLayoutCheck: CheckDefinition<LayoutParams> = {
  type: DISPLAY_LAYOUT,
  group: 'displays',
  label: 'Monitor layout',
  params: LayoutParamsSchema,
  async run(params, ctx) {
    const layout = await ctx.ports.displays.read();
    if (!layout.ok) return { pass: false, summary: layout.error.message };
    const differences = diffLayout(params.displays, layout.value);
    if (differences.length === 0) {
      const on = params.displays.filter((d) => d.enabled).length;
      return {
        pass: true,
        summary: `${on} ${on === 1 ? 'monitor' : 'monitors'} arranged as expected`,
      };
    }
    return {
      pass: false,
      summary: differences.length === 1 ? differences[0]! : `${differences.length} differences`,
      details: differences.length === 1 ? [] : differences,
    };
  },
};

export function createApplyLayoutRemediation(
  guard: RevertGuard
): RemediationDefinition<LayoutParams> {
  return {
    type: DISPLAY_APPLY,
    label: 'Apply the monitor layout',
    order: 200,
    params: LayoutParamsSchema,
    describe: () => 'Apply the monitor layout',
    async run(params, ctx) {
      const applied = await ctx.ports.displays.apply(params.displays);
      if (!applied.ok) return applied;
      guard.arm();
      const on = params.displays.filter((d) => d.enabled).length;
      return ok(`Applied the layout to ${on} ${on === 1 ? 'monitor' : 'monitors'}`);
    },
  };
}

export function targetFromDisplay(display: DisplayInfo): DisplayTarget {
  if (!display.enabled) {
    return {
      id: display.id,
      name: display.name,
      enabled: false,
      primary: false,
      x: 0,
      y: 0,
      rotation: 0,
    };
  }
  return {
    id: display.id,
    name: display.name,
    enabled: true,
    primary: display.primary,
    x: display.x,
    y: display.y,
    width: display.width,
    height: display.height,
    rotation: display.rotation,
  };
}

export const displayCapture: CaptureDefinition = {
  id: 'displays',
  label: 'Monitors',
  async capture(ctx) {
    const layout = await ctx.ports.displays.read();
    if (!layout.ok) return layout;
    const displays = layout.value.displays.map(targetFromDisplay);
    if (displays.length === 0) return ok([]);
    const labels = displayLabels(displays);
    const lines = displays.map((d) =>
      d.enabled
        ? `${labels.get(d.id)}: ${d.width}x${d.height} at ${d.x},${d.y}${d.rotation ? `, rotated ${d.rotation}°` : ''}${d.primary ? ', main' : ''}`
        : `${labels.get(d.id)}: off`
    );
    return ok([
      {
        key: 'displays:layout',
        group: 'displays' as const,
        title: 'Monitor layout',
        description: lines.join(' · '),
        selectedByDefault: true,
        check: {
          type: DISPLAY_LAYOUT,
          title: 'Monitor layout',
          required: true,
          params: { displays },
          remediation: { type: DISPLAY_APPLY, params: { displays } },
        },
      },
    ]);
  },
};
