<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, triggerRef, watch } from 'vue';
import { useRoute } from 'vue-router';
import { errorText } from '../../../renderer/ipc';
import { onMachineChanged } from '../../../renderer/machine';
import { CATEGORIES } from '../core/categories';
import { controlName } from '../core/layout';
import type { SheetDevice } from '../core/sheet';
import {
  EMPTY_PROGRESS,
  pickDeck,
  seededRandom,
  summarize,
  TrainerSession,
  type AircraftProgress,
  type Press,
  type TrainerCard,
  type Verdict,
} from '../core/trainer';
import type { TrainerDeck } from '../trainerContract';
import TrainerPicture from './TrainerPicture.vue';
import { useCheatSheets } from './store';

/**
 * "Learn your controls": RigReady names an action, you press the control for it on the
 * real device, and it says at once whether that was it, with the control lit on the
 * picture of the device. A missed card comes back later in the round; a round ends with
 * what went right and what did not, and what you know is kept per aircraft.
 */

/** Cards in a round. */
const ROUND = 10;
/** A verdict stays on screen at least this long, however quickly the control is let go. */
const SHOW_MS = 650;

const store = useCheatSheets();
const route = useRoute();

const deck = shallowRef<TrainerDeck>();
const error = ref('');
const keepError = ref('');
const loading = ref(false);
/** Only this device's controls; empty for all of them. */
const deviceKey = ref('');
const session = shallowRef<TrainerSession>();
const stopped = ref(false);
const progress = shallowRef<AircraftProgress>(EMPTY_PROGRESS);
/** Live presses count once the controllers have said what is held to begin with. */
const armed = ref(false);

// ---- the cards of the aircraft ----

let asked = 0;
async function loadDeck(): Promise<void> {
  session.value = undefined;
  stopped.value = false;
  deck.value = undefined;
  if (!store.choice) return;
  const mine = ++asked;
  loading.value = true;
  const result = await store.api.trainerDeck({ game: store.game, aircraftId: store.aircraftId });
  if (mine !== asked) return;
  loading.value = false;
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  error.value = '';
  deck.value = result.value;
  progress.value = result.value.progress;
  if (!result.value.devices.some((d) => d.key === deviceKey.value)) deviceKey.value = '';
}
watch(
  () => store.choice,
  () => void loadDeck()
);

const deviceItems = computed(() => [
  { title: 'All devices', value: '' },
  ...(deck.value?.devices ?? []).map((d) => ({
    title: `${d.title} · ${d.cards} ${d.cards === 1 ? 'control' : 'controls'}`,
    value: d.key,
  })),
]);
/** The cards a round is drawn from, with the device filter applied. */
const pool = computed(() =>
  (deck.value?.cards ?? []).filter(
    (c) => !deviceKey.value || c.answers.some((a) => a.deviceKey === deviceKey.value)
  )
);
const standing = computed(() => summarize(pool.value, progress.value));
const percent = (part: number, whole: number): number =>
  whole === 0 ? 0 : Math.round((part / whole) * 100);

// ---- a round ----

let verdictAt = 0;
let advanceTimer: ReturnType<typeof setTimeout> | undefined;
/** Counts every card put on screen, so the same card asked twice running still reads as a new one. */
const asks = ref(0);

function start(only?: string[]): void {
  if (!deck.value) return;
  const seed = Number(route.query['seed']) || Date.now();
  session.value = new TrainerSession(
    pickDeck(deck.value.cards, progress.value, {
      size: ROUND,
      random: seededRandom(seed),
      ...(deviceKey.value ? { deviceKey: deviceKey.value } : {}),
      ...(only ? { only } : {}),
    })
  );
  stopped.value = false;
  keepError.value = '';
  asks.value++;
}

// What is remembered is written one answer after the other, in the order they were given.
let keeping: Promise<void> = Promise.resolve();
function keep(answers: Verdict[], finished = false): void {
  const { game, aircraftId } = store;
  keeping = keeping.then(async () => {
    const result = await store.api.trainerRecord({ game, aircraftId, answers, finished });
    if (result.ok) {
      progress.value = result.value;
      keepError.value = '';
    } else {
      keepError.value = errorText(result.error);
    }
  });
}

