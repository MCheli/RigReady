import { channelName } from '../shared/ipc';
import type { IpcBinding } from './feature';
import type { Logger } from './logger';
import type { Clock } from './ports';

/**
 * A feature's channels with every failed answer written to the log at the normal level: the
 * channel, the error's code and its message. A diagnostics export then says what the user
 * was told and why, without the detailed log having been on.
 *
 * What is never in the line: the input (what the user typed, a key, a token) and the error's
 * detail (another program's own words; the feature logs those itself where it knows what
 * they may hold).
 *
 * A page that asks again every few seconds would fill the log with one answer, so the same
 * error of the same channel is written once, then counted, and written again with the count
 * when this much time has passed.
 */
export const SAME_FAILURE_EVERY_MS = 60_000;

/** The user's own Stop is not a failure: nothing is written for it. */
const QUIET: ReadonlySet<string> = new Set(['http.cancelled', 'ai.cancelled', 'ai.stopped']);

const MAX_MESSAGE = 300;

interface Failed {
  ok: false;
  error: { code: string; message: string };
}

function failed(answer: unknown): answer is Failed {
  if (!answer || typeof answer !== 'object') return false;
  const { ok, error } = answer as { ok?: unknown; error?: unknown };
  if (ok !== false || !error || typeof error !== 'object') return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return typeof code === 'string' && typeof message === 'string';
}

export function logFailures(binding: IpcBinding, log: Logger, clock: Clock): IpcBinding {
  const handlers: IpcBinding['handlers'] = {};
  const written = new Map<string, { at: number; since: number }>();
  for (const [key, handler] of Object.entries(binding.handlers)) {
    const channel = channelName(binding.contract.feature, key);
    handlers[key] = async (input: never) => {
      const answer = await handler(input);
      if (failed(answer) && !QUIET.has(answer.error.code)) {
        const { code, message } = answer.error;
        const now = clock.now().getTime();
        const before = written.get(`${channel} ${code}`);
        if (before && now - before.at < SAME_FAILURE_EVERY_MS) {
          before.since++;
        } else {
          log.info(`${channel} answered with an error`, {
            code,
            message: message.length > MAX_MESSAGE ? `${message.slice(0, MAX_MESSAGE)}…` : message,
            ...(before && before.since > 0 ? { moreSinceTheLastLine: before.since } : {}),
          });
          written.set(`${channel} ${code}`, { at: now, since: 0 });
        }
      }
      return answer;
    };
  }
  return { contract: binding.contract, handlers };
}
