<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { GameKind } from '../../../shared/models';
import type { SessionState } from '../contract';
import {
  clockText,
  countdownLeft,
  countdownTitle,
  durationText,
  elapsedText,
  standDownHeldText,
  stoodDownLine,
  stoodDownText,
} from '../core/sessionText';
import { secondsLeft as noticeSecondsLeft } from './standDownCountdown';

/**
 * The session of the moment, under the readiness: the game running with its clock, or
 * "Welcome back" with how long it was once the game has closed. Under "Welcome back", one
 * line says where Stand down by itself stands: counting down, running, what it did, or why
 * it is not going to run this time.
 */
const props = defineProps<{
  session: SessionState;
  /** The family of sims the game belongs to, for the picture beside "Welcome back". */
  kind?: GameKind | undefined;
  /**
   * In the compact view: short lines and no Dismiss. Cancel for the countdown is here,
   * because the notice that carries it in the main window is not shown in this one.
   */
  compact?: boolean;
}>();
const emit = defineEmits<{ dismiss: []; cancel: [] }>();

/** True while it counts down to a Stand down by itself. */
const countingDown = computed(() => {
  const s = props.session;
  return s.standDownAt !== undefined && !s.standingDown && !s.stoodDown;
});

/**
 * The clock of this line: once a second for the time in session, and four times a second
 * while it counts down, read afresh when the countdown starts. A clock a second behind
 * would start a countdown of one minute at "1 minute 1 second".
 */
const now = ref(Date.now());
let tick: ReturnType<typeof setInterval> | undefined;
function tickEvery(ms: number): void {
  clearInterval(tick);
  now.value = Date.now();
  tick = setInterval(() => (now.value = Date.now()), ms);
}
onMounted(() => tickEvery(countingDown.value ? 250 : 1000));
watch(countingDown, (on) => tickEvery(on ? 250 : 1000));
onBeforeUnmount(() => clearInterval(tick));

const game = computed(() => props.session.gameName ?? props.session.profileName ?? 'The game');
const since = computed(() =>
  props.session.startedAt ? clockText(new Date(props.session.startedAt)) : ''
);
const elapsed = computed(() =>
  props.session.startedAt
    ? elapsedText((now.value - Date.parse(props.session.startedAt)) / 1000)
    : ''
);
const length = computed(() => durationText(props.session.durationSeconds ?? 0));
const closedAt = computed(() =>
  props.session.endedAt ? clockText(new Date(props.session.endedAt)) : ''
);
const backIcon = computed(() =>
  props.kind === 'flight'
    ? 'mdi-airplane-landing'
    : props.kind === 'racing'
      ? 'mdi-flag-checkered'
      : 'mdi-home-outline'
);
/** Seconds until Stand down starts by itself; undefined when nothing is counting down. */
const secondsLeft = computed(() => {
  const s = props.session;
  if (!countingDown.value || !s.standDownAt) return undefined;
  // In the main window the notice counts down too. Its clock is used while it runs, so the
  // two never say a different second. The compact view has no notice: this line's clock.
  return noticeSecondsLeft.value ?? countdownLeft(s.standDownAt, now.value, s.standDownSeconds);
});
/**
 * Where Stand down by itself stands, in one line. `full` is the whole sentence where the
 * compact view shows a shorter one.
 */
const down = computed(
  (): { text: string; full?: string; tone?: string; state: string } | undefined => {
    const s = props.session;
    if (s.standingDown) return { text: 'Standing down…', state: 'running' };
    if (s.stoodDown) {
      // Green only when every step worked; a step left undone, or a Stand down that could
      // not run, never reads as done.
      const tone = stoodDownText(s.stoodDown).ok
        ? 'rr-ok'
        : s.stoodDown.finished
          ? 'rr-warn'
          : 'rr-bad';
      return { text: stoodDownLine(s.stoodDown), tone, state: 'result' };
    }
    if (secondsLeft.value !== undefined) {
      return { text: countdownTitle(secondsLeft.value), state: 'counting' };
    }
    if (s.standDownHeld) {
      return {
        text: standDownHeldText(s.standDownHeld, props.compact),
        full: standDownHeldText(s.standDownHeld),
        state: 'held',
      };
    }
    return undefined;
  }
);
</script>

