import path from 'node:path';
import {
  makeReady,
  runChecks,
  standDown,
  type ActionReport,
  type ChecklistReport,
} from '../../../core/checks/engine';
import type { MainContext } from '../../../core/feature';
import { err, ok, type Result } from '../../../core/result';

type Ctx = Pick<MainContext, 'ports' | 'log' | 'checks' | 'profiles'>;

export interface FlyState {
  profiles: { id: string; name: string; canLaunch: boolean }[];
  activeProfileId?: string;
}

export async function flyState(ctx: Ctx): Promise<Result<FlyState>> {
  const profiles = await ctx.profiles.list();
  if (!profiles.ok) return profiles;
  const state: FlyState = {
    profiles: profiles.value.map((p) => ({
      id: p.id,
      name: p.name,
      canLaunch: p.launch !== undefined,
    })),
  };
  const last = await ctx.profiles.lastProfileId();
  const active = profiles.value.find((p) => p.id === last) ?? profiles.value[0];
  if (active) state.activeProfileId = active.id;
  return ok(state);
}

export async function checkProfile(ctx: Ctx, profileId: string): Promise<Result<ChecklistReport>> {
  const profile = await ctx.profiles.get(profileId);
  if (!profile.ok) return profile;
  await ctx.profiles.setLastProfileId(profileId);
  return ok(await runChecks(profile.value, ctx.checks, ctx));
}

export async function makeProfileReady(ctx: Ctx, profileId: string): Promise<Result<ActionReport>> {
  const profile = await ctx.profiles.get(profileId);
  if (!profile.ok) return profile;
  const report = await makeReady(profile.value, ctx.checks, ctx);
  ctx.log.info(`make ready ${profileId}`, report.steps);
  return ok(report);
}

export async function standProfileDown(ctx: Ctx, profileId: string): Promise<Result<ActionReport>> {
  const profile = await ctx.profiles.get(profileId);
  if (!profile.ok) return profile;
  const report = await standDown(profile.value, ctx.checks, ctx);
  ctx.log.info(`stand down ${profileId}`, report.steps);
  return ok(report);
}

export async function launchProfile(
  ctx: Ctx,
  profileId: string
): Promise<Result<{ message: string }>> {
  const profile = await ctx.profiles.get(profileId);
  if (!profile.ok) return profile;
  const target = profile.value.launch;
  if (!target) return err('fly.noLaunch', `"${profile.value.name}" has no program to launch.`);
  const started = await ctx.ports.processes.start(target);
  if (!started.ok) return started;
  ctx.log.info(`launched ${target.exe}`, { pid: started.value.pid });
  return ok({ message: `Started ${path.win32.basename(target.exe)}` });
}
