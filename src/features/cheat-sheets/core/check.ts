import { z } from 'zod';
import type {
  CaptureDefinition,
  CheckDefinition,
  RemediationDefinition,
} from '../../../core/checks/registry';
import type { Clock } from '../../../core/ports';
import type { CheckItem } from '../../../core/profile/schema';
import type { ProfileStore } from '../../../core/profile/store';
import { err, ok, type Result } from '../../../core/result';
import type { CheatSheets } from './service';

/**
 * "The kneeboard pages are up to date with the bindings": the pages RigReady exported
 * for an aircraft still show what is bound now (and are still in the Kneeboard folder).
 * Its fix writes the pages again with the options of the last export.
 */

export const KNEEBOARD_CHECK = 'cheat-sheets.kneeboardCurrent';
export const KNEEBOARD_REGENERATE = 'cheat-sheets.regenerate';

export const KneeboardCheckParamsSchema = z.object({
  game: z.string().default('dcs').describe('Game (dcs)'),
  /** The aircraft type: FA-18C_hornet. */
  aircraft: z.string().min(1).describe('Aircraft type as DCS names its folder, e.g. FA-18C_hornet'),
  /** Shown in messages: "F/A-18C". */
  aircraftName: z.string().optional().describe('Name shown in messages, e.g. F/A-18C'),
});
export type KneeboardCheckParams = z.infer<typeof KneeboardCheckParamsSchema>;

export function createKneeboardCheck(service: CheatSheets): CheckDefinition<KneeboardCheckParams> {
  return {
    type: KNEEBOARD_CHECK,
    group: 'files',
    label: 'Cheat sheet kneeboard pages are up to date',
    params: KneeboardCheckParamsSchema,
    // The one fix that suits it, so the setup editor offers that and nothing else.
    fixes: [KNEEBOARD_REGENERATE],
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

// ---- adding the check to a setup from the cheat sheets page ----

export interface SetupDeps {
  profiles: ProfileStore;
  clock: Clock;
}

export interface KneeboardSetup {
  id: string;
  name: string;
  /** The setup already checks this aircraft's kneeboard pages. */
  checked: boolean;
}

const isFor = (item: CheckItem, game: string, aircraft: string): boolean =>
  item.type === KNEEBOARD_CHECK &&
  item.params['aircraft'] === aircraft &&
  (item.params['game'] ?? 'dcs') === game;

/** The setups the check can go into (those for this game, and those for no game in particular). */
export async function kneeboardSetups(
  deps: SetupDeps,
  game: string,
  aircraft: string
): Promise<Result<KneeboardSetup[]>> {
  const profiles = await deps.profiles.list();
  if (!profiles.ok) return profiles;
  return ok(
    profiles.value
      .filter((p) => !p.game || p.game === game)
      .map((p) => ({
        id: p.id,
        name: p.name,
        checked: p.checks.some((c) => isFor(c, game, aircraft)),
      }))
  );
}

/**
 * Puts "kneeboard pages are up to date" for one aircraft into a setup, with the fix that
 * writes the pages again. Optional (a warning, never "Not ready"), like the one capture adds.
 */
export async function addKneeboardCheck(
  service: CheatSheets,
  deps: SetupDeps,
  target: { game: string; aircraft: string; aircraftName: string; profileId: string }
): Promise<Result<{ message: string }>> {
  if (!service.supportsKneeboard(target.game)) {
    return err('kneeboard.game', 'Kneeboard pages are a DCS feature.');
  }
  const profile = await deps.profiles.get(target.profileId);
  if (!profile.ok) return profile;
  if (profile.value.game && profile.value.game !== target.game) {
    return err(
      'kneeboard.setup',
      `"${profile.value.name}" is a setup for another game, so this check does not belong in it.`
    );
  }
  if (profile.value.checks.some((c) => isFor(c, target.game, target.aircraft))) {
    return ok({ message: `"${profile.value.name}" already checks these kneeboard pages.` });
  }
  const params = {
    game: target.game,
    aircraft: target.aircraft,
    aircraftName: target.aircraftName,
  };
  const base = `kneeboard-${target.aircraft.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}`;
  let id = base;
  for (let n = 2; profile.value.checks.some((c) => c.id === id); n++) id = `${base}-${n}`;
  const saved = await deps.profiles.save({
    ...profile.value,
    updatedAt: deps.clock.now().toISOString(),
    checks: [
      ...profile.value.checks,
      {
        id,
        type: KNEEBOARD_CHECK,
        title: `Kneeboard cheat sheet for ${target.aircraftName} is up to date`,
        required: false,
        params,
        remediation: { type: KNEEBOARD_REGENERATE, params },
      },
    ],
  });
  if (!saved.ok) return saved;
  // Read back: say it is in the setup only when it is.
  const now = await deps.profiles.get(target.profileId);
  if (!now.ok || !now.value.checks.some((c) => isFor(c, target.game, target.aircraft))) {
    return err('kneeboard.setup', `The check was not saved in "${profile.value.name}".`);
  }
  return ok({
    message: `"${profile.value.name}" now checks the ${target.aircraftName} kneeboard pages, and Make ready writes them again when a binding changed.`,
  });
}

/** Takes the check for one aircraft out of a setup again. */
export async function removeKneeboardCheck(
  deps: SetupDeps,
  target: { game: string; aircraft: string; profileId: string }
): Promise<Result<{ message: string }>> {
  const profile = await deps.profiles.get(target.profileId);
  if (!profile.ok) return profile;
  const others = profile.value.checks.filter((c) => !isFor(c, target.game, target.aircraft));
  if (others.length === profile.value.checks.length) {
    return ok({ message: `"${profile.value.name}" did not check these kneeboard pages.` });
  }
  const saved = await deps.profiles.save({
    ...profile.value,
    updatedAt: deps.clock.now().toISOString(),
    checks: others,
  });
  if (!saved.ok) return saved;
  const now = await deps.profiles.get(target.profileId);
  if (!now.ok || now.value.checks.some((c) => isFor(c, target.game, target.aircraft))) {
    return err('kneeboard.setup', `The check is still in "${profile.value.name}".`);
  }
  return ok({ message: `"${profile.value.name}" no longer checks these kneeboard pages.` });
}