function settle(verdict: Verdict | undefined, before: string | undefined): void {
  const now = session.value;
  if (!now) return;
  if (now.phase !== before) verdictAt = Date.now();
  triggerRef(session);
  if (verdict) keep([verdict]);
}

function onPress(press: Press): void {
  const now = session.value;
  if (!now || now.phase === 'done' || stopped.value) return;
  const before = now.phase;
  settle(now.press(press), before);
}

function showMe(): void {
  const now = session.value;
  if (!now) return;
  const before = now.phase;
  settle(now.reveal(), before);
}

function next(): void {
  const now = session.value;
  if (!now?.canAdvance) return;
  clearTimeout(advanceTimer);
  advanceTimer = undefined;
  now.advance();
  asks.value++;
  triggerRef(session);
  if (now.phase === 'done') keep([], true);
}

function stop(): void {
  clearTimeout(advanceTimer);
  advanceTimer = undefined;
  stopped.value = true;
}

/** The next card comes when the control that answered this one is let go. */
function maybeAdvance(): void {
  const now = session.value;
  if (!now?.answered || (now.phase !== 'right' && now.phase !== 'corrected')) return;
  const held = store.pressed.get(now.answered.guid)?.includes(now.answered.control) ?? false;
  if (held) {
    clearTimeout(advanceTimer);
    advanceTimer = undefined;
    return;
  }
  advanceTimer ??= setTimeout(
    () => {
      advanceTimer = undefined;
      next();
    },
    Math.max(0, SHOW_MS - (Date.now() - verdictAt))
  );
}

// ---- live input ----

let previous = new Map<string, string[]>();
watch(
  () => store.pressed,
  (now) => {
    // The first thing the controllers say is what is held already (a switch that is on):
    // that is where things rest, not a press.
    if (!armed.value) {
      previous = new Map(now);
      return;
    }
    const fresh: Press[] = [];
    for (const [guid, held] of now) {
      const before = previous.get(guid) ?? [];
      for (const control of held) {
        if (!before.includes(control) && !control.startsWith('axis:'))
          fresh.push({ guid, control });
      }
    }
    previous = new Map(now);
    for (const press of fresh) onPress(press);
    maybeAdvance();
  }
);

// ---- what is on screen ----

const card = computed<TrainerCard | undefined>(() => session.value?.card);
const phase = computed(() => (stopped.value ? 'done' : (session.value?.phase ?? 'idle')));
/** The control the picture is about: the one that answered, else the first that would. */
const answer = computed(() => session.value?.answered ?? card.value?.answers[0]);
const pictureDevice = computed(() =>
  store.sheet?.devices.find((d) => d.key === answer.value?.deviceKey)
);
/** Where the action is, in words: "Button 20 on Stick". */
const place = (a: { name: string; device: string }): string => `${a.name} on ${a.device}`;
const places = computed(() => {
  const names = [...new Set((card.value?.answers ?? []).map((a) => a.device))];
  return names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
});

/** The control that was pressed by mistake, and what it does. */
const wrong = computed(() => {
  const press = session.value?.wrongPress;
  if (!press) return undefined;
  const device = store.sheet?.devices.find((d) => d.guid?.toUpperCase() === press.guid);
  const control = device?.controls.find((c) => c.id === press.control);
  return {
    deviceKey: device?.key,
    control: press.control,
    where: `${controlName(press.control)} on ${device?.title ?? 'another controller'}`,
    // Named as a card names it: the plain name where the sheet has one.
    does: (control?.bindings ?? [])
      .filter((b) => b.modifiers.length === 0)
      .map((b) => b.plain ?? b.action),
  };
});

