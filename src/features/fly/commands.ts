import type { ChecklistReport, StepResult } from '../../core/checks/engine';
import {
  commandFailed,
  defineCommands,
  type CommandOutcome,
  type CommandShell,
  type PaletteCommand,
} from '../../shared/feature';
import type { GameKind } from '../../shared/models';
import { flyContract, type ProfileSummary } from './contract';

/**
 * The Fly screen's actions for the command palette: Make ready, Launch, Stand down and
 * Re-check for the setup in use, and a switch to every other setup. Each calls the same
 * channel the Fly screen calls and reports what that channel answered. Nobody can be asked
 * here, so, as from the tray, a fix or a step that runs a program is not run and is
 * reported as not run.
 */

const FLY = '/fly';
const GROUP = 'Fly';
const openFly = { label: 'Open Fly', to: FLY };

const count = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** "TrackIR, Pedals and 2 more". */
function names(titles: string[], max = 3): string {
  if (titles.length <= max) return titles.join(', ');
  return `${titles.slice(0, max).join(', ')} and ${titles.length - max} more`;
}

const notMet = (report: ChecklistReport): string[] =>
  report.results
    .filter((r) => r.required && !r.disabled && (r.status === 'fail' || r.status === 'error'))
    .map((r) => r.title);

const optionalNotMet = (report: ChecklistReport): string[] =>
  report.results
    .filter((r) => !r.required && !r.disabled && r.status !== 'pass')
    .map((r) => r.title);

/** The state of a setup as one line with its tone, in the Fly screen's own words. */
export function readiness(
  name: string,
  report: ChecklistReport
): Pick<CommandOutcome, 'tone' | 'text'> & { detail?: string } {
  if (!report.ready) {
    return {
      tone: 'bad',
      text: `${name} is not ready`,
      detail: `${count(report.failed, 'required item is', 'required items are')} not met: ${names(notMet(report))}.`,
    };
  }
  if (report.warnings > 0) {
    return {
      tone: 'warn',
      text: `${name} is ready with ${count(report.warnings, 'warning')}`,
      detail: `Optional: ${names(optionalNotMet(report))}.`,
    };
  }
  return { tone: 'ok', text: `${name} is ready` };
}

const ran = (steps: StepResult[]): StepResult[] => steps.filter((s) => !s.skipped);
const failedOf = (steps: StepResult[]): StepResult[] => ran(steps).filter((s) => !s.ok);
const skippedOf = (steps: StepResult[]): StepResult[] => steps.filter((s) => s.skipped);

const sentences = (parts: (string | undefined)[]): string =>
  parts.filter((p): p is string => p !== undefined && p !== '').join(' ');

async function makeReady(shell: CommandShell, setup: ProfileSummary): Promise<CommandOutcome> {
  shell.progress(`Making ${setup.name} ready…`);
  // No `approved`: nobody can be asked from here, so fixes that run a program are not run.
  const result = await shell.client(flyContract).makeReady({ profileId: setup.id });
  shell.machineChanged();
  if (!result.ok) return commandFailed(result.error, openFly);
  const { steps, report } = result.value;
  const state = readiness(setup.name, report);
  const failed = failedOf(steps);
  const skipped = skippedOf(steps);
  const worked = ran(steps).length - failed.length;
  const fixes =
    steps.length === 0
      ? report.ready
        ? 'Nothing needed fixing.'
        : 'There is nothing RigReady can fix.'
      : `${worked} of ${count(steps.length, 'fix', 'fixes')} worked.`;
  const detail = sentences([
    fixes,
    failed.length > 0
      ? `Failed: ${failed.map((s) => `${s.title} (${s.message})`).join('; ')}.`
      : '',
    skipped.length > 0 ? `Not run: ${skipped.map((s) => s.title).join(', ')}.` : '',
    state.detail,
  ]);
  const troubled = failed.length > 0 || skipped.length > 0;
  return {
    tone: state.tone === 'ok' && troubled ? 'warn' : state.tone,
    text: state.text,
    detail,
    ...(state.tone !== 'ok' || troubled ? { action: openFly } : {}),
  };
}

