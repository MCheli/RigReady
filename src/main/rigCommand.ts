import { resolveSetup, type ParsedCommandLine, type RigCommand } from '../core/commandLine';
import type { CommandRun, CommandStep } from '../shared/appContract';
import type { Envelope } from '../shared/ipc';

/**
 * Runs a command RigReady was started with: `--fly`, `--make-ready`, `--setup` (a desktop
 * shortcut, a Jump List task, the hotkey, a command typed by hand).
 *
 * It is the flow the Fly screen and the tray already have, through the same handlers:
 * check, Make ready (fixes in order; a monitor layout still asks "Keep this layout?"), and
 * for `--fly` the launch. One rule of its own: the game is launched only when every required
 * item is met. Anything else stops with the window in front and the reason on it.
 *
 * Free of Electron, so it runs in unit tests on the wired features.
 */

export interface CommandDeps {
  /** An IPC channel of the wired features, by name: what the window itself would call. */
  call(channel: string, input?: unknown): Promise<Envelope>;
  /** Tells the window where the command has got to. */
  publish(run: CommandRun): void;
  /** Brings RigReady's window to the front. */
  showWindow(): void;
  /** The Fly screen picks up the setup the command chose and what it changed. */
  flyChanged(): void;
  /** True while the tray or the window is already making ready, launching or standing down. */
  busy?(): boolean;
  /** Called when a command starts and ends, so the tray can say "Working". */
  working?(on: boolean): void;
}

interface Setup {
  id: string;
  name: string;
  canLaunch: boolean;
}

interface ItemResult {
  itemId: string;
  title: string;
  required: boolean;
  status: string;
  summary: string;
  disabled?: boolean;
}

interface Report {
  ready: boolean;
  failed: number;
  warnings: number;
  fixable: number;
  results: ItemResult[];
}

interface Step {
  itemId: string;
  title: string;
  ok: boolean;
  message: string;
  skipped?: boolean;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;

const errorLine = (envelope: Envelope & { ok: false }): string =>
  envelope.error.detail
    ? `${envelope.error.message} ${envelope.error.detail}`
    : envelope.error.message;

const stepState = (step: Step): CommandStep['state'] =>
  step.skipped ? 'skipped' : step.ok ? 'done' : 'failed';

/** The required items a report says are not met, one line each, with what its fix said. */
export function notMetReasons(report: Report, steps: Step[] = []): string[] {
  return report.results
    .filter((r) => r.required && !r.disabled && r.status !== 'pass')
    .map((r) => {
      const tried = steps.find((s) => s.itemId === r.itemId && !s.ok);
      return tried ? `${r.title}: ${r.summary}. ${tried.message}` : `${r.title}: ${r.summary}`;
    });
}

/** The optional items a report says are not met, as one line; undefined when there are none. */
export function warningLine(report: Report): string | undefined {
  const names = report.results
    .filter((r) => !r.required && !r.disabled && r.status !== 'pass')
    .map((r) => r.title);
  if (names.length === 0) return undefined;
  return `${plural(names.length, 'optional item is', 'optional items are')} not met: ${names.join(', ')}`;
}

export class CommandRunner {
  private current: CommandRun | null = null;
  private counter = 0;
  private cancelled = false;

  constructor(private readonly deps: CommandDeps) {}

  /** The command of this start or the last one, for a window that opens after it began. */
  state(): CommandRun | null {
    return this.current ? structuredClone(this.current) : null;
  }

  running(): boolean {
    return this.current !== null && this.current.outcome === undefined;
  }

  /** "Do not launch": true when the running command will now stop before the game. */
  cancel(): boolean {
    if (!this.current || !this.running() || !this.current.canCancel) return false;
    this.cancelled = true;
    this.update({ canCancel: false, headline: this.doing(this.current.phase) });
    return true;
  }

