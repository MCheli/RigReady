import path from 'node:path';
import { z } from 'zod';
import type {
  CaptureCandidate,
  CaptureDefinition,
  CheckContext,
  CheckDefinition,
  RemediationDefinition,
} from '../../../core/checks/registry';
import type { GameRegistry } from '../../../core/games';
import { allPathVariables, collapsePath, expandPath } from '../../../core/pathVariables';
import { isWithin } from '../../../core/paths';
import { closeAtStandDown, FORCE_CLOSE_LABEL } from '../../../core/processes';
import { err, ok, type Result } from '../../../core/result';
import type { GameKind, ProcessInfo } from '../../../shared/models';
import type { OwnApp, OwnApps } from './ownApps';

export const PROCESS_RUNNING = 'process.running';
export const PROCESS_LAUNCH = 'process.launch';

export const ProcessParamsSchema = z.object({
  /** Image name, e.g. "TrackIR5.exe". Compared case-insensitively. */
  name: z.string().min(1),
  /** When set, the running program must also be this executable (path variables allowed). */
  path: z.string().min(1).optional(),
  /**
   * Close this app at Stand down. Unset: close it only when RigReady started it in this
   * session. true: always. false: never.
   */
  stopOnStandDown: z.boolean().optional(),
  /** Terminate it when it has not closed 10 s after being asked to. Default false. */
  forceClose: z.boolean().default(false),
});
export type ProcessParams = z.infer<typeof ProcessParamsSchema>;

const sameName = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
const samePath = (a: string, b: string): boolean =>
  path.win32.normalize(a).toLowerCase() === path.win32.normalize(b).toLowerCase();

/** Programs RigReady started in this session, by lower-case image name. */
export class SessionStarts {
  private readonly names = new Set<string>();
  add(name: string): void {
    this.names.add(name.toLowerCase());
  }
  has(name: string): boolean {
    return this.names.has(name.toLowerCase());
  }
  delete(name: string): void {
    this.names.delete(name.toLowerCase());
  }
}

/** How long Stand down waits for a program to close after asking it to. */
export const CLOSE_WAIT_MS = 10_000;

/** What the setup editor calls `forceClose`: the hint that points at it is in core. */
export { FORCE_CLOSE_LABEL };

/** Paths stored in a profile may start with a path variable ({PROGRAM_FILES_X86}/TrackIR5/...). */
export type ResolvePath = (stored: string, ctx: CheckContext) => Promise<Result<string>>;

export function pathResolver(games: GameRegistry): ResolvePath {
  return async (stored, ctx) => {
    if (!stored.includes('{')) return expandPath(stored, {});
    return expandPath(stored, await allPathVariables(ctx, games));
  };
}

/**
 * Asks every matching program to close; terminates only when allowed. A program of several
 * processes is one program: all are asked at once and it counts as closed when none is
 * left. One that is still running is named with the reason, and with what can be done
 * about it (closeAtStandDown in core, which every check that closes an app goes by).
 */
export async function closePrograms(
  ctx: CheckContext,
  name: string,
  options: { force: boolean; waitMs?: number; match?: (p: ProcessInfo) => boolean }
): Promise<Result<string | null>> {
  const processes = await ctx.ports.processes.list();
  if (!processes.ok) return processes;
  const targets = processes.value.filter(
    (p) => sameName(p.name, name) && (options.match ? options.match(p) : true)
  );
  return closeAtStandDown(ctx.ports.processes, targets, name, {
    waitMs: options.waitMs ?? CLOSE_WAIT_MS,
    force: options.force,
  });
}

