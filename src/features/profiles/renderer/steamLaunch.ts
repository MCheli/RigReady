import type { Profile } from '../../../core/profile/schema';

/**
 * A setup made for a Steam game stores its launch as "steam.exe -applaunch <number>": a
 * program and two arguments. The editor shows that as what it is, "Through Steam" with
 * the game's number, and not as a program path and arguments nobody typed.
 */

type Launch = NonNullable<Profile['launch']>;

const baseName = (exe: string): string => exe.replace(/\//g, '\\').split('\\').pop() ?? '';

/** The Steam app a program launch hands the game to, when it is exactly such a handoff. */
export function steamAppOf(launch: Profile['launch']): string | undefined {
  if (!launch || baseName(launch.exe).toLowerCase() !== 'steam.exe') return undefined;
  const [flag, app, ...more] = launch.args;
  if (flag !== '-applaunch' || app === undefined || more.length > 0) return undefined;
  return /^\d+$/.test(app) ? app : undefined;
}

export type LaunchKind = 'program' | 'steam' | 'none';

/** Which of the editor's three choices a setup's launch is. */
export function launchKindOf(profile: Pick<Profile, 'launch' | 'steamAppId'>): LaunchKind {
  if (profile.steamAppId || steamAppOf(profile.launch)) return 'steam';
  return profile.launch ? 'program' : 'none';
}

/** The number the "Steam app id" field shows. */
export function steamAppShown(profile: Pick<Profile, 'launch' | 'steamAppId'>): string {
  return profile.steamAppId ?? steamAppOf(profile.launch) ?? '';
}

/**
 * How "Through Steam" with this number is saved. A setup that hands over through its own
 * steam.exe keeps doing so (only the number changes); any other gets a Steam app id.
 */
export function steamLaunchFor(
  profile: Pick<Profile, 'launch' | 'steamAppId'>,
  app: string
): { launch?: Launch; steamAppId?: string } {
  const id = app.trim();
  if (!id) return {};
  const { launch } = profile;
  // Only a number is handed to steam.exe. Anything else goes as a Steam app id, which the
  // setup refuses with its own message, and never as an argument that starts nothing.
  const handsOver = launch && profile.steamAppId === undefined && steamAppOf(launch) !== undefined;
  if (handsOver && /^\d+$/.test(id)) return { launch: { ...launch, args: ['-applaunch', id] } };
  return { steamAppId: id };
}

/**
 * The launch a new setup is saved with: the program as typed, or "Through Steam" with the
 * game's number. Nothing when what the chosen kind needs is not filled in.
 */
export function newSetupLaunch(
  kind: LaunchKind,
  typed: Launch | undefined,
  app: string
): { launch?: Launch; steamAppId?: string } {
  if (kind === 'steam') return steamLaunchFor(typed ? { launch: typed } : {}, app);
  return kind === 'program' && typed ? { launch: typed } : {};
}

/** What is wrong with a typed Steam app id, in the words the field shows. Nothing when fine. */
export function steamAppProblem(app: string): string | undefined {
  const id = app.trim();
  return id === '' || /^\d{1,10}$/.test(id) ? undefined : 'A number, for example 223750.';
}