interface Picture {
  device: SheetDevice;
  /** Controls whose labels are written out. */
  reveal: string[];
  held: string[];
  right?: string | undefined;
  wrong?: string | undefined;
  target?: string | undefined;
}
const picture = computed<Picture | undefined>(() => {
  const now = phase.value;
  const shown = answer.value;
  const device = pictureDevice.value;
  if (!shown || !device) return undefined;
  const onDevice = wrong.value?.deviceKey === device.key ? wrong.value.control : undefined;
  const held = device.guid ? (store.pressed.get(device.guid.toUpperCase()) ?? []) : [];
  if (now === 'right' || now === 'corrected') {
    return { device, reveal: [shown.control], right: shown.control, held };
  }
  if (now === 'wrong') {
    return {
      device,
      reveal: [shown.control, ...(onDevice ? [onDevice] : [])],
      target: shown.control,
      wrong: onDevice,
      held,
    };
  }
  if (now === 'shown') return { device, reveal: [shown.control], target: shown.control, held };
  return { device, reveal: [], held };
});

const results = computed(() => {
  void phase.value;
  return session.value?.results();
});
const settledCount = computed(() => session.value?.settled ?? 0);
const total = computed(() => session.value?.total ?? 0);

let offMachine: (() => void) | undefined;
let armTimer: ReturnType<typeof setTimeout> | undefined;
onMounted(async () => {
  const game = typeof route.query['game'] === 'string' ? route.query['game'] : '';
  const aircraft = typeof route.query['aircraft'] === 'string' ? route.query['aircraft'] : '';
  await store.load(game && aircraft ? `${game}/${aircraft}` : undefined);
  await loadDeck();
  offMachine = onMachineChanged(() => {
    // A device plugged in or out changes which cards there are, but not in mid-round.
    void store.refresh();
    if (!session.value || phase.value === 'done') void loadDeck();
  });
  await store.acquire();
  // The controllers report what is held as soon as they are listened to; after that,
  // anything newly down is a press.
  armTimer = setTimeout(() => (armed.value = true), 400);
});
onBeforeUnmount(() => {
  offMachine?.();
  clearTimeout(advanceTimer);
  clearTimeout(armTimer);
  void store.release();
});
</script>

