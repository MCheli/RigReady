import path from 'node:path';
import { z } from 'zod';
import type { CheckDefinition } from '../../../../core/checks/registry';
import { JsonStore } from '../../../../core/jsonStore';
import type { CheckContext } from '../../../../core/checks/registry';
import type { GameComparison, WheelPresets } from '../../contract';
import { WheelPresetsSchema } from '../../contract';
import type { RacingContext } from '../context';
import { beamngView } from '../beamng/beamng';
import { lmuView } from '../lmu/lmu';
import { RECOMMENDATIONS, TUNING_PARAMETERS } from './recommended';

/**
 * The wheel base keeps five tuning presets in its own memory; no file on the PC holds
 * them and Fanatec offers no supported way to read them. RigReady keeps the values the
 * user writes down, so there is a record to set the base back from.
 */

export function presetStore(ctx: CheckContext): JsonStore<typeof WheelPresetsSchema> {
  return new JsonStore(
    ctx.ports.files,
    path.join(ctx.ports.folders.dataRoot(), 'racing', 'wheel-presets.json'),
    WheelPresetsSchema,
    { presets: [1, 2, 3, 4, 5].map((slot) => ({ slot })) }
  );
}

export async function readPresets(ctx: CheckContext): Promise<WheelPresets> {
  const read = await presetStore(ctx).read();
  return read.ok
    ? read.value
    : WheelPresetsSchema.parse({ presets: [1, 2, 3, 4, 5].map((slot) => ({ slot })) });
}

/** The values each game's files hold, by the name the recommendations use. */
async function readableValues(
  ctx: RacingContext,
  game: string
): Promise<Map<string, string> | undefined> {
  const values = new Map<string, string>();
  if (game === 'lmu') {
    const view = await lmuView(ctx);
    if (!view.installed) return undefined;
    const wheel = view.devices.find((d) => d.type === 'Wheel') ?? view.devices[0];
    for (const entry of [...(wheel?.forceFeedback ?? []), ...(wheel?.options ?? [])])
      values.set(entry.label, entry.value);
    const ctl = await ctx.ports.files.readText(
      path.join(view.userFolder ?? '', 'current controls.json')
    );
    if (ctl.ok) {
      const filter = /"Steering torque filter"\s*:\s*([-0-9.]+)/.exec(ctl.value)?.[1];
      if (filter !== undefined) values.set('Steering torque filter', String(Number(filter)));
    }
    return values;
  }
  if (game === 'beamng') {
    const view = await beamngView(ctx);
    if (!view.installed) return undefined;
    const map =
      view.maps.find((m) => m.state === 'connected' && m.forceFeedback.length > 0) ??
      view.maps.find((m) => m.forceFeedback.length > 0);
    for (const entry of map?.forceFeedback ?? []) values.set(entry.label, entry.value);
    return values;
  }
  return game === 'iracing' ? values : undefined;
}

/** Recommended next to current, per game. Base values are never shown as matching: they cannot be read. */
export async function compareWheelSettings(
  ctx: RacingContext,
  presets: WheelPresets
): Promise<GameComparison[]> {
  const out: GameComparison[] = [];
  const preset = presets.presets.find((p) => p.slot === presets.activeSlot);
  for (const rec of RECOMMENDATIONS) {
    const values = await readableValues(ctx, rec.game);
    out.push({
      game: rec.game,
      name: rec.name,
      installed: values !== undefined,
      source: rec.source,
      also: rec.also ?? [],
      retrieved: rec.retrieved,
      ...(rec.caveat ? { caveat: rec.caveat } : {}),
      rows: rec.rows.map((row) => {
        const param = TUNING_PARAMETERS.find((p) => p.id === row.param);
        const label = param ? `${param.id} · ${param.name}` : row.param;
        if (row.where === 'base') {
          const yours = preset?.values[row.param];
          return {
            where: row.where,
            label,
            recommended: row.value,
            current: yours
              ? `Set on the wheel · your preset ${preset!.slot}: ${yours}`
              : 'Set on the wheel',
            status: 'unreadable' as const,
            ...(row.note ? { note: row.note } : {}),
          };
        }
        const reading = row.readable ? values?.get(row.readable) : undefined;
        let status: 'match' | 'differs' | 'unreadable' | 'info' = 'unreadable';
        let current = row.readable
          ? values
            ? "Not in the game's files"
            : 'Game not found'
          : 'Not stored where RigReady can read it';
        if (reading !== undefined) {
          current = reading;
          if (row.expect !== undefined)
            status = sameValue(reading, row.expect) ? 'match' : 'differs';
          else if (row.readable === 'Steering rotation (degrees)') {
            const sen = Number(preset?.values['SEN']);
            status =
              Number.isFinite(sen) && sen > 0
                ? Number(reading) === sen
                  ? 'match'
                  : 'differs'
                : 'info';
          } else status = 'info';
        }
        return {
          where: row.where,
          label,
          recommended: row.value,
          current,
          status,
          ...(row.note ? { note: row.note } : {}),
        };
      }),
    });
  }
  return out;
}

const sameValue = (a: string, b: string): boolean => {
  const x = Number(a);
  const y = Number(b);
  return Number.isFinite(x) && Number.isFinite(y)
    ? x === y
    : a.trim().toLowerCase() === b.trim().toLowerCase();
};

export const WHEEL_SETTINGS = 'racing.wheelSettings';
export const WheelSettingsParamsSchema = z.object({ game: z.enum(['lmu', 'beamng']) });

/** Optional check: the in-game wheel settings RigReady can read are as recommended. */
export function wheelSettingsCheck(
  games: RacingContext['games']
): CheckDefinition<z.infer<typeof WheelSettingsParamsSchema>> {
  return {
    type: WHEEL_SETTINGS,
    group: 'other',
    label: 'In-game wheel settings as recommended',
    params: WheelSettingsParamsSchema,
    async run(params, ctx) {
      const rctx: RacingContext = { ...ctx, games };
      const comparison = (await compareWheelSettings(rctx, await readPresets(ctx))).find(
        (c) => c.game === params.game
      );
      if (!comparison?.installed) return { pass: false, summary: 'The game was not found' };
      const checked = comparison.rows.filter((r) => r.status === 'match' || r.status === 'differs');
      const differs = checked.filter((r) => r.status === 'differs');
      if (checked.length === 0)
        return { pass: false, summary: 'None of the settings could be read' };
      if (differs.length === 0)
        return { pass: true, summary: `${checked.length} readable settings as recommended` };
      return {
        pass: false,
        summary: `${differs.length} of ${checked.length} settings differ`,
        details: differs.map((r) => `${r.label}: ${r.current} (recommended ${r.recommended})`),
      };
    },
  };
}