  /**
   * The Make ready and Launch progress the features report while a command runs. Events of
   * any other run (the window's own Make ready) are not this command's.
   */
  onEvent(channel: string, payload: unknown): void {
    const run = this.current;
    const event = record(payload);
    if (!run || run.outcome || !event || event['runId'] !== this.runId()) return;
    const state = event['state'];
    const title = event['title'];
    if (typeof title !== 'string' || typeof state !== 'string') return;
    let id: string | undefined;
    if (channel === 'fly:event:progress' && typeof event['itemId'] === 'string') {
      id = event['itemId'];
    } else if (channel === 'fly:event:launchProgress' && typeof event['id'] === 'string') {
      id = `${String(event['phase'])}:${event['id']}`;
    }
    if (id === undefined) return;
    const step: CommandStep = {
      id,
      title,
      state: state as CommandStep['state'],
      ...(typeof event['message'] === 'string' ? { message: event['message'] } : {}),
    };
    const steps = [...run.steps];
    const at = steps.findIndex((s) => s.id === id);
    if (at >= 0) steps[at] = step;
    else steps.push(step);
    this.update({ steps });
  }

  /** What the arguments of a start ask for. Does nothing when they ask for nothing. */
  async handle(parsed: ParsedCommandLine): Promise<CommandRun | null> {
    if (parsed.kind === 'none') return null;
    if (parsed.kind === 'problem') {
      this.deps.showWindow();
      if (this.running()) return this.state();
      this.begin({ action: 'select', setup: '' });
      return this.finish('stopped', 'warn', parsed.message, [
        'RigReady.exe --fly "<setup>" makes the rig ready and launches. --make-ready stops before launching. --setup only shows the setup.',
      ]);
    }
    return this.run(parsed.command);
  }

  async run(command: RigCommand): Promise<CommandRun | null> {
    this.deps.showWindow();
    // One at a time: what is running goes on, and the window that came forward shows it.
    if (this.running() || this.deps.busy?.()) return this.state();
    this.begin(command);
    this.deps.working?.(true);
    try {
      return await this.go(command);
    } catch (e) {
      return this.finish('stopped', 'bad', 'RigReady could not finish this', [
        e instanceof Error ? e.message : String(e),
      ]);
    } finally {
      this.deps.working?.(false);
      // The Fly screen shows what the command left behind.
      this.deps.flyChanged();
    }
  }

  private runId(): string {
    return `command-${this.current?.id ?? 0}`;
  }

  private name(): string {
    return this.current?.setup?.name ?? this.current?.asked ?? 'The setup';
  }

  /** What is going on, in one line; it says so once "Do not launch" was pressed. */
  private doing(phase: CommandRun['phase']): string {
    const doing =
      phase === 'makingReady'
        ? `Making ${this.name()} ready`
        : phase === 'launching'
          ? `Launching ${this.name()}`
          : `Checking ${this.name()}`;
    return this.cancelled ? `${doing}. It will not be launched` : doing;
  }

  private begin(command: RigCommand): void {
    this.cancelled = false;
    this.current = {
      id: ++this.counter,
      action: command.action,
      asked: command.setup,
      phase: 'checking',
      tone: 'idle',
      headline: command.setup ? `Looking for ${command.setup}` : 'Reading the command',
      reasons: [],
      steps: [],
      canCancel: false,
    };
    this.deps.publish(structuredClone(this.current));
  }

  private update(patch: Partial<CommandRun>): void {
    if (!this.current) return;
    this.current = { ...this.current, ...patch };
    this.deps.publish(structuredClone(this.current));
  }

  private finish(
    outcome: NonNullable<CommandRun['outcome']>,
    tone: CommandRun['tone'],
    headline: string,
    reasons: string[] = []
  ): CommandRun {
    this.update({ phase: 'finished', outcome, tone, headline, reasons, canCancel: false });
    // Whatever stopped it is on the window, so the window is where the user is looking.
    if (outcome === 'stopped') this.deps.showWindow();
    return this.state()!;
  }