<template>
  <div
    class="rr-page trainer"
    data-testid="trainer-page"
    :data-live="store.watching && armed"
    :data-phase="phase"
  >
    <div class="d-flex align-start ga-2">
      <div>
        <h1 class="rr-page-title">Learn your controls</h1>
        <p class="rr-page-sub">
          RigReady names an action and you press the control for it on the real device. It says at
          once whether that was it, and what you miss comes back until you have it.
        </p>
      </div>
      <v-spacer />
      <v-btn
        variant="text"
        prepend-icon="mdi-card-text-outline"
        data-testid="trainer-back"
        :to="{
          path: '/configure/cheat-sheets',
          query: store.choice ? { game: store.game, aircraft: store.aircraftId } : {},
        }"
        >Cheat sheet</v-btn
      >
    </div>

    <v-alert
      v-if="error || store.error"
      type="warning"
      variant="tonal"
      class="mb-4"
      data-testid="trainer-error"
    >
      {{ error || store.error }}
    </v-alert>
    <v-alert
      v-if="keepError"
      type="warning"
      variant="tonal"
      class="mb-4"
      data-testid="trainer-keep-error"
    >
      What you just answered could not be kept: {{ keepError }}
    </v-alert>

    <div
      v-if="store.loaded && (store.overview?.games.length ?? 0) === 0 && !store.error"
      class="rr-panel rr-empty"
      data-testid="trainer-none"
    >
      <v-icon icon="mdi-school-outline" size="34" class="mb-2" />
      <div>No game whose bindings RigReady can read was found on this PC.</div>
      <div class="rr-row-sub mb-3">
        The trainer asks what a game has bound to your controls, so there is nothing to ask yet.
      </div>
      <v-btn variant="tonal" color="primary" to="/configure/games">Go to Games</v-btn>
    </div>

    <template v-else-if="store.overview">
      <div class="rr-panel trainer-bar">
        <v-select
          class="trainer-aircraft"
          label="Aircraft or car"
          :items="store.aircraftItems"
          :model-value="store.choice"
          density="compact"
          variant="outlined"
          hide-details
          data-testid="trainer-aircraft"
          @update:model-value="store.choose(String($event))"
        />
        <v-select
          v-model="deviceKey"
          class="trainer-device"
          label="Practise"
          :items="deviceItems"
          density="compact"
          variant="outlined"
          hide-details
          :disabled="phase !== 'idle' && phase !== 'done'"
          :title="
            phase !== 'idle' && phase !== 'done' ? 'Stop the round to change this' : undefined
          "
          data-testid="trainer-device"
        />
        <div v-if="deck" class="trainer-standing" data-testid="trainer-progress">
          <div class="trainer-standing-text">
            <strong>{{ standing.learned }} of {{ standing.total }}</strong> learned
            <span class="rr-muted">
              · {{ standing.rounds }} {{ standing.rounds === 1 ? 'round' : 'rounds' }} played</span
            >
          </div>
          <div
            class="trainer-meter"
            role="img"
            :aria-label="`${standing.learned} of ${standing.total} learned, ${standing.seen} asked at least once`"
          >
            <div
              class="trainer-meter-seen"
              :style="{ width: `${percent(standing.seen, standing.total)}%` }"
            />
            <div
              class="trainer-meter-learned"
              :style="{ width: `${percent(standing.learned, standing.total)}%` }"
            />
          </div>
        </div>
      </div>

      <div v-if="loading && !deck" class="rr-panel rr-empty">Reading the bindings…</div>

      <!-- Nothing to ask -->
      <div
        v-else-if="deck && deck.cards.length === 0"
        class="rr-panel rr-empty"
        data-testid="trainer-empty"
      >
        <v-icon icon="mdi-gesture-tap-button" size="34" class="mb-2" />
        <div>
          There is nothing to practise in {{ deck.title }} yet: no button or hat of a connected
          controller is bound to anything.
        </div>
        <div v-if="deck.unplugged.length" class="rr-row-sub">
          {{ deck.unplugged.join(', ') }}
          {{ deck.unplugged.length === 1 ? 'is' : 'are' }} not connected, so
          {{ deck.unplugged.length === 1 ? 'its' : 'their' }} controls cannot be asked.
        </div>
        <v-btn
          class="mt-3"
          variant="tonal"
          color="primary"
          :to="{
            path: '/configure/cheat-sheets',
            query: { game: store.game, aircraft: store.aircraftId },
          }"
          >Open the cheat sheet</v-btn
        >
      </div>

      <!-- Before a round -->
      <div
        v-else-if="deck && phase === 'idle'"
        class="rr-panel trainer-intro"
        data-testid="trainer-intro"
      >
        <v-icon icon="mdi-school-outline" size="36" class="rr-muted" />
        <div class="rr-row-main">
          <div class="rr-row-title">
            {{ pool.length }} {{ pool.length === 1 ? 'control' : 'controls' }} to know in
            {{ deck.title }}
          </div>
          <div class="rr-row-sub">
            A round asks {{ Math.min(ROUND, pool.length) }} of them, the ones you know least first.
            Keep your hands on the controls: letting go of the right one brings the next card.
            <template v-if="deck.unplugged.length">
              {{ deck.unplugged.join(', ') }}
              {{ deck.unplugged.length === 1 ? 'is' : 'are' }} not connected and left out.
            </template>
          </div>
        </div>
        <v-btn
          color="primary"
          size="large"
          :disabled="pool.length === 0"
          data-testid="trainer-start"
          @click="start()"
          >Start a round</v-btn
        >
      </div>

      <!-- A round: the question beside the picture of the device it is on -->
      <div v-else-if="deck && card && phase !== 'done'" class="trainer-round-view">
        <div
          class="rr-panel trainer-card"
          :class="`is-${phase}`"
          data-testid="trainer-card"
          :data-card-id="card.id"
          :data-ask="asks"
        >
          <div class="trainer-card-head">
            <span class="trainer-kind">
              <i :style="{ background: CATEGORIES[card.kind].color }" />
              {{ CATEGORIES[card.kind].label }}
            </span>
            <v-spacer />
            <span class="rr-muted" data-testid="trainer-count"
              >{{ settledCount }} of {{ total }} done</span
            >
          </div>
          <div
            class="trainer-round"
            role="img"
            :aria-label="`${settledCount} of ${total} cards done`"
          >
            <div :style="{ width: `${percent(settledCount, total)}%` }" />
          </div>

          <div class="trainer-action" data-testid="trainer-action">
            {{ card.plain ?? card.action }}
          </div>
          <div v-if="card.plain" class="rr-muted trainer-game-name" data-testid="trainer-game-name">
            {{ deck.gameName.replace(/ World$/, '') }} calls it “{{ card.action }}”
          </div>

          <div class="trainer-verdict" data-testid="trainer-verdict" :data-phase="phase">
            <template v-if="phase === 'asking'">
              <v-icon icon="mdi-gesture-tap-button" size="20" class="rr-muted" />
              <span
                >Press the control for it on <strong>{{ places }}</strong
                >.</span
              >
            </template>
            <template v-else-if="phase === 'right' && answer">
              <v-icon icon="mdi-check-circle-outline" size="20" class="rr-ok" />
              <span
                ><strong>Right.</strong> {{ place(answer) }}. Let go of it for the next card.</span
              >
            </template>
            <template v-else-if="phase === 'wrong' && wrong && answer">
              <v-icon icon="mdi-close-circle-outline" size="20" class="rr-bad" />
              <span>
                <strong>Not that one.</strong> You pressed {{ wrong.where
                }}<template v-if="wrong.does.length"
                  >, which is {{ wrong.does.join(' / ') }}</template
                >. It is <strong>{{ place(answer) }}</strong
                >, lit on the picture: press it to go on.
              </span>
            </template>
            <template v-else-if="phase === 'shown' && answer">
              <v-icon icon="mdi-lightbulb-on-outline" size="20" class="rr-muted" />
              <span>
                It is <strong>{{ place(answer) }}</strong
                >, lit on the picture. Press it to go on.
              </span>
            </template>
            <template v-else-if="phase === 'corrected' && answer">
              <v-icon icon="mdi-check" size="20" class="rr-muted" />
              <span>
                That is it: {{ place(answer) }}. Let go of it for the next card.
                <template v-if="session?.comesBack">
                  This one comes back later in the round.</template
                >
              </span>
            </template>
          </div>

          <div class="trainer-card-actions">
            <v-btn
              v-if="phase === 'asking'"
              variant="tonal"
              prepend-icon="mdi-lightbulb-on-outline"
              data-testid="trainer-show"
              @click="showMe"
              >Show me</v-btn
            >
            <v-btn
              v-else
              variant="tonal"
              append-icon="mdi-arrow-right"
              data-testid="trainer-next"
              @click="next"
              >Next</v-btn
            >
            <v-spacer />
            <v-btn variant="text" data-testid="trainer-stop" @click="stop">Stop the round</v-btn>
          </div>
        </div>

        <div v-if="picture" class="rr-panel trainer-device-panel">
          <div class="rr-section-title">{{ picture.device.title }}</div>
          <TrainerPicture
            :device="picture.device"
            :reveal="picture.reveal"
            :right="picture.right"
            :wrong="picture.wrong"
            :target="picture.target"
            :held="picture.held"
          />
        </div>
      </div>

      <!-- After a round -->
      <div
        v-else-if="deck && results"
        class="rr-panel trainer-summary"
        data-testid="trainer-summary"
      >
        <div class="trainer-summary-head">
          <v-icon icon="mdi-flag-checkered" size="30" class="rr-muted" />
          <div class="rr-row-main">
            <div class="trainer-summary-title" data-testid="trainer-score">
              {{ results.firstTry }} of {{ results.asked }} right first time
            </div>
            <div class="rr-row-sub">
              <template v-if="stopped && session?.phase !== 'done'">
                The round was stopped before its end, so it does not count as played. What you
                answered is kept.
              </template>
              <template v-else-if="results.missed.length === 0">
                Nothing missed. Play these again another day: twice right running is learned.
              </template>
              <template v-else>
                {{ results.missed.length }}
                {{ results.missed.length === 1 ? 'card' : 'cards' }} to look at again.
              </template>
            </div>
          </div>
          <v-btn
            v-if="results.missed.length"
            variant="tonal"
            color="primary"
            data-testid="trainer-again-missed"
            @click="start(results.missed.map((c) => c.id))"
            >Practise the missed</v-btn
          >
          <v-btn color="primary" data-testid="trainer-again" @click="start()">Another round</v-btn>
        </div>
        <ul v-if="results.missed.length" class="trainer-missed" data-testid="trainer-missed">
          <li v-for="m in results.missed" :key="m.id">
            <span class="trainer-missed-action">{{ m.plain ?? m.action }}</span>
            <span class="rr-muted"> · {{ m.answers.map(place).join(' or ') }}</span>
          </li>
        </ul>
      </div>
    </template>
    <div v-else-if="!error && !store.error" class="rr-panel rr-empty">Reading the bindings…</div>
  </div>