<template>
  <div
    v-if="session.phase !== 'idle'"
    class="session"
    :class="[`session-${session.phase}`, { 'session-compact': compact }]"
    role="group"
    aria-label="Session"
    data-testid="fly-session"
    :data-phase="session.phase"
  >
    <template v-if="session.phase === 'running'">
      <v-icon icon="mdi-record-circle-outline" size="20" class="session-icon" />
      <div class="session-main">
        <div class="session-title" data-testid="fly-session-title">{{ game }} is running</div>
        <!-- In the compact view the setup's name is right above: the line leaves it out. -->
        <div class="session-sub" data-testid="fly-session-sub">
          Session in progress since {{ since
          }}<template v-if="!compact"> · {{ session.profileName }}</template>
        </div>
      </div>
      <!-- A clock that ticks is not read out every second: its label says what it is. -->
      <div class="session-clock" role="timer" aria-label="Time in session" aria-live="off">
        <span data-testid="fly-session-elapsed">{{ elapsed }}</span>
      </div>
    </template>

    <template v-else-if="session.phase === 'starting'">
      <v-icon icon="mdi-timer-sand" size="20" class="session-icon" />
      <div class="session-main">
        <div class="session-title" data-testid="fly-session-title">
          Waiting for {{ game }} to start
        </div>
        <div class="session-sub" data-testid="fly-session-sub">
          Steam was asked at {{ since }}.
          <template v-if="!compact">The session begins when the game itself is running.</template>
        </div>
      </div>
    </template>

    <template v-else>
      <v-icon :icon="backIcon" size="22" class="session-icon" />
      <div class="session-main" role="status">
        <div class="session-title" data-testid="fly-session-title">Welcome back</div>
        <div class="session-sub" data-testid="fly-session-sub">
          <template v-if="!compact">{{ session.profileName }} · </template>{{ length }} · closed at
          {{ closedAt }}
        </div>
        <!-- The countdown ticks: it is not read out every second. -->
        <div
          v-if="down"
          class="session-down"
          :class="down.tone"
          :title="compact ? (down.full ?? down.text) : undefined"
          :aria-live="down.state === 'counting' ? 'off' : undefined"
          :data-state="down.state"
          data-testid="fly-session-down"
        >
          {{ down.text }}
        </div>
      </div>
      <v-btn
        v-if="compact && down?.state === 'counting'"
        variant="tonal"
        size="small"
        aria-label="Cancel Stand down"
        data-testid="fly-session-cancel"
        @click="emit('cancel')"
      >
        Cancel
      </v-btn>
      <!-- While it counts down the way out is Cancel, so that nothing reads as "hide this
           and let it run". -->
      <v-btn
        v-else-if="!compact && down?.state !== 'counting'"
        variant="text"
        size="small"
        :disabled="session.standingDown === true"
        data-testid="fly-session-dismiss"
        @click="emit('dismiss')"
      >
        Dismiss
      </v-btn>
    </template>
  </div>
</template>

<style scoped>
.session {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
  padding: 10px 14px;
  border: 1px solid var(--rr-border);
  border-left: 2px solid var(--rr-accent);
  border-radius: 8px;
  background: var(--rr-surface-2);
  animation: session-arrive 200ms ease-out both;
}
@keyframes session-arrive {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
/* The small window has room for three close lines after the game has closed: "Welcome
   back", how long it was, and where Stand down stands. The window's size is the one the
   user may have kept from before there was a third line, so the lines make the room. */
.session-compact {
  margin-top: 10px;
  padding: 5px 10px;
  gap: 8px;
  line-height: 1.3;
}
.session-icon {
  flex: none;
  color: var(--rr-accent);
}
.session-main {
  flex: 1;
  min-width: 0;
}
.session-title {
  font-size: 15px;
  font-weight: 600;
  line-height: 1.3;
}
.session-ended .session-title {
  font-size: 17px;
}
.session-compact .session-title {
  font-size: 13.5px;
}
/* One line each in the compact view, where the lines are short. */
.session-compact .session-title,
.session-compact .session-sub,
.session-compact .session-down {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.session-sub {
  font-size: 12.5px;
  color: var(--rr-muted);
}
.session-down {
  margin-top: 2px;
  font-size: 12.5px;
}
.session-compact .session-down {
  margin-top: 0;
}
.session-clock {
  font-size: 22px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.01em;
}
.session-compact .session-clock {
  font-size: 15px;
}
@media (prefers-reduced-motion: reduce) {
  .session {
    animation: none;
  }
}
</style>
