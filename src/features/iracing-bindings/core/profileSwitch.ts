import path from 'node:path';
import { z } from 'zod';
import type {
  CheckContext,
  CheckDefinition,
  ParamPicker,
  RemediationDefinition,
  StandDownStep,
} from '../../../core/checks/registry';
import { gameRunning, type GameRegistry } from '../../../core/games';
import { locateIracingControls } from '../../../core/iracingControls';
import { JsonStore } from '../../../core/jsonStore';
import type { FileStore } from '../../../core/ports';
import { err, ok, type Result } from '../../../core/result';
import { globalProfileOf, withGlobalProfile, writableProfileName } from './appIni';
import { iracingFolder, profilesInUse, sameProfile } from './profiles';
import { simulatorOf, type BindingsContext } from './view';

/**
 * A setup item that switches the control profile iRacing loads for all cars: "iRacing
 * control profile: Test Profile CTSV". Its check passes when app.ini [ControlProfiles]
 * names that profile for all cars (read with src/core/iracingControls.ts, as the rest of
 * the app reads it). Its fix, run by Make ready, sets `Global=` to it through FileStore (a
 * backup first, one entry on the Safety page) and notes what was there before; Stand down
 * puts that back. Nothing is written while the simulator runs (it writes app.ini when it
 * closes), and no profile folder is ever made or removed.
 */

export const PROFILE_CHECK = 'iracing-bindings.controlProfile';
export const PROFILE_FIX = 'iracing-bindings.setControlProfile';
export const PROFILE_STEP = 'iracing-bindings.putBackControlProfile';

export const ProfileParamsSchema = z.object({
  /** The profile's folder name under Documents\iRacing\profiles\controls. */
  profile: z.string().min(1).max(200),
});
export type ProfileParams = z.infer<typeof ProfileParamsSchema>;

/** What Make ready switched, so Stand down can put it back. Kept in the data folder. */
export const SwitchMemorySchema = z.object({
  switched: z
    .object({
      /** The profile app.ini named for all cars before the first switch. */
      previous: z.string(),
      /** The profile the last switch left there. */
      set: z.string(),
      at: z.string(),
    })
    .optional(),
});
export type SwitchMemory = z.infer<typeof SwitchMemorySchema>;

export const switchMemory = (
  files: FileStore,
  dataRoot: string
): JsonStore<typeof SwitchMemorySchema> =>
  new JsonStore(
    files,
    path.join(dataRoot, 'iracing-bindings', 'profile-switch.json'),
    SwitchMemorySchema
  );

type Memory = ReturnType<typeof switchMemory>;

/** Why app.ini cannot be written now, when it cannot: the simulator writes it when it closes. */
async function whyNot(ctx: BindingsContext): Promise<string | undefined> {
  const list = await ctx.ports.processes.list();
  if (!list.ok) {
    return 'RigReady could not see which programs are running, so it cannot tell whether iRacing is open.';
  }
  return (await gameRunning(ctx, simulatorOf(ctx)))
    ? 'iRacing is running. Close iRacing first: it writes app.ini when it closes and would put its own profile back.'
    : undefined;
}

const forAllCars = (name: string): string => `iRacing uses “${name}” for all cars`;

interface Found {
  appIni: string;
  /** The profile's folder name as it is on disk. */
  name: string;
}

/** app.ini and the profile's folder name; the profile must be there with its bindings. */
async function findProfile(ctx: BindingsContext, profile: string): Promise<Result<Found>> {
  const inUse = await profilesInUse(ctx);
  if (!inUse) {
    return err(
      'iracing-bindings.profile.none',
      'This iRacing keeps no control profiles. They came with iRacing 2026 Season 3: update iRacing and start it once.'
    );
  }
  const found = inUse.profiles.find((p) => sameProfile(p.name, profile) && p.hasControls);
  if (!found) {
    return err(
      'iracing-bindings.profile.missing',
      `iRacing has no control profile “${profile}” on this PC. Make it in iRacing: Options, then Controls.`
    );
  }
  return ok({ appIni: inUse.appIni, name: found.name });
}