async function recheck(shell: CommandShell, setup: ProfileSummary): Promise<CommandOutcome> {
  shell.progress(`Checking ${setup.name}…`);
  // Looking is not using: the setup in use stays the one in use.
  const result = await shell.client(flyContract).check({ profileId: setup.id, remember: false });
  shell.machineChanged();
  if (!result.ok) return commandFailed(result.error, openFly);
  const state = readiness(setup.name, result.value);
  const checked = result.value.results.filter((r) => !r.disabled).length;
  return {
    tone: state.tone,
    text: state.text,
    detail: state.detail ?? `${count(checked, 'item')} checked, all in place.`,
    ...(state.tone !== 'ok' ? { action: openFly } : {}),
  };
}

async function launch(shell: CommandShell, setup: ProfileSummary): Promise<CommandOutcome> {
  const api = shell.client(flyContract);
  // Launch is never blocked, only warned: the state of the rig is read first so the outcome can say it.
  shell.progress(`Checking ${setup.name}…`);
  const before = await api.check({ profileId: setup.id, remember: false });
  shell.progress(`Launching ${setup.name}…`);
  const result = await api.launch({ profileId: setup.id, approved: [] });
  shell.machineChanged();
  if (!result.ok) return commandFailed(result.error, openFly);
  const { outcome, message, steps, postLaunchPending } = result.value;
  if (outcome === 'paused') {
    return {
      tone: 'warn',
      text: 'The game was not started',
      detail: `${message} That step is set to stop the launch. Launch anyway from the Fly screen.`,
      action: openFly,
    };
  }
  if (outcome === 'failed') return { tone: 'bad', text: message, action: openFly };
  const wasNotReady = before.ok && !before.value.ready;
  const failed = failedOf(steps);
  const skipped = skippedOf(steps);
  const detail = sentences([
    wasNotReady
      ? `It was not ready: ${count(before.value.failed, 'required item')} not met (${names(notMet(before.value))}).`
      : '',
    failed.length > 0
      ? `Failed: ${failed.map((s) => `${s.title} (${s.message})`).join('; ')}.`
      : '',
    skipped.length > 0 ? `Not run: ${skipped.map((s) => s.title).join(', ')}.` : '',
    postLaunchPending > 0
      ? `${count(postLaunchPending, 'step')} after launch ${postLaunchPending === 1 ? 'is' : 'are'} still to run.`
      : '',
  ]);
  const troubled = wasNotReady || failed.length > 0 || skipped.length > 0;
  return {
    tone: troubled ? 'warn' : 'ok',
    text: message,
    ...(detail ? { detail } : {}),
    ...(troubled ? { action: openFly } : {}),
  };
}

async function standDown(shell: CommandShell, setup: ProfileSummary): Promise<CommandOutcome> {
  const api = shell.client(flyContract);
  const game = await api.gameStatus({ profileId: setup.id });
  shell.progress(`Standing ${setup.name} down…`);
  // The game is never closed without being asked for: that question is the Fly screen's.
  const result = await api.standDown({ profileId: setup.id, closeGame: false });
  shell.machineChanged();
  if (!result.ok) return commandFailed(result.error, openFly);
  const failed = failedOf(result.value.steps);
  const stillRunning = game.ok && game.value.running;
  const detail = sentences([
    failed.length > 0
      ? `Needs attention: ${failed.map((s) => `${s.title} (${s.message})`).join('; ')}.`
      : '',
    stillRunning
      ? `${game.value.name ?? 'The game'} is still running and was left open; Stand down on the Fly screen can close it too.`
      : '',
  ]);
  return {
    tone: failed.length > 0 || stillRunning ? 'warn' : 'ok',
    text: `Stood down: ${result.value.headline}`,
    ...(detail ? { detail } : {}),
    ...(failed.length > 0 || stillRunning ? { action: openFly } : {}),
  };
}

