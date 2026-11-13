import { computed, ref, watch } from 'vue';
import { errorText, useClient } from '../../../renderer/ipc';
import { flyContract, type SessionState } from '../contract';
import { countdownLeft } from '../core/sessionText';

/**
 * What the Stand down notice and its short form in the app bar both show: the session as
 * main last said it, and the clock while something counts down. Main owns the countdown
 * and runs Stand down; the window only shows it and sends Cancel.
 *
 * There is one copy for the window, because the notice and the bar item are two places for
 * one thing: the notice lies over the bottom right corner of the page, where a page may
 * have its own buttons (the setup editor's Save and Cancel are there), so it can be put
 * away, and the same countdown with the same Cancel is then in the app bar, which lies
 * over nothing.
 */

/** The session of the moment, as main last said it. */
export const session = ref<SessionState>({ phase: 'idle' });
/** What went wrong with the last Cancel or OK, said in the notice. */
export const problem = ref<string>();
/** True while the user has put the notice away. The app bar carries the countdown then. */
export const putAway = ref(false);

const now = ref(Date.now());

/** Seconds until Stand down starts; undefined when nothing is counting down. */
export const secondsLeft = computed(() => {
  const s = session.value;
  if (s.phase !== 'ended' || !s.standDownAt || s.standingDown || s.stoodDown) return undefined;
  return countdownLeft(s.standDownAt, now.value, s.standDownSeconds);
});
export const counting = computed(() => secondsLeft.value !== undefined);

/**
 * The main window only. The compact view has no room for the notice: there the session
 * line carries the countdown and its Cancel. A small panel of its own (a popped-out sheet)
 * shows nothing: the main window is brought forward when the countdown starts.
 */
export function inMainWindow(): boolean {
  const hash = window.location.hash;
  return !hash.startsWith('#/fly/compact') && !hash.includes('popped=1');
}

let client: ReturnType<typeof connect> | undefined;
const connect = () => useClient(flyContract);
const api = (): ReturnType<typeof connect> => (client ??= connect());

function take(next: SessionState): void {
  session.value = next;
  problem.value = undefined;
}

let shownIn = 0;
let stop: (() => void) | undefined;

/**
 * Called by each place that shows the countdown when it is put on the screen. Hands back
 * what to call when that place goes away.
 */
export function followStandDown(): () => void {
  if (shownIn++ === 0) {
    let ticker: ReturnType<typeof setInterval> | undefined;
    const off = api().on('session', take);
    // A window opened, or reloaded, while it counts down shows it too.
    void api()
      .session()
      .then((current) => {
        if (current.ok) take(current.value);
      });
    // The clock runs only while something counts down.
    const unwatch = watch(
      counting,
      (on) => {
        clearInterval(ticker);
        ticker = undefined;
        if (!on) {
          // What Stand down did is said in the notice, and so is the next countdown.
          putAway.value = false;
          return;
        }
        now.value = Date.now();
        ticker = setInterval(() => (now.value = Date.now()), 250);
      },
      { immediate: true }
    );
    stop = () => {
      off();
      unwatch();
      clearInterval(ticker);
    };
  }
  return () => {
    if (--shownIn > 0) return;
    stop?.();
    stop = undefined;
  };
}

/**
 * Ends the countdown. Main answers with the session as it is now. A failure is said in the
 * notice, which comes back for it.
 */
export async function cancelStandDown(): Promise<void> {
  const next = await api().cancelStandDown();
  if (next.ok) {
    take(next.value);
    return;
  }
  problem.value = errorText(next.error);
  putAway.value = false;
}

/** What Stand down did was read: the notice, and "Welcome back", go away. */
export async function standDownRead(): Promise<void> {
  const next = await api().dismissSession();
  if (next.ok) take(next.value);
  else problem.value = errorText(next.error);
}
