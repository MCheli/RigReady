import { z } from 'zod';
import type {
  CaptureDefinition,
  CheckDefinition,
  RemediationDefinition,
} from '../../../core/checks/registry';
import { ok } from '../../../core/result';
import type { CheatSheets } from './service';

/**
 * "The kneeboard pages are up to date with the bindings": the pages RigReady exported
 * for an aircraft still show what is bound now (and are still in the Kneeboard folder).
 * Its fix writes the pages again with the options of the last export.
 */

export const KNEEBOARD_CHECK = 'cheat-sheets.kneeboardCurrent';
export const KNEEBOARD_REGENERATE = 'cheat-sheets.regenerate';

export const KneeboardCheckParamsSchema = z.object({
  game: z.string().default('dcs'),
  /** The aircraft type: FA-18C_hornet. */
  aircraft: z.string().min(1),
  /** Shown in messages: "F/A-18C". */
  aircraftName: z.string().optional(),
});
export type KneeboardCheckParams = z.infer<typeof KneeboardCheckParamsSchema>;

export function createKneeboardCheck(service: CheatSheets): CheckDefinition<KneeboardCheckParams> {
  return {
    type: KNEEBOARD_CHECK,
    group: 'files',
    label: 'Cheat sheet kneeboard pages are up to date',
    params: KneeboardCheckParamsSchema,
    async run(params, ctx) {
      const status = await service.kneeboardStatus(params.game, params.aircraft, ctx);
      if (!status.ok) return { pass: false, summary: status.error.message };
      const { state, summary, pages, folder } = status.value;
      const details: string[] = [];
      if (folder) details.push(folder);
      if (state === 'none') {
        details.push(
          'Export them from Cheat sheets, or let the fix write them with the usual options.'
        );
      } else if (state === 'stale') {
        details.push('A binding, a note or a layout changed since the pages were written.');
      } else {
        details.push(...pages.slice(0, 6));
      }
      return { pass: state === 'current', summary, details };
    },
  };
}

export function createRegenerate(
  service: CheatSheets
): RemediationDefinition<KneeboardCheckParams> {
  return {
    type: KNEEBOARD_REGENERATE,
    label: 'Write the kneeboard pages again',
    order: 320,
    params: KneeboardCheckParamsSchema,
    describe: (params) =>
      `Write the cheat sheet kneeboard pages for ${params.aircraftName ?? params.aircraft} again`,
    run: (params, ctx) => service.regenerate(params.game, params.aircraft, ctx),
  };
}

/** Proposes the check for every aircraft that has exported pages. Optional by default. */
export function createCapture(service: CheatSheets): CaptureDefinition {
  return {
    id: 'cheat-sheets',
    label: 'Cheat sheets',
    async capture() {
      const records = await service.kneeboard.records();
      if (!records.ok) return records;
      return ok(
        Object.entries(records.value).map(([aircraft, record]) => {
          const params = { game: 'dcs', aircraft, aircraftName: record.aircraftName };
          const title = `Kneeboard cheat sheet for ${record.aircraftName} is up to date`;
          return {
            key: `cheat-sheets:${aircraft}`,
            group: 'files' as const,
            title,
            description: `${record.pages.length} page${record.pages.length === 1 ? '' : 's'} in ${record.folder}`,
            selectedByDefault: true,
            game: 'dcs',
            check: {
              type: KNEEBOARD_CHECK,
              title,
              required: false,
              params,
              remediation: { type: KNEEBOARD_REGENERATE, params },
            },
          };
        })
      );
    },
  };
}
