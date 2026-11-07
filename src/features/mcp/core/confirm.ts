import { z } from 'zod';

/**
 * "Claude Code wants to make DCS F/A-18C ready. Allow?" The question is asked in RigReady's
 * own window, never through the assistant: a tool call that needs the user's yes waits
 * here until the window answers or the time runs out. One question at a time per client;
 * an unanswered one is a no.
 */

export const ConfirmRequestSchema = z.object({
  id: z.string(),
  /** The pairing's name. */
  client: z.string(),
  tool: z.string(),
  /** What it would do, in one line. */
  summary: z.string(),
  tier: z.enum(['change', 'launch']),
  /** Seconds until an unanswered question is a no. */
  seconds: z.number().int().min(1),
  askedAt: z.string(),
});
export type ConfirmRequest = z.infer<typeof ConfirmRequestSchema>;

export type ConfirmOutcome = 'allowed' | 'denied' | 'timeout';

interface Pending {
  request: ConfirmRequest;
  settle: (outcome: ConfirmOutcome) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class Confirmations {
  private readonly pending = new Map<string, Pending>();
  private counter = 0;

  constructor(
    private readonly deps: {
      now(): Date;
      /** Shows the question: an event to the windows, and the window brought forward. */
      show(request: ConfirmRequest): void;
      /** Tells the windows how a question ended, so an open dialog closes. */
      settled(id: string, outcome: ConfirmOutcome): void;
    }
  ) {}

  /** Asks, and resolves with the answer. Aborting the signal (the assistant gave up) is a no. */
  ask(
    question: Omit<ConfirmRequest, 'id' | 'askedAt'>,
    signal?: AbortSignal
  ): Promise<ConfirmOutcome> {
    const id = `c${++this.counter}`;
    const request: ConfirmRequest = { ...question, id, askedAt: this.deps.now().toISOString() };
    return new Promise<ConfirmOutcome>((resolve) => {
      const settle = (outcome: ConfirmOutcome): void => {
        const entry = this.pending.get(id);
        if (!entry) return;
        clearTimeout(entry.timer);
        this.pending.delete(id);
        signal?.removeEventListener('abort', onAbort);
        this.deps.settled(id, outcome);
        resolve(outcome);
      };
      const onAbort = (): void => settle('denied');
      const timer = setTimeout(() => settle('timeout'), question.seconds * 1000);
      // Nothing waits on a question when the app is quitting.
      timer.unref?.();
      this.pending.set(id, { request, settle, timer });
      if (signal?.aborted) {
        settle('denied');
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      this.deps.show(request);
    });
  }

  /** The window's answer. False when the question is not open (answered, timed out, unknown). */
  answer(id: string, allow: boolean): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;
    entry.settle(allow ? 'allowed' : 'denied');
    return true;
  }

  /** Questions still open, oldest first. */
  open(): ConfirmRequest[] {
    return [...this.pending.values()].map((p) => p.request);
  }

  /** On quit: every open question is a no. */
  dropAll(): void {
    for (const entry of [...this.pending.values()]) entry.settle('denied');
  }
}
