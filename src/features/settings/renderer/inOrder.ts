/**
 * Changes sent one at a time, in the order they were made.
 *
 * A switch on the Settings page moves when it is clicked and the change follows. Two
 * changes under way at once would be applied in whatever order they happened to finish
 * (Start with Windows writes to the registry, reads it back and then saves): the later
 * click could lose. Sent in order, the last click is what holds.
 *
 * Each change is told whether it was the last one waiting when it was answered. Only the
 * last answer is the state to show; an earlier one describes a moment the user has already
 * clicked past.
 */
export class InOrder {
  private turn: Promise<unknown> = Promise.resolve();
  private waiting = 0;

  /** True while a change has been made that is not answered yet. */
  get busy(): boolean {
    return this.waiting > 0;
  }

  send<R>(change: () => Promise<R>): Promise<{ result: R; last: boolean }> {
    this.waiting++;
    const run = async (): Promise<{ result: R; last: boolean }> => {
      try {
        const result = await change();
        return { result, last: this.waiting === 1 };
      } finally {
        this.waiting--;
      }
    };
    const done = this.turn.then(run, run);
    // Whoever made this change gets its failure (through `done`); the next one only waits for it.
    this.turn = done.catch(() => undefined);
    return done;
  }
}
