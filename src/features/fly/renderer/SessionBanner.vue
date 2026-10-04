<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { GameKind } from '../../../shared/models';
import type { SessionState } from '../contract';
import { clockText, durationText, elapsedText } from '../core/sessionText';

/**
 * The session of the moment, under the readiness: the game running with its clock, or
 * "Welcome back" with how long it was once the game has closed.
 */
const props = defineProps<{
  session: SessionState;
  /** The family of sims the game belongs to, for the picture beside "Welcome back". */
  kind?: GameKind | undefined;
  /** In the compact view: one line, no button. */
  compact?: boolean;
}>();
const emit = defineEmits<{ dismiss: [] }>();

const now = ref(Date.now());
let tick: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  tick = setInterval(() => (now.value = Date.now()), 1000);
});
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
/** What Stand down did when it ran by itself. */
const stoodDown = computed(() => {
  const down = props.session.stoodDown;
  if (!down) return undefined;
  const failed = down.failed > 0;
  return {
    tone: failed ? 'rr-warn' : 'rr-ok',
    // A stand down that did not finish says so in its own words.
    text: down.headline.startsWith('Stand down') ? down.headline : `Stood down: ${down.headline}`,
  };
});
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
        <div v-if="session.standingDown" class="session-down" data-testid="fly-session-down">
          Standing down…
        </div>
        <div
          v-else-if="stoodDown"
          class="session-down"
          :class="stoodDown.tone"
          data-testid="fly-session-down"
        >
          {{ stoodDown.text }}
        </div>
      </div>
      <v-btn
        v-if="!compact"
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
.session-compact {
  margin-top: 10px;
  padding: 7px 10px;
  gap: 8px;
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
