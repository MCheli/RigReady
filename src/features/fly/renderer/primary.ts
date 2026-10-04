import { computed, ref, watchEffect, type ComputedRef, type Ref } from 'vue';
import type { useFlyStore } from './store';

/**
 * What the Fly screen and the compact view have in common: the readiness in words, the one
 * primary action, and Enter running it.
 */

type FlyStore = ReturnType<typeof useFlyStore>;

export type ActionId = 'readyAndLaunch' | 'makeReady' | 'launch' | 'standDown';

export const ACTION_LABEL: Record<ActionId, string> = {
  readyAndLaunch: 'Make ready and launch',
  makeReady: 'Make ready',
  launch: 'Launch',
  standDown: 'Stand down',
};

export interface Headline {
  tone: 'ok' | 'warn' | 'bad' | 'idle';
  icon: string;
  title: string;
  /** How many items the state is about (required ones not met, or optional ones). */
  count?: number;
  sub: string;
}

/** The state of the rig as an icon and words. */
export function useHeadline(fly: FlyStore): ComputedRef<Headline> {
  return computed(() => {
    const counts = fly.counts;
    if (fly.readiness === 'notReady') {
      return {
        tone: 'bad',
        icon: 'mdi-close-circle',
        title: 'Not ready',
        count: counts.failed,
        sub: `${counts.failed} required ${counts.failed === 1 ? 'item is' : 'items are'} not met${
          counts.warnings > 0 ? ` · ${counts.warnings} optional` : ''
        }${fly.anyChecking ? ' · still checking' : ''}`,
      };
    }
    if (fly.readiness === 'warnings') {
      return {
        tone: 'warn',
        icon: 'mdi-check-circle',
        title: 'Ready with warnings',
        count: counts.warnings,
        sub: `${counts.warnings} optional ${counts.warnings === 1 ? 'item needs' : 'items need'} attention`,
      };
    }
    if (fly.readiness === 'ready') {
      return {
        tone: 'ok',
        icon: 'mdi-check-circle',
        title: 'Ready',
        sub:
          fly.items.length === 0
            ? 'This setup has nothing to check'
            : 'Everything this setup needs is in place',
      };
    }
    return {
      tone: 'idle',
      icon: 'mdi-timer-sand',
      title: 'Checking…',
      sub: `${counts.checked} of ${fly.items.length} checked`,
    };
  });
}

/**
 * What the screen is for right now, and what Enter runs. A rig that is not ready and can
 * be fixed: fix it and launch. Otherwise: launch (with the warning while something
 * required is missing). A setup with nothing to launch: Make ready, when there is
 * something to fix. While the game runs: nothing. Once it has closed: Stand down.
 *
 * `now` follows the state; `shown` holds still while an action is at work, so the buttons
 * do not change places under the user's hand.
 */
export function usePrimary(fly: FlyStore): {
  now: ComputedRef<ActionId | undefined>;
  shown: Ref<ActionId | undefined>;
} {
  const now = computed<ActionId | undefined>(() => {
    const setup = fly.active;
    if (!setup) return undefined;
    const session = fly.session;
    if (session.profileId === setup.id) {
      // Enter must never start a second copy of a game that is running.
      if (session.phase === 'running' || session.phase === 'starting') return undefined;
      // The game has closed: what is left is to put the rig back, unless that already happened.
      if (session.phase === 'ended' && !session.stoodDown) return 'standDown';
    }
    const fixable = fly.counts.fixable > 0;
    if (!setup.canLaunch) return fixable ? 'makeReady' : undefined;
    return fly.readiness === 'notReady' && fixable ? 'readyAndLaunch' : 'launch';
  });
  const shown = ref<ActionId>();
  watchEffect(() => {
    if (fly.busy === null) shown.value = now.value;
  });
  return { now, shown };
}

/** A focused control keeps Enter for itself. */
const KEEPS_ENTER =
  'a, button, input, select, textarea, summary, [role="button"], [role="combobox"], [role="option"], [role="menuitem"], [role="tab"], [contenteditable]';

/**
 * Enter runs the primary action when nothing has the focus. A focused control keeps Enter,
 * and so does an open dialog or menu: its own buttons answer. Returns what stops listening.
 */
export function listenForEnter(run: () => void, available: () => boolean): () => void {
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' || event.repeat || event.defaultPrevented) return;
    if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(KEEPS_ENTER)) return;
    if (document.querySelector('.v-overlay--active.v-dialog, .v-overlay--active.v-menu')) return;
    if (!available()) return;
    event.preventDefault();
    run();
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