  private async go(command: RigCommand): Promise<CommandRun> {
    const { call } = this.deps;
    const fly = command.action === 'fly';

    // ---- which setup ----
    const state = await call('fly:state');
    if (!state.ok)
      return this.finish('stopped', 'bad', 'The setups could not be read', [errorLine(state)]);
    const listed = record(state.value)?.['profiles'];
    const setups: Setup[] = (Array.isArray(listed) ? listed : [])
      .map(record)
      .filter((p): p is Record<string, unknown> => typeof p?.['id'] === 'string')
      .map((p) => ({
        id: p['id'] as string,
        name: typeof p['name'] === 'string' ? p['name'] : (p['id'] as string),
        canLaunch: p['canLaunch'] === true,
      }));
    const found = resolveSetup(command.setup, setups);
    if (!found.ok) {
      const names = setups.map((s) => s.name);
      return this.finish('stopped', 'warn', found.message.replace(/\.$/, ''), [
        found.reason === 'ambiguous'
          ? found.message
          : names.length > 0
            ? `Setups on this PC: ${names.join(', ')}.`
            : 'No setup has been created yet. Create one from this rig first.',
      ]);
    }
    const setup = found.setup;
    const profileId = setup.id;
    this.update({ setup: { id: setup.id, name: setup.name }, canCancel: fly });
    this.update({ headline: this.doing('checking') });

    // ---- check: this also makes it the setup in use, on the Fly screen and in the tray ----
    const checked = await call('fly:check', { profileId });
    await call('fly:state');
    this.deps.flyChanged();
    if (!checked.ok) {
      return this.finish('stopped', 'bad', `${setup.name} could not be checked`, [
        errorLine(checked),
      ]);
    }
    let report = checked.value as Report;
    if (command.action === 'select')
      return this.finish('selected', 'idle', `Showing ${setup.name}`);

    // ---- make ready: every fix there is, in order, exactly as the Make ready button ----
    let steps: Step[] = [];
    if (!report.ready || report.fixable > 0) {
      this.update({ phase: 'makingReady', headline: this.doing('makingReady') });
      const made = await call('fly:makeReady', { profileId, runId: this.runId() });
      if (!made.ok) {
        return this.finish('stopped', 'bad', `Make ready did not finish for ${setup.name}`, [
          errorLine(made),
        ]);
      }
      const value = made.value as { steps: Step[]; report: Report };
      steps = value.steps;
      report = value.report;
      this.update({
        steps: steps.map((s) => ({
          id: s.itemId,
          title: s.title,
          state: stepState(s),
          message: s.message,
        })),
      });
    }
    const warnings = warningLine(report);
    if (!report.ready) {
      const count = plural(report.failed, 'required item is', 'required items are');
      return this.finish(
        'stopped',
        'bad',
        fly
          ? `${setup.name} was not launched: ${count} not met`
          : `${setup.name} is not ready: ${count} not met`,
        notMetReasons(report, steps)
      );
    }
    if (!fly) {
      return this.finish(
        'ready',
        warnings ? 'warn' : 'ok',
        `${setup.name} is ready`,
        warnings ? [warnings] : []
      );
    }

    // ---- launch: only now, with every required item met ----
    if (this.cancelled) {
      return this.finish('cancelled', 'idle', `${setup.name} is ready. Not launched, as you asked`);
    }
    if (!setup.canLaunch) {
      return this.finish(
        'stopped',
        'warn',
        `${setup.name} is ready, but it has nothing to launch`,
        ['Choose what Launch starts in the setup editor.']
      );
    }
    this.update({ phase: 'launching', headline: this.doing('launching'), canCancel: false });
    const launched = await call('fly:launch', { profileId, runId: this.runId() });
    if (!launched.ok) {
      return this.finish('stopped', 'bad', `${setup.name} was not launched`, [errorLine(launched)]);
    }
    const result = launched.value as { outcome: string; message: string };
    if (result.outcome !== 'launched') {
      return this.finish('stopped', 'bad', `${setup.name} was not launched`, [
        result.message,
        ...(result.outcome === 'paused'
          ? ['Press Launch on the Fly screen to decide whether to launch anyway.']
          : []),
      ]);
    }
    return this.finish(
      'launched',
      warnings ? 'warn' : 'ok',
      result.message,
      warnings ? [warnings] : []
    );
  }
}
