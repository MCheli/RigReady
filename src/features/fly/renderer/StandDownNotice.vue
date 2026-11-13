<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { standDownWaitText } from '../../../core/profile/standDownOnClose';
import { countdownTitle, stoodDownText } from '../core/sessionText';
import {
  cancelStandDown,
  counting,
  followStandDown,
  inMainWindow,
  problem,
  putAway,
  secondsLeft,
  session,
  standDownRead,
} from './standDownCountdown';

/**
 * Stand down by itself, on every page of the main window: the countdown after the game
 * closed, with Cancel; then "Standing down…"; then what it did, which stays until it is
 * read. Main owns the countdown and runs Stand down; this only shows it and sends Cancel.
 *
 * The notice lies over the bottom right corner of the page, and a page may have buttons of
 * its own there (the setup editor's Save and Cancel). So while it counts it can be put
 * away: the countdown and its Cancel are then in the app bar (StandDownBarItem.vue), which
 * lies over nothing. What Stand down did is always said here, put away or not.
 *
 * The compact view has no room for it: there the session line carries the countdown and
 * its Cancel. A small panel of its own (a popped-out sheet) shows nothing: the main window
 * is brought forward when the countdown starts.
 */
const router = useRouter();
const mainWindow = inMainWindow();

const result = computed(() => {
  const down = session.value.phase === 'ended' ? session.value.stoodDown : undefined;
  if (!down) return undefined;
  const said = stoodDownText(down);
  return {
    ...said,
    icon: said.ok ? 'mdi-check-circle' : down.finished ? 'mdi-alert' : 'mdi-close-circle',
    tone: said.ok ? 'rr-ok' : down.finished ? 'rr-warn' : 'rr-bad',
  };
});
const standingDown = computed(
  () => session.value.phase === 'ended' && session.value.standingDown === true
);
const shown = computed(
  () =>
    mainWindow &&
    ((counting.value && !putAway.value) || standingDown.value || result.value !== undefined)
);

const game = computed(() => session.value.gameName ?? 'The game');
const setup = computed(() => session.value.profileName ?? 'this setup');

/**
 * Said once to a screen reader when the notice changes; the ticking heading is not read
 * out every second.
 */
const announcement = computed(() => {
  if (standingDown.value) return 'Standing down.';
  if (result.value) return [result.value.title, ...result.value.lines].join('. ');
  if (counting.value) {
    const wait = standDownWaitText(session.value.standDownSeconds ?? 60);
    return `${game.value} has closed. Stand down starts in ${wait} unless you cancel.`;
  }
  return '';
});

let unfollow: (() => void) | undefined;
onMounted(() => {
  if (mainWindow) unfollow = followStandDown();
});
onBeforeUnmount(() => unfollow?.());

function editSetup(): void {
  if (session.value.profileId) void router.push(`/configure/profiles/${session.value.profileId}`);
}
</script>

<template>
  <div
    v-if="shown"
    class="sd-notice rr-panel"
    role="group"
    aria-label="Stand down"
    data-testid="stand-down-notice"
    :data-state="counting ? 'counting' : standingDown ? 'running' : 'result'"
  >
    <span class="rr-sr-only" role="status" aria-live="polite">{{ announcement }}</span>

    <template v-if="standingDown">
      <div class="sd-head">
        <v-progress-circular indeterminate size="18" width="2" aria-hidden="true" />
        <span class="sd-title" data-testid="stand-down-notice-title">Standing down…</span>
      </div>
      <div class="sd-text">
        {{ setup }}: closing the helper apps and putting the rig back. What was done is shown here
        when it has finished.
      </div>
    </template>

    <template v-else-if="result">
      <div class="sd-head">
        <v-icon :icon="result.icon" size="20" :class="result.tone" />
        <span class="sd-title" data-testid="stand-down-notice-title">{{ result.title }}</span>
      </div>
      <div class="sd-text">{{ setup }}, after {{ game }} closed.</div>
      <ul class="sd-lines" data-testid="stand-down-notice-lines">
        <li v-for="(line, index) in result.lines" :key="index">{{ line }}</li>
      </ul>
      <div v-if="problem" class="sd-problem rr-bad">{{ problem }}</div>
      <div class="sd-actions">
        <v-btn
          size="small"
          variant="tonal"
          data-testid="stand-down-notice-ok"
          @click="standDownRead"
        >
          OK
        </v-btn>
      </div>
    </template>

    <template v-else>
      <div class="sd-head">
        <v-icon icon="mdi-power" size="20" class="sd-icon" />
        <!-- A heading that ticks is not read out every second; the line above says it once. -->
        <span class="sd-title" role="timer" aria-live="off" data-testid="stand-down-notice-title">
          {{ countdownTitle(secondsLeft ?? 0) }}
        </span>
        <v-btn
          icon="mdi-window-minimize"
          variant="text"
          size="x-small"
          aria-label="Move the countdown to the top bar"
          title="Move the countdown to the top bar"
          data-testid="stand-down-notice-away"
          @click="putAway = true"
        />
      </div>
      <div class="sd-text" data-testid="stand-down-notice-text">
        {{ game }} has closed. When the time is up, RigReady stands down {{ setup }}: it closes the
        helper apps and puts the rig back, as the Stand down button does.
      </div>
      <div v-if="problem" class="sd-problem rr-bad">{{ problem }}</div>
      <div class="sd-actions">
        <v-btn
          size="small"
          variant="flat"
          color="primary"
          aria-label="Cancel Stand down"
          data-testid="stand-down-notice-cancel"
          @click="cancelStandDown"
        >
          Cancel
        </v-btn>
        <v-btn
          v-if="session.profileId"
          size="small"
          variant="text"
          data-testid="stand-down-notice-edit"
          @click="editSetup"
        >
          Change this for the setup
        </v-btn>
      </div>
    </template>
  </div>
</template>

<style scoped>
.sd-notice {
  position: fixed;
  right: 20px;
  bottom: 20px;
  /* Above dialogs, under a toast and the error notice. */
  z-index: 2900;
  width: 400px;
  max-width: calc(100vw - 40px);
  padding: 14px 16px;
  border-color: var(--rr-border-strong);
  box-shadow: var(--rr-elev-2);
  background: var(--rr-surface-2);
}
.sd-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.sd-icon {
  color: var(--rr-accent);
}
.sd-title {
  flex: 1;
  font-size: 15px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.sd-text {
  margin-top: 6px;
  font-size: 13px;
  line-height: 1.45;
  color: var(--rr-text-2);
  overflow-wrap: anywhere;
}
.sd-lines {
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
  font-size: 13px;
  line-height: 1.45;
  max-height: 30vh;
  overflow-y: auto;
  overflow-wrap: anywhere;
}
.sd-lines li + li {
  margin-top: 4px;
}
.sd-problem {
  margin-top: 6px;
  font-size: 12.5px;
}
.sd-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}
</style>