async function switchTo(shell: CommandShell, setup: ProfileSummary): Promise<CommandOutcome> {
  shell.progress(`Switching to ${setup.name}…`);
  // Checking a setup makes it the one in use, as on the Fly screen and from the tray.
  const result = await shell.client(flyContract).check({ profileId: setup.id });
  if (!result.ok) return commandFailed(result.error, openFly);
  await shell.go(FLY);
  shell.machineChanged();
  const state = readiness(setup.name, result.value);
  return {
    tone: state.tone,
    text: `Now on the Fly screen: ${state.text}`,
    ...(state.detail ? { detail: state.detail } : {}),
  };
}

const when = (iso: string | undefined): string => {
  if (!iso) return 'not used yet';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'not used yet';
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? 'used today'
    : `used ${date.toLocaleDateString([], { day: 'numeric', month: 'short' })}`;
};

/** Kinds by game id, kept for the life of the window: what a game is never changes. */
const kinds = new Map<string, GameKind | undefined>();

export default defineCommands({
  feature: 'fly',

  async list(shell) {
    const state = await shell.client(flyContract).state();
    if (!state.ok) throw new Error(state.error.message);
    const { profiles, activeProfileId } = state.value;
    if (profiles.length === 0) {
      return [
        {
          id: 'fly.create',
          title: 'Create a setup from this rig',
          hint: 'No setups yet',
          icon: 'mdi-camera-iris',
          group: GROUP,
          to: '/configure/profiles/capture',
        },
      ];
    }
    const active = profiles.find((p) => p.id === activeProfileId);
    const commands: PaletteCommand[] = [];
    if (active) {
      const act = (
        id: string,
        title: string,
        icon: string,
        keywords: string[],
        run: (shell: CommandShell, setup: ProfileSummary) => Promise<CommandOutcome>
      ): PaletteCommand => ({
        id: `fly.${id}`,
        title,
        hint: active.name,
        icon,
        keywords,
        group: GROUP,
        run: (inner) => run(inner, active),
      });
      commands.push(
        act('makeReady', 'Make ready', 'mdi-wrench-check', ['fix', 'prepare', 'ready'], makeReady)
      );
      if (active.canLaunch) {
        commands.push(
          act('launch', 'Launch', 'mdi-rocket-launch', ['start', 'game', 'go'], launch)
        );
      }
      commands.push(
        act('standDown', 'Stand down', 'mdi-power-standby', ['desk', 'close', 'finish'], standDown),
        act('recheck', 'Re-check', 'mdi-refresh', ['check', 'refresh', 'status'], recheck)
      );
    }
    for (const setup of profiles) {
      if (setup.id === activeProfileId) continue;
      commands.push({
        id: `fly.switch.${setup.id}`,
        title: `Switch to ${setup.name}`,
        hint: [setup.gameName ?? 'No game', when(setup.lastUsed)].join(' · '),
        icon: 'mdi-swap-horizontal',
        keywords: ['setup', 'profile', 'change'],
        group: GROUP,
        run: (inner) => switchTo(inner, setup),
      });
    }
    return commands;
  },

  async setupKind(shell) {
    const api = shell.client(flyContract);
    const state = await api.state();
    if (!state.ok) return undefined;
    const game = state.value.profiles.find((p) => p.id === state.value.activeProfileId)?.game;
    if (!game) return undefined;
    if (!kinds.has(game)) {
      // Asked once per game: which games are flight and which are racing is the game modules' knowledge.
      const found = await api.welcome();
      if (!found.ok) return undefined;
      for (const known of found.value.games) kinds.set(known.id, known.kind);
      if (!kinds.has(game)) kinds.set(game, undefined);
    }
    return kinds.get(game);
  },
});