/** Writes `profile` into app.ini for all cars and reads it back. Answers what was there before. */
async function writeGlobal(
  ctx: BindingsContext,
  appIni: string,
  profile: string,
  reason: string
): Promise<Result<{ before: string; same: boolean }>> {
  const bytes = await ctx.ports.files.readBytes(appIni);
  if (!bytes.ok) {
    return err('iracing-bindings.read', `RigReady could not read ${appIni}.`, bytes.error.message);
  }
  const change = withGlobalProfile(bytes.value, profile);
  if (!change.ok) return change;
  if (change.value.same) return ok({ before: change.value.before, same: true });
  const group = ctx.ports.files.beginGroup(reason);
  const written = await ctx.ports.files.write(appIni, change.value.bytes, {
    reason: 'Set the control profile for all cars in app.ini',
    group,
  });
  if (!written.ok) return written;
  const back = await ctx.ports.files.readBytes(appIni);
  if (!back.ok) return back;
  if (globalProfileOf(back.value) !== profile) {
    return err('iracing-bindings.profile.notKept', 'app.ini did not keep the change.');
  }
  return ok({ before: change.value.before, same: false });
}

/** Make ready's fix: switch app.ini to the setup's profile, noting what was there. */
export async function switchProfile(
  ctx: BindingsContext,
  profile: string,
  memory: Memory
): Promise<Result<string>> {
  const blocked = await whyNot(ctx);
  if (blocked) return err('iracing-bindings.profile.running', blocked);
  const found = await findProfile(ctx, profile);
  if (!found.ok) return found;
  const { appIni, name } = found.value;
  const bytes = await ctx.ports.files.readBytes(appIni);
  if (!bytes.ok) {
    return err('iracing-bindings.read', `RigReady could not read ${appIni}.`, bytes.error.message);
  }
  const now = globalProfileOf(bytes.value);
  if (now !== undefined && now === name) return ok(`${forAllCars(name)} already (app.ini)`);
  // What is there now must be something Stand down can write back.
  if (now !== undefined && !writableProfileName(now)) {
    return err(
      'iracing-bindings.profile.name',
      `app.ini names “${now}” for all cars, which RigReady could not put back at Stand down, so it does not switch. Choose the profile in iRacing: Options, then Controls.`
    );
  }
  // Noted before the write: a switch Stand down does not know about cannot be put back.
  const remembered = await memory.read();
  if (!remembered.ok) return remembered;
  const earlier = remembered.value.switched;
  const at = ctx.ports.clock.now().toISOString();
  const next: SwitchMemory =
    earlier && sameProfile(earlier.previous, name)
      ? {}
      : { switched: { previous: earlier?.previous ?? now ?? '', set: name, at } };
  const noted = await memory.write(next);
  if (!noted.ok) return noted;
  const done = await writeGlobal(
    ctx,
    appIni,
    name,
    `iRacing control profile for all cars: “${name}”`
  );
  if (!done.ok) {
    await memory.write(remembered.value);
    return done;
  }
  const back = next.switched?.previous;
  return ok(
    back
      ? `Made “${name}” iRacing’s control profile for all cars in app.ini (it was “${done.value.before}”). Stand down puts “${back}” back.`
      : `Made “${name}” iRacing’s control profile for all cars in app.ini (it was “${done.value.before}”).`
  );
}