export function createProcessRunningCheck(
  session: SessionStarts,
  resolve: ResolvePath
): CheckDefinition<ProcessParams> {
  return {
    type: PROCESS_RUNNING,
    group: 'apps',
    label: 'App running',
    params: ProcessParamsSchema,
    fixes: [PROCESS_LAUNCH],
    async run(params, ctx) {
      const processes = await ctx.ports.processes.list();
      if (!processes.ok) return { pass: false, error: true, summary: processes.error.message };
      const named = processes.value.filter((p) => sameName(p.name, params.name));
      if (named.length === 0) return { pass: false, summary: 'Not running' };
      if (!params.path) return { pass: true, summary: 'Running' };
      const expected = await resolve(params.path, ctx);
      if (!expected.ok) return { pass: false, error: true, summary: expected.error.message };
      if (named.some((p) => p.path !== undefined && samePath(p.path, expected.value))) {
        return { pass: true, summary: 'Running' };
      }
      return {
        pass: false,
        summary: 'Running from a different folder',
        details: [
          `Expected ${expected.value}`,
          ...named.map((p) => `Running ${p.path ?? '(path not readable)'}`),
        ],
      };
    },
    async standDown(params, ctx) {
      const close =
        params.stopOnStandDown === true ||
        (params.stopOnStandDown === undefined && session.has(params.name));
      if (!close) return ok(null);
      const closed = await closePrograms(ctx, params.name, { force: params.forceClose });
      if (closed.ok) session.delete(params.name);
      return closed;
    },
  };
}

export const LaunchParamsSchema = z.object({
  /** The program. May start with a path variable. */
  exe: z.string().min(1),
  args: z.array(z.string()).default([]),
  cwd: z.string().optional(),
  /** Image name to wait for, when the launcher starts a differently named process. */
  waitFor: z.string().optional(),
  /** How long to wait for the process to appear. */
  timeoutMs: z.number().int().min(0).max(120_000).default(10_000),
  /** As a launch action: wait until the program has exited before going on. */
  waitForCompletion: z.boolean().default(false),
  /** As a launch action: overrides timeoutMs, and bounds waitForCompletion. */
  timeoutSeconds: z.number().int().min(1).max(3600).optional(),
});
export type LaunchParams = z.infer<typeof LaunchParamsSchema>;

