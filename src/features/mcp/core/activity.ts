import { z } from 'zod';

/**
 * What assistants did, newest last: one entry per tool call, with who asked, what ran, how
 * it ended, and the Safety page groups (journal group ids) the call left behind, so a
 * change made through an assistant is attributed to it. Kept in memory for this run (the
 * log has every line too) and shown on the Settings page.
 */

export const ActivityOutcomeSchema = z.enum([
  'ok',
  'error',
  'denied',
  'timeout',
  'refused',
  'busy',
  'rate',
]);
export type ActivityOutcome = z.infer<typeof ActivityOutcomeSchema>;

export const ActivityEntrySchema = z.object({
  id: z.string(),
  time: z.string(),
  /** The pairing's name. */
  client: z.string(),
  tool: z.string(),
  /** The channel a channel tool or rigready_call reached. */
  channel: z.string().optional(),
  tier: z.enum(['read', 'change', 'launch', 'off']),
  /** One line: what was asked ("Make DCS F/A-18C ready"). */
  summary: z.string(),
  /** The call as it was made (a channel and its input), when the line above is in words. */
  detail: z.string().optional(),
  outcome: ActivityOutcomeSchema,
  /** The channel's answer in one line, or why it did not run. */
  message: z.string(),
  ms: z.number().int().min(0),
  /** Journal groups (Safety page actions) this call made. */
  journalGroups: z.array(z.string()).default([]),
});
export type ActivityEntry = z.infer<typeof ActivityEntrySchema>;

export class ActivityLog {
  private readonly entries: ActivityEntry[] = [];
  private readonly listeners = new Set<(entry: ActivityEntry) => void>();
  private counter = 0;

  constructor(private readonly keep = 200) {}

  nextId(): string {
    return `a${++this.counter}`;
  }

  record(entry: ActivityEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.keep) this.entries.splice(0, this.entries.length - this.keep);
    for (const listener of [...this.listeners]) listener(entry);
  }

  /** Newest first. */
  list(limit = 50): ActivityEntry[] {
    return [...this.entries].reverse().slice(0, limit);
  }

  count(): number {
    return this.entries.length;
  }

  onRecord(listener: (entry: ActivityEntry) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