/** Stand down: put back the profile that was there before Make ready switched it. */
export async function putBackProfile(
  ctx: BindingsContext,
  memory: Memory
): Promise<Result<string | null>> {
  const remembered = await memory.read();
  if (!remembered.ok) return remembered;
  const entry = remembered.value.switched;
  if (!entry || !entry.previous) return ok(null);
  const blocked = await whyNot(ctx);
  if (blocked) {
    return err(
      'iracing-bindings.profile.running',
      `“${entry.previous}” was not put back as iRacing’s control profile. ${blocked} Then press Stand down again.`
    );
  }
  const folder = await iracingFolder(ctx);
  if (!folder)
    return err('iracing-bindings.notFound', 'The iRacing folder in Documents was not found.');
  const appIni = path.join(folder, 'app.ini');
  const bytes = await ctx.ports.files.readBytes(appIni);
  if (!bytes.ok) {
    return err('iracing-bindings.read', `RigReady could not read ${appIni}.`, bytes.error.message);
  }
  const now = globalProfileOf(bytes.value);
  if (now === undefined || !sameProfile(now, entry.set)) {
    const forgot = await memory.write({});
    if (!forgot.ok) return forgot;
    return ok(
      `Left iRacing’s control profile as it is: app.ini names “${now ?? 'none'}” for all cars now, not “${entry.set}” as Make ready left it.`
    );
  }
  const found = await findProfile(ctx, entry.previous);
  if (!found.ok) {
    const forgot = await memory.write({});
    if (!forgot.ok) return forgot;
    return err(
      'iracing-bindings.profile.missing',
      `“${entry.previous}” is no longer on this PC, so app.ini keeps “${entry.set}” for all cars.`
    );
  }
  const done = await writeGlobal(
    ctx,
    appIni,
    found.value.name,
    `iRacing control profile for all cars: “${found.value.name}” again`
  );
  if (!done.ok) return done;
  const forgot = await memory.write({});
  if (!forgot.ok) return forgot;
  return ok(`Put back “${found.value.name}” as iRacing’s control profile for all cars in app.ini.`);
}

/** The setup item's check, fix, picker and Stand down step. */
export function profileSwitch(games: GameRegistry, memory: Memory) {
  const withGames = (ctx: CheckContext): BindingsContext => ({ ...ctx, games });

  const picker: ParamPicker = {
    list: 'iracing.controlProfiles',
    param: 'profile',
    label: 'Control profile',
    empty:
      'iRacing keeps no control profiles on this PC yet. iRacing 2026 Season 3 and later make the profile “Baseline” the first time they start.',
    async choices(ctx) {
      const inUse = await profilesInUse(withGames(ctx));
      return ok(
        (inUse?.profiles ?? [])
          .filter((p) => p.hasControls)
          .map((p) => ({
            value: p.name,
            label: p.name,
            detail: p.forAllCars
              ? 'Used for all cars now'
              : p.cars.length
                ? `Used by ${p.cars.join(', ')}`
                : 'Not used by any car now',
            ...(p.forAllCars ? { current: true } : {}),
          }))
      );
    },
  };

  const check: CheckDefinition<ProfileParams> = {
    type: PROFILE_CHECK,
    group: 'files',
    label: 'iRacing control profile',
    params: ProfileParamsSchema,
    fixes: [PROFILE_FIX],
    picker,
    async run(params, ctx) {
      const bctx = withGames(ctx);
      const folder = await iracingFolder(bctx);
      if (!folder) {
        return {
          pass: false,
          error: true,
          summary: 'The iRacing folder in Documents was not found',
        };
      }
      const located = await locateIracingControls(ctx.ports.files, folder);
      if (located.kind === 'files') {
        return {
          pass: false,
          error: true,
          summary: 'This iRacing keeps no control profiles',
          details: ['They came with iRacing 2026 Season 3. Update iRacing and start it once.'],
        };
      }
      if (!located.profile) {
        return { pass: false, summary: located.problem ?? 'app.ini names no control profile' };
      }
      if (sameProfile(located.profile, params.profile)) {
        return { pass: true, summary: forAllCars(located.profile) };
      }
      // When the profile is not on this PC, the fix is not offered and says why beside it.
      return {
        pass: false,
        summary: forAllCars(located.profile),
        details: [`This setup uses “${params.profile}”.`],
      };
    },
  };

  const fix: RemediationDefinition<ProfileParams> = {
    type: PROFILE_FIX,
    label: 'Switch iRacing’s control profile',
    order: 300,
    params: ProfileParamsSchema,
    picker,
    describe: (p) => `Make “${p.profile}” iRacing’s control profile for all cars in app.ini`,
    async available(params, ctx) {
      const found = await findProfile(withGames(ctx), params.profile);
      return found.ok ? { ok: true } : { ok: false, reason: found.error.message };
    },
    run: (params, ctx) => switchProfile(withGames(ctx), params.profile, memory),
  };

  const step: StandDownStep = {
    id: PROFILE_STEP,
    label: 'iRacing control profile',
    order: 300,
    run: (ctx) => putBackProfile(withGames(ctx), memory),
  };

  return { check, fix, step };
}