const baseName = (exe: string): string => path.win32.basename(exe.replace(/\//g, '\\'));

/** Injected so tests do not wait in real time. */
export type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** "spawn ENOENT" and friends: the program is not where the setup says. */
export const isNotFound = (detail: string | undefined): boolean =>
  /ENOENT|cannot find|not found/i.test(detail ?? '');

export function createLaunchRemediation(
  session: SessionStarts,
  resolve: ResolvePath,
  sleep: Sleep = realSleep
): RemediationDefinition<LaunchParams> {
  const running = async (ctx: CheckContext, name: string): Promise<boolean> => {
    const processes = await ctx.ports.processes.list();
    return processes.ok && processes.value.some((p) => sameName(p.name, name));
  };
  return {
    type: PROCESS_LAUNCH,
    label: 'Start the app',
    order: 100,
    params: LaunchParamsSchema,
    describe: (params) => `Start ${baseName(params.exe)}`,
    async run(params, ctx) {
      const exe = await resolve(params.exe, ctx);
      if (!exe.ok) return exe;
      const cwd = params.cwd ? await resolve(params.cwd, ctx) : undefined;
      if (cwd && !cwd.ok) return cwd;
      const started = await ctx.ports.processes.start({
        exe: exe.value,
        args: params.args,
        ...(cwd ? { cwd: cwd.value } : {}),
      });
      const shown = baseName(exe.value);
      if (!started.ok) {
        if (isNotFound(started.error.detail)) {
          return err(
            'process.notFound',
            `${shown} not found at ${exe.value}`,
            'Check the path in the setup editor.'
          );
        }
        return started;
      }
      const expected = params.waitFor ?? shown;
      const timeoutMs =
        params.timeoutSeconds !== undefined ? params.timeoutSeconds * 1000 : params.timeoutMs;
      const deadline = ctx.ports.clock.now().getTime() + timeoutMs;
      let appeared = false;
      for (;;) {
        if (await running(ctx, expected)) {
          appeared = true;
          break;
        }
        if (ctx.ports.clock.now().getTime() >= deadline) break;
        await sleep(250);
      }
      if (!appeared) {
        const seconds = Math.round(timeoutMs / 1000);
        return err(
          'process.notStarted',
          `Started ${shown} but ${expected === shown ? 'it' : expected} is not running after ${seconds} s`
        );
      }
      session.add(expected);
      if (!params.waitForCompletion) return ok(`Started ${expected}`);
      // As a launch action that must finish first: wait for it to exit.
      const exitDeadline = ctx.ports.clock.now().getTime() + (params.timeoutSeconds ?? 30) * 1000;
      while (await running(ctx, expected)) {
        if (ctx.ports.clock.now().getTime() >= exitDeadline) {
          return err(
            'process.timeout',
            `${expected} is still running after ${params.timeoutSeconds ?? 30} s`
          );
        }
        await sleep(250);
      }
      return ok(`Ran ${expected} to completion`);
    },
  };
}

const WINDOWS_DIR = /^[a-z]:\\windows\\/i;

/**
 * Programs a sim rig commonly runs, by lower-case image name. General knowledge, used to
 * give the capture screen friendly names and an order:
 * - `helper`: a sim helper; listed first and kept by default.
 * - otherwise a program people often want in a setup (voice chat, streaming, overlays);
 *   listed with the helpers but not kept unless the user ticks it.
 * Everything else that is running is behind "Show all running apps".
 * `close`: closed again at Stand down (helpers that are only useful while flying or racing).
 */
export interface KnownApp {
  name: string;
  icon: string;
  helper?: boolean;
  kind?: GameKind;
  /**
   * The games it is made for, by game module id, when it is of no use with any other
   * (DCS-SRS talks to DCS only). A new setup keeps it by default only for those games.
   */
  games?: string[];
  close?: boolean;
  /** What it is for, in a few words. */
  purpose?: string;
}

const app = (
  name: string,
  icon: string,
  purpose?: string,
  more: Pick<KnownApp, 'helper' | 'kind' | 'close'> = {}
): KnownApp => ({ name, icon, ...(purpose ? { purpose } : {}), ...more });
/** A sim helper that Stand down closes again. */
const helper = (name: string, icon: string, purpose: string, kind?: GameKind): KnownApp =>
  app(name, icon, purpose, { helper: true, close: true, ...(kind ? { kind } : {}) });

export const KNOWN_APPS: Record<string, KnownApp> = {
  // head tracking
  'trackir5.exe': helper('TrackIR', 'mdi-head-sync-outline', 'head tracking'),
  'opentrack.exe': helper('opentrack', 'mdi-head-sync-outline', 'head tracking'),
  'tobii.gamehub.exe': app('Tobii Game Hub', 'mdi-eye-outline', 'eye and head tracking', {
    helper: true,
  }),
  // flight
  'simapppro.exe': helper(
    'SimAppPro',
    'mdi-airplane-cog',
    'WinWing panels, displays and backlight',
    'flight'
  ),
  'sr-clientradio.exe': {
    ...helper('DCS-SRS', 'mdi-radio-handheld', 'radio for multiplayer', 'flight'),
    games: ['dcs'],
  },
  'target.exe': helper('Thrustmaster TARGET', 'mdi-controller', 'controller scripts', 'flight'),
  'helios control center.exe': helper(
    'Helios',
    'mdi-monitor-dashboard',
    'cockpit panels on a touch screen',
    'flight'
  ),
  'simshaker for aviators.exe': helper(
    'SimShaker for Aviators',
    'mdi-vibrate',
    'seat shakers',
    'flight'
  ),
  'tacview.exe': app('Tacview', 'mdi-chart-timeline-variant', 'flight recording and debrief', {
    kind: 'flight',
  }),
  // racing
  'simhubwpf.exe': helper(
    'SimHub',
    'mdi-view-dashboard-outline',
    'dashboards, shakers and LEDs',
    'racing'
  ),
  'crewchiefv4.exe': helper('Crew Chief', 'mdi-account-voice', 'race engineer', 'racing'),
  'racelabapps.exe': helper('RaceLab', 'mdi-layers-outline', 'overlays', 'racing'),
  'ioverlay.exe': helper('iOverlay', 'mdi-layers-outline', 'overlays', 'racing'),
  'garage61-agent.exe': app('Garage 61', 'mdi-chart-line', 'telemetry', {
    helper: true,
    kind: 'racing',
  }),
  'trading paints.exe': app('Trading Paints', 'mdi-palette-outline', 'car liveries', {
    helper: true,
    kind: 'racing',
  }),
  'moza pit house.exe': app('MOZA Pit House', 'mdi-steering', 'wheel settings', {
    helper: true,
    kind: 'racing',
  }),
  'simpro manager.exe': app('SimPro Manager', 'mdi-steering', 'wheel settings', {
    helper: true,
    kind: 'racing',
  }),
  'fanatecapp.exe': app('Fanatec App', 'mdi-steering', 'wheel settings', { kind: 'racing' }),
  // on every kind of rig
  'voiceattack.exe': helper('VoiceAttack', 'mdi-microphone-message', 'voice commands'),
  'joystick_gremlin.exe': helper('Joystick Gremlin', 'mdi-controller', 'remaps controllers'),
  'joytokey.exe': helper('JoyToKey', 'mdi-controller', 'maps controller buttons to keys'),
  'streamdeck.exe': app('Stream Deck', 'mdi-view-grid-outline', 'button deck', { helper: true }),
  'vrserver.exe': app('SteamVR', 'mdi-virtual-reality', 'VR headset'),
  'oculusclient.exe': app('Meta Quest Link', 'mdi-virtual-reality', 'VR headset'),
  'virtualdesktop.streamer.exe': app('Virtual Desktop Streamer', 'mdi-virtual-reality', 'VR'),
  'discord.exe': app('Discord', 'mdi-forum-outline', 'voice chat'),
  'ts3client_win64.exe': app('TeamSpeak', 'mdi-forum-outline', 'voice chat'),
  'teamspeak.exe': app('TeamSpeak', 'mdi-forum-outline', 'voice chat'),
  'mumble.exe': app('Mumble', 'mdi-forum-outline', 'voice chat'),
  'obs64.exe': app('OBS Studio', 'mdi-record-rec', 'recording and streaming'),
  'msiafterburner.exe': app('MSI Afterburner', 'mdi-speedometer', 'frame rate and temperatures'),
};

/** Never offered: RigReady itself and the shells it might be started from. */
const NEVER = new Set(['rigready.exe', 'electron.exe']);

/**
 * Windows' own programs that also run from outside the Windows folder, or whose name is
 * one Windows uses: never on the user's own list of apps to offer, whatever that list
 * says. Stand down closes an app by its name, so an entry for one of these would close
 * part of Windows.
 */
const WINDOWS_OWN = new Set([
  'applicationframehost.exe',
  'audiodg.exe',
  'backgroundtaskhost.exe',
  'conhost.exe',
  'cscript.exe',
  'csrss.exe',
  'ctfmon.exe',
  'dllhost.exe',
  'dwm.exe',
  'explorer.exe',
  'fontdrvhost.exe',
  'lockapp.exe',
  'lsass.exe',
  'msedgewebview2.exe',
  'mshta.exe',
  'msiexec.exe',
  'openconsole.exe',
  'regsvr32.exe',
  'rundll32.exe',
  'runtimebroker.exe',
  'searchhost.exe',
  'searchindexer.exe',
  'securityhealthsystray.exe',
  'services.exe',
  'shellexperiencehost.exe',
  'shellhost.exe',
  'sihost.exe',
  'smartscreen.exe',
  'smss.exe',
  'spoolsv.exe',
  'startmenuexperiencehost.exe',
  'svchost.exe',
  'systemsettings.exe',
  'tabtip.exe',
  'taskhostw.exe',
  'taskmgr.exe',
  'textinputhost.exe',
  'userinit.exe',
  'wininit.exe',
  'winlogon.exe',
  'wmiprvse.exe',
  'wscript.exe',
]);
/** The command shells of Windows (the Command Prompt, both PowerShells): never offered either. */
const COMMAND_SHELL = /^(?:cmd|powershell|pwsh)\.exe$/;

const DRIVE_PATH = /^[a-z]:\\/i;

/**
 * Why a program may not go on the user's own list of apps to offer, or undefined when it
 * may. The one rule for both ways in: the "Always offer this app" button, and the list as
 * it is read back from disk, where a hand edit can put anything.
 */
export function refusedToRemember(
  name: string,
  exePath: string,
  windowsDir: string
): string | undefined {
  const key = name.toLowerCase();
  if (NEVER.has(key) || key.startsWith('rigready')) return 'it is RigReady itself';
  if (WINDOWS_OWN.has(key) || COMMAND_SHELL.test(key)) return 'it is part of Windows';
  if (!DRIVE_PATH.test(exePath)) return 'it does not run from a drive of this PC';
  if (WINDOWS_DIR.test(exePath) || isWithin(windowsDir, exePath)) {
    return 'it runs from the Windows folder';
  }
  if (!sameName(baseName(exePath), name)) return `its path does not end in ${name}`;
  return undefined;
}

const PROCESS_KEY = 'process:';

/**
 * Proposes the running apps; their paths are stored with a path variable where one applies.
 * With `own`, the apps the user asked to be offered are proposed like known helpers, and an
 * app RigReady does not know can be added to that list.
 */
export function createProcessCapture(games: GameRegistry, own?: OwnApps): CaptureDefinition {
  const capture = async (ctx: CheckContext): Promise<Result<CaptureCandidate[]>> => {
    const processes = await ctx.ports.processes.list();
    if (!processes.ok) return processes;
    const variables = await allPathVariables(ctx, games);
    const windowsDir = ctx.ports.folders.windows();
    const mine = own ? await own.read(windowsDir) : undefined;
    // A damaged list leaves the known apps as they are; its section in Settings says why.
    if (mine && !mine.ok) ctx.log.warn(`own apps not read: ${mine.error.message}`);
    const yours = mine?.ok ? mine.value.apps : [];
    const yoursFor = (process: ProcessInfo): OwnApp | undefined =>
      process.path === undefined
        ? undefined
        : yours.find((a) => sameName(a.name, process.name) && samePath(a.path, process.path!));
    // The copy the user asked for comes first when two programs have its name.
    const ordered = [...processes.value].sort(
      (a, b) => Number(yoursFor(b) !== undefined) - Number(yoursFor(a) !== undefined)
    );
    const byName = new Map<string, CaptureCandidate & { known: boolean; helper: boolean }>();
    for (const process of ordered) {
      // Only programs we could start again: a known path, and not part of Windows.
      if (!process.path || WINDOWS_DIR.test(process.path)) continue;
      const key = process.name.toLowerCase();
      if (byName.has(key) || NEVER.has(key)) continue;
      const known = KNOWN_APPS[key];
      const yourApp = known ? undefined : yoursFor(process);
      const isHelper = known?.helper === true || yourApp !== undefined;
      const close = known?.close === true || yourApp?.closeAtStandDown === true;
      const title = known?.name ?? yourApp?.title ?? process.name.replace(/\.exe$/i, '');
      const rememberable =
        own !== undefined &&
        !known &&
        refusedToRemember(process.name, process.path, windowsDir) === undefined;
      byName.set(key, {
        key: `${PROCESS_KEY}${key}`,
        group: 'apps',
        title,
        description: known?.purpose
          ? `For ${known.purpose} · ${process.name}`
          : yourApp
            ? `Always offered · ${process.path}`
            : process.path,
        selectedByDefault: isHelper,
        known: known !== undefined || yourApp !== undefined,
        helper: isHelper,
        program: process.name,
        generic: true,
        // What a rig usually runs is listed; the rest is behind "show all".
        tier: known || yourApp ? 'main' : 'more',
        icon: known?.icon ?? (yourApp ? 'mdi-pin-outline' : 'mdi-application-outline'),
        ...(known?.kind ? { kind: known.kind } : {}),
        ...(known?.games ? { forGames: known.games } : {}),
        ...(close ? { standDownNote: 'closed at Stand down' } : {}),
        ...(rememberable
          ? { remember: { capture: 'processes', remembered: yourApp !== undefined } }
          : {}),
        check: {
          type: PROCESS_RUNNING,
          title,
          required: true,
          params: {
            name: process.name,
            // A helper that is only useful in the sim is closed again by Stand down.
            ...(close ? { stopOnStandDown: true } : {}),
          },
          remediation: {
            type: PROCESS_LAUNCH,
            // The path Windows reports for the running program, never one that was typed.
            params: { exe: collapsePath(process.path, variables), args: [] },
          },
        },
      });
    }
    return ok(
      [...byName.values()]
        .sort(
          (a, b) =>
            Number(b.helper) - Number(a.helper) ||
            Number(b.known) - Number(a.known) ||
            a.title.localeCompare(b.title)
        )
        .map(({ known: _known, helper: _helper, ...candidate }) => candidate)
    );
  };
  return {
    id: 'processes',
    label: 'Apps',
    capture,
    ...(own ? { remember: (key, on, ctx) => rememberApp(own, capture, key, on, ctx) } : {}),
  };
}

/**
 * "Always offer this app": the running program goes on the user's own list with the path
 * Windows reports for it, or comes off it. Answers with the candidate as the capture now
 * proposes it, which reads the list back from disk; none when the program is not running.
 */
async function rememberApp(
  own: OwnApps,
  capture: (ctx: CheckContext) => Promise<Result<CaptureCandidate[]>>,
  key: string,
  on: boolean,
  ctx: CheckContext
): Promise<Result<{ candidate?: CaptureCandidate }>> {
  const name = key.startsWith(PROCESS_KEY) ? key.slice(PROCESS_KEY.length) : '';
  if (!name) return err('process.remember', 'That is not one of the running apps.');
  const windowsDir = ctx.ports.folders.windows();
  if (on) {
    const listed = await ctx.ports.processes.list();
    if (!listed.ok) return listed;
    // The same copy the capture lists: the first one of that name outside Windows.
    const running = listed.value.find(
      (p) => sameName(p.name, name) && p.path !== undefined && !WINDOWS_DIR.test(p.path)
    );
    if (!running?.path) {
      return err(
        'process.notRunning',
        `${name} is not running now, so RigReady cannot see where it is.`,
        'Start it, then choose "Always offer this app" again.'
      );
    }
    const known = KNOWN_APPS[name];
    if (known) return err('process.known', `RigReady offers ${known.name} already.`);
    const refused = refusedToRemember(running.name, running.path, windowsDir);
    if (refused) {
      return err('process.refused', `RigReady does not offer ${running.name}: ${refused}.`);
    }
    const added = await own.add(
      {
        name: running.name,
        title: running.name.replace(/\.exe$/i, ''),
        path: running.path,
        closeAtStandDown: false,
        added: ctx.ports.clock.now().toISOString(),
      },
      windowsDir
    );
    if (!added.ok) return added;
  } else {
    const removed = await own.remove(name, windowsDir);
    if (!removed.ok) return removed;
  }
  const again = await capture(ctx);
  if (!again.ok) return again;
  const candidate = again.value.find((c) => c.key === key);
  if (candidate && candidate.remember?.remembered !== on) {
    return err(
      'process.remember',
      on
        ? `RigReady could not keep ${name} on its list of apps to offer.`
        : `${name} is still on RigReady's list of apps to offer.`
    );
  }
  return ok(candidate ? { candidate } : {});
}
