/**
 * What RigReady can be started to do at once. A desktop shortcut, a Jump List task and a
 * command typed by hand all say it the same way:
 *
 *   RigReady.exe --fly "<setup id or name>"          make the rig ready, then launch
 *   RigReady.exe --make-ready "<setup id or name>"   make the rig ready, stop before launching
 *   RigReady.exe --setup "<setup id or name>"        only show that setup
 *
 * Pure: the same functions read the arguments of a cold start and of a second start that
 * hands over to the RigReady already running.
 */

export type RigAction = 'fly' | 'makeReady' | 'select';

export interface RigCommand {
  action: RigAction;
  /** The setup as it was asked for: its id or its name. */
  setup: string;
}

export type ParsedCommandLine =
  | { kind: 'none' }
  | { kind: 'command'; command: RigCommand }
  /** The arguments ask for something but cannot be followed; `message` says why. */
  | { kind: 'problem'; message: string };

const FLAGS: Record<RigAction, string> = {
  fly: '--fly',
  makeReady: '--make-ready',
  select: '--setup',
};
const ACTIONS = Object.keys(FLAGS) as RigAction[];

const usage = (flag: string): string => `${flag} needs a setup: RigReady.exe ${flag} "<setup>"`;

/**
 * Reads the action out of a program's arguments. Everything it does not know (the program
 * itself, Chromium's own switches, --hidden) is left alone. A flag takes its setup from the
 * next argument or after an equals sign: `--fly "DCS F/A-18C"` and `--fly=dcs-f-a-18c`.
 */
export function parseCommandLine(argv: readonly string[]): ParsedCommandLine {
  const found: RigCommand[] = [];
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]!;
    for (const action of ACTIONS) {
      const flag = FLAGS[action];
      let value: string | undefined;
      if (token === flag) {
        const next = argv[index + 1];
        // Another switch is not a setup: "--fly --hidden" names none.
        if (next === undefined || next.startsWith('--'))
          return { kind: 'problem', message: usage(flag) };
        value = next;
        index++;
      } else if (token.startsWith(`${flag}=`)) {
        value = token.slice(flag.length + 1);
      } else {
        continue;
      }
      const setup = value
        .trim()
        .replace(/^"(.*)"$/, '$1')
        .trim();
      if (setup.length === 0) return { kind: 'problem', message: usage(flag) };
      found.push({ action, setup });
      break;
    }
  }
  if (found.length === 0) return { kind: 'none' };
  if (found.length > 1) {
    return {
      kind: 'problem',
      message: `Use only one of ${ACTIONS.map((a) => FLAGS[a]).join(', ')} at a time.`,
    };
  }
  return { kind: 'command', command: found[0]! };
}

/**
 * The arguments that ask for a command, as one value: a shortcut and a Jump List task carry
 * it this way, so nothing can come between the flag and its setup.
 */
export function commandArgs(command: RigCommand): string[] {
  return [`${FLAGS[command.action]}=${command.setup}`];
}

export interface SetupRef {
  id: string;
  name: string;
}

export type ResolvedSetup<T extends SetupRef> =
  { ok: true; setup: T } | { ok: false; reason: 'unknown' | 'ambiguous'; message: string };

/**
 * The setup a command means: its id first, then its name (capitals do not matter). A name
 * two setups share is not guessed at.
 */
export function resolveSetup<T extends SetupRef>(
  asked: string,
  setups: readonly T[]
): ResolvedSetup<T> {
  const wanted = asked.trim().toLowerCase();
  const byId = setups.find((s) => s.id.toLowerCase() === wanted);
  if (byId) return { ok: true, setup: byId };
  const byName = setups.filter((s) => s.name.trim().toLowerCase() === wanted);
  if (byName.length === 1) return { ok: true, setup: byName[0]! };
  if (byName.length > 1) {
    return {
      ok: false,
      reason: 'ambiguous',
      message: `${byName.length} setups are named "${asked}". Use the id of the one you mean: ${byName
        .map((s) => s.id)
        .join(', ')}.`,
    };
  }
  return { ok: false, reason: 'unknown', message: `There is no setup "${asked}".` };
}