</template>

<style scoped>
.trainer {
  max-width: 1040px;
}
.trainer-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  margin-bottom: 16px;
}
.trainer-aircraft {
  flex: 0 1 260px;
}
.trainer-device {
  flex: 0 1 280px;
}
.trainer-standing {
  flex: 1;
  min-width: 160px;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.trainer-standing-text {
  text-align: right;
}
.trainer-meter,
.trainer-round {
  position: relative;
  height: 4px;
  border-radius: 2px;
  background: var(--rr-surface-2);
  overflow: hidden;
}
.trainer-meter {
  margin-top: 6px;
}
.trainer-meter > div,
.trainer-round > div {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: 2px;
  transition: width 0.2s ease-out;
}
.trainer-meter-seen {
  background: color-mix(in srgb, var(--rr-accent) 35%, transparent);
}
.trainer-meter-learned,
.trainer-round > div {
  background: var(--rr-accent);
}
.trainer-intro {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 18px 20px;
}
.trainer-round-view {
  display: grid;
  grid-template-columns: minmax(300px, 5fr) minmax(0, 7fr);
  gap: 16px;
  align-items: start;
}
.trainer-card {
  display: flex;
  flex-direction: column;
  min-height: 330px;
  padding: 16px 20px;
  border-left: 3px solid var(--rr-border);
  transition: border-color 0.15s ease-out;
}
.trainer-card.is-right,
.trainer-card.is-corrected {
  border-left-color: var(--rr-ok);
}
.trainer-card.is-wrong {
  border-left-color: var(--rr-bad);
}
.trainer-card.is-shown {
  border-left-color: var(--rr-accent);
}
.trainer-card-head {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12.5px;
  font-variant-numeric: tabular-nums;
}
.trainer-kind {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--rr-muted);
}
.trainer-kind i {
  width: 10px;
  height: 10px;
  border-radius: 3px;
}
.trainer-round {
  margin-top: 8px;
}
.trainer-action {
  margin-top: 22px;
  font-size: 28px;
  font-weight: 600;
  line-height: 1.15;
  letter-spacing: -0.005em;
  overflow-wrap: anywhere;
}
.trainer-game-name {
  margin-top: 4px;
  font-size: 13.5px;
}
.trainer-verdict {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  flex: 1;
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid var(--rr-border);
  font-size: 14.5px;
  line-height: 1.45;
}
.trainer-verdict .v-icon {
  margin-top: 1px;
}
.trainer-card-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
}
.trainer-device-panel {
  padding: 14px 16px 16px;
}
.trainer-summary {
  padding: 18px 20px;
}
.trainer-summary-head {
  display: flex;
  align-items: center;
  gap: 16px;
}
.trainer-summary-title {
  font-size: 20px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.trainer-missed {
  list-style: none;
  margin: 14px 0 0;
  padding: 12px 0 0 46px;
  border-top: 1px solid var(--rr-border);
  font-size: 13.5px;
}
.trainer-missed li {
  padding: 3px 0;
}
.trainer-missed-action {
  font-weight: 500;
}
@media (prefers-reduced-motion: reduce) {
  .trainer-card,
  .trainer-meter > div,
  .trainer-round > div {
    transition: none;
  }
}
</style>
