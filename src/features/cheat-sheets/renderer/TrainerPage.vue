<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, triggerRef, watch } from 'vue';
import { useRoute } from 'vue-router';
import PageSkeleton from '../../../renderer/components/PageSkeleton.vue';
import { errorText } from '../../../renderer/ipc';
import { onMachineChanged } from '../../../renderer/machine';
import { CATEGORIES } from '../core/categories';
import { controlName } from '../core/layout';
import type { SheetDevice } from '../core/sheet';
import {
  alsoDoes,
  EMPTY_PROGRESS,
  pickDeck,
  placesOf,
  seededRandom,
  summarize,
  type AircraftProgress,
  type Press,
  type TrainerCard,
  type Verdict,
} from '../core/trainer';
import { HOLD_MS, TrainerRound, type InputFrame, type RoundStep } from '../core/trainerRound';
import type { TrainerDeck } from '../trainerContract';
import TrainerPicture from './TrainerPicture.vue';
import { useCheatSheets } from './store';

/**
 * "Learn your controls": RigReady names an action, you press the control for it on the
 * real device, and it says whether that was it, with every control that does the action
 * lit on the picture of its device. A missed card comes back later in the round; a round
 * ends with what went right and what did not, and what you know is kept per aircraft.
 *
 * Which of the things the controllers report is an answer, and when the next card comes,
 * is decided by core/trainerRound. This page feeds it what the controllers say and the time.
 */

/** Cards in a round. */
const ROUND = 10;

const store = useCheatSheets();
const route = useRoute();

const deck = shallowRef<TrainerDeck>();
const error = ref('');
const keepError = ref('');
const loading = ref(false);
/** Only this device's controls; empty for all of them. */
const deviceKey = ref('');
/** The round being played. It is changed in place: `triggerRef` says when. */
const round = shallowRef<TrainerRound>();
const stopped = ref(false);
const progress = shallowRef<AircraftProgress>(EMPTY_PROGRESS);

// ---- the cards of the aircraft ----

let asked = 0;
/**
 * Reads the cards. `keepRound` is for a round that is over: its summary stays on screen
 * while the cards behind it are read again.
 */
async function loadDeck(keepRound = false): Promise<void> {
  if (!keepRound) {
    endRound();
    stopped.value = false;
    deck.value = undefined;
  }
  if (!store.choice) return;
  const mine = ++asked;
  loading.value = true;
  // What the round answered is written before what is remembered is read again.
  if (keepRound) await keeping;
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

/** The round's clock: it only has to run evenly. */
const clock = (): number => performance.now();
let timer: ReturnType<typeof setTimeout> | undefined;
/** Cards put on screen in the rounds before this one. */
const askedBefore = ref(0);
/** Counts every card put on screen, so the same card asked twice running still reads as a new one. */
const asks = computed(() => askedBefore.value + (round.value?.shown ?? 0));

/** What every controller that has been heard from holds right now. */
function frames(): InputFrame[] {
  return [...store.pressed].map(([guid, pressed]) => ({
    guid,
    pressed,
    axes: store.axes.get(guid),
  }));
}

function endRound(): void {
  clearTimeout(timer);
  timer = undefined;
  askedBefore.value += round.value?.shown ?? 0;
  round.value = undefined;
}

function start(only?: string[]): void {
  if (!deck.value) return;
  const all = deck.value.cards;
  const seed = Number(route.query['seed']) || Date.now();
  const cards = pickDeck(all, progress.value, {
    size: ROUND,
    random: seededRandom(seed),
    ...(deviceKey.value ? { deviceKey: deviceKey.value } : {}),
    ...(only ? { only } : {}),
  });
  // A round for one device is about that device's controllers only.
  const mine = all.flatMap((c) => c.answers).filter((a) => a.deviceKey === deviceKey.value);
  endRound();
  round.value = new TrainerRound(cards, {
    now: clock(),
    // What is held as the round begins is where the controls rest (a switch that is on).
    held: frames(),
    ...(deviceKey.value ? { devices: [...new Set(mine.map((a) => a.guid))] } : {}),
  });
  stopped.value = false;
  keepError.value = '';
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

/** What is on screen that a step of the round can change. */
const face = (now: TrainerRound): string =>
  [
    now.session.phase,
    now.shown,
    now.note?.why,
    now.note?.press.guid,
    now.note?.press.control,
    now.weighing?.since,
    now.holding,
  ].join('|');

/** Plays the round on: `play` is one step of it. */
function step(play: (now: TrainerRound) => RoundStep): void {
  const now = round.value;
  if (!now || stopped.value) return;
  const before = face(now);
  const { verdicts, finished } = play(now);
  if (verdicts.length > 0) keep(verdicts);
  if (finished) keep([], true);
  if (face(now) !== before) triggerRef(round);
  // The round says when time alone will change it: a control held long enough, a tap
  // that stayed a tap, the controls at rest for the next card.
  clearTimeout(timer);
  timer = undefined;
  const due = now.due();
  if (due === undefined) return;
  timer = setTimeout(
    () => {
      timer = undefined;
      step((r) => r.tick(clock()));
    },
    Math.max(0, due - clock()) + 1
  );
}

const showMe = (): void => step((now) => now.reveal(clock()));
const next = (): void => step((now) => now.next());

function stop(): void {
  clearTimeout(timer);
  timer = undefined;
  stopped.value = true;
}

// ---- live input ----

// Every report of the controllers goes to the round as it arrives (the store replaces
// `axes` last, on each of them), so that a quick tap is never lost between two redraws.
watch(
  () => store.axes,
  () => step((now) => now.input(clock(), frames())),
  { flush: 'sync' }
);

// ---- what is on screen ----

const card = computed<TrainerCard | undefined>(() => round.value?.session.card);
const phase = computed(() => (stopped.value ? 'done' : (round.value?.session.phase ?? 'idle')));
/** Every control that does the action on the card. */
const answers = computed(() => card.value?.answers ?? []);
/** The one of them that was pressed. */
const answered = computed(() => {
  void phase.value;
  return round.value?.session.answered;
});
/** Where the action is, in words: "Button 20 on Stick", "Button 25 or Button 28 on Throttle". */
const place = (a: { name: string; device: string }): string => `${a.name} on ${a.device}`;
const where = computed(() => placesOf(answers.value));
/** The other places that do the same as the one that was pressed: "Button 25 does it too." */
const also = computed(() => (answered.value ? alsoDoes(answers.value, answered.value) : ''));
/** The devices the card may be answered on. */
const places = computed(() => {
  const names = [...new Set(answers.value.map((a) => a.device))];
  return names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
});
/** The answering control is still held: letting go of it brings the next card. */
const holding = computed(() => round.value?.holding ?? false);
/** What follows "Right": where it was pressed, where else it is, and what brings the next card. */
const afterAnswer = computed(() =>
  answered.value
    ? [
        `${place(answered.value)}.`,
        also.value,
        holding.value ? 'Let go of it for the next card.' : '',
      ]
        .filter(Boolean)
        .join(' ')
    : ''
);
/** A control that is held and being weighed as the answer. */
const weighing = computed(() => round.value?.weighing?.press.control ?? '');

const deviceOf = (guid: string): SheetDevice | undefined =>
  store.sheet?.devices.find((d) => d.guid?.toUpperCase() === guid);
const pressName = (press: Press): string =>
  `${controlName(press.control)} on ${deviceOf(press.guid)?.title ?? 'another controller'}`;

/** A press that was not taken as an answer, and why, in words. */
const note = computed(() => {
  const now = round.value?.note;
  if (!now || phase.value === 'done') return undefined;
  const pressed = pressName(now.press);
  const only = deck.value?.devices.find((d) => d.key === deviceKey.value)?.title ?? 'one device';
  const text = {
    'other-device': `That was ${pressed}. This round is for ${only} only, so it is not counted.`,
    'last-card': `${pressed} was in use on the card before, so it is not counted here.`,
    'back-to-rest': `${pressed} went back to where it was, so it is not counted.`,
    'too-quick': `${pressed} was let go too soon to count. Hold a control for a moment to answer with it.`,
  }[now.why];
  return { why: now.why, control: now.press.control, text };
});

/** The control that was pressed by mistake, and what it does. */
const wrong = computed(() => {
  const press = round.value?.session.wrongPress;
  if (!press) return undefined;
  const device = deviceOf(press.guid);
  const control = device?.controls.find((c) => c.id === press.control);
  return {
    deviceKey: device?.key,
    control: press.control,
    where: pressName(press),
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
  /** After a right answer: every control of the device that does the action. */
  right: string[];
  wrong?: string | undefined;
  /** After a miss: every control of the device that does the action. */
  target: string[];
}
/**
 * A picture for every device the action is on, the one it was answered on first: an action
 * bound in two places is lit in both.
 */
const pictures = computed<Picture[]>(() => {
  const now = phase.value;
  const keys = [
    ...new Set([
      ...(answered.value ? [answered.value.deviceKey] : []),
      ...answers.value.map((a) => a.deviceKey),
    ]),
  ];
  return keys.flatMap((key): Picture[] => {
    const device = store.sheet?.devices.find((d) => d.key === key);
    if (!device) return [];
    const all = answers.value.filter((a) => a.deviceKey === key).map((a) => a.control);
    const missed = wrong.value?.deviceKey === key ? wrong.value.control : undefined;
    const held = device.guid ? (store.pressed.get(device.guid.toUpperCase()) ?? []) : [];
    if (now === 'right' || now === 'corrected') {
      return [{ device, reveal: all, right: all, target: [], held }];
    }
    if (now === 'wrong') {
      return [
        {
          device,
          reveal: [...all, ...(missed ? [missed] : [])],
          right: [],
          target: all,
          wrong: missed,
          held,
        },
      ];
    }
    if (now === 'shown') return [{ device, reveal: all, right: [], target: all, held }];
    return [{ device, reveal: [], right: [], target: [], held }];
  });
});

const results = computed(() => {
  void phase.value;
  return round.value?.session.results();
});
/** The missed cards a round can still ask: in the cards as they are now, on the device chosen. */
const missedLeft = computed(() => {
  const now = new Set(pool.value.map((c) => c.id));
  return (results.value?.missed ?? []).filter((c) => now.has(c.id)).map((c) => c.id);
});
const settledCount = computed(() => round.value?.session.settled ?? 0);
const total = computed(() => round.value?.session.total ?? 0);

let offMachine: (() => void) | undefined;
onMounted(async () => {
  const game = typeof route.query['game'] === 'string' ? route.query['game'] : '';
  const aircraft = typeof route.query['aircraft'] === 'string' ? route.query['aircraft'] : '';
  await store.load(game && aircraft ? `${game}/${aircraft}` : undefined);
  await loadDeck();
  offMachine = onMachineChanged(() => {
    // A device plugged in or out changes which cards there are, but not in mid-round. After
    // a round its summary stays: what was missed is not taken away because a device came or
    // went. The next round is drawn from the cards as they are now.
    void store.refresh();
    if (!round.value) void loadDeck();
    else if (phase.value === 'done') void loadDeck(true);
  });
  // The controllers say what they hold as soon as they are listened to. The round takes the
  // first thing each of them says for where its controls rest.
  await store.acquire();
});
onBeforeUnmount(() => {
  offMachine?.();
  clearTimeout(timer);
  void store.release();
});
</script>

<template>
  <div
    class="rr-page trainer"
    data-testid="trainer-page"
    :data-live="store.watching"
    :data-heard="store.pressed.size"
    :data-phase="phase"
  >
    <div class="d-flex align-start ga-2">
      <div>
        <h1 class="rr-page-title">Learn your controls</h1>
        <p class="rr-page-sub">
          RigReady names an action and you press the control for it on the real device. It says
          whether that was it, and what you miss comes back until you have it.
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

      <PageSkeleton v-if="loading && !deck" label="Reading the bindings…" />

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
            Keep your hands on the controls: tap or hold the one you mean, and letting go of the
            right one brings the next card. A control you only pass on the way is not counted.
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

          <div class="trainer-says">
            <div
              class="trainer-verdict"
              :class="{ 'is-weighing': weighing }"
              :style="{ '--trainer-hold': `${HOLD_MS}ms` }"
              data-testid="trainer-verdict"
              :data-phase="phase"
              :data-weighing="weighing"
            >
              <template v-if="phase === 'asking'">
                <v-icon icon="mdi-gesture-tap-button" size="20" class="rr-muted" />
                <span
                  >Press the control for it on <strong>{{ places }}</strong
                  >.</span
                >
              </template>
              <template v-else-if="phase === 'right' && answered">
                <v-icon icon="mdi-check-circle-outline" size="20" class="rr-ok" />
                <span><strong>Right.</strong> {{ afterAnswer }}</span>
              </template>
              <template v-else-if="phase === 'wrong' && wrong">
                <v-icon icon="mdi-close-circle-outline" size="20" class="rr-bad" />
                <span>
                  <strong>Not that one.</strong> You pressed {{ wrong.where
                  }}<template v-if="wrong.does.length"
                    >, which is {{ wrong.does.join(' / ') }}</template
                  >. It is <strong>{{ where }}</strong
                  >, lit on the picture: press {{ answers.length > 1 ? 'one of them' : 'it' }} to go
                  on.
                </span>
              </template>
              <template v-else-if="phase === 'shown'">
                <v-icon icon="mdi-lightbulb-on-outline" size="20" class="rr-muted" />
                <span>
                  It is <strong>{{ where }}</strong
                  >, lit on the picture. Press {{ answers.length > 1 ? 'one of them' : 'it' }} to go
                  on.
                </span>
              </template>
              <template v-else-if="phase === 'corrected' && answered">
                <v-icon icon="mdi-check" size="20" class="rr-muted" />
                <span>
                  That is it: {{ afterAnswer }}
                  <template v-if="round?.session.comesBack">
                    This one comes back later in the round.</template
                  >
                </span>
              </template>
            </div>
            <!-- A press that was not taken as an answer: said, so that nothing is silently ignored. -->
            <div
              v-if="note"
              class="trainer-note"
              role="status"
              data-testid="trainer-note"
              :data-why="note.why"
              :data-control="note.control"
            >
              <v-icon icon="mdi-information-outline" size="18" />
              <span>{{ note.text }}</span>
            </div>
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

        <div v-if="pictures.length" class="trainer-pictures">
          <div
            v-for="picture in pictures"
            :key="picture.device.key"
            class="rr-panel trainer-device-panel"
            data-testid="trainer-device-panel"
          >
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
              <template v-if="stopped && round?.session.phase !== 'done'">
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
            v-if="missedLeft.length"
            variant="tonal"
            color="primary"
            data-testid="trainer-again-missed"
            @click="start(missedLeft)"
            >Practise the missed</v-btn
          >
          <v-btn color="primary" data-testid="trainer-again" @click="start()">Another round</v-btn>
        </div>
        <ul v-if="results.missed.length" class="trainer-missed" data-testid="trainer-missed">
          <li v-for="m in results.missed" :key="m.id">
            <span class="trainer-missed-action">{{ m.plain ?? m.action }}</span>
            <span class="rr-muted"> · {{ placesOf(m.answers) }}</span>
          </li>
        </ul>
      </div>
    </template>
    <PageSkeleton v-else-if="!error && !store.error" label="Reading the bindings…" />
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
.trainer-says {
  flex: 1;
  margin-top: 18px;
}
.trainer-verdict {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding-top: 14px;
  border-top: 1px solid var(--rr-border);
  font-size: 14.5px;
  line-height: 1.45;
}
.trainer-verdict .v-icon {
  margin-top: 1px;
}
/* A control is held and being taken for the answer: the line above the words fills up. */
.trainer-verdict.is-weighing::before {
  content: '';
  position: absolute;
  top: -1px;
  left: 0;
  width: 100%;
  height: 2px;
  background: var(--rr-accent);
  transform-origin: left;
  animation: trainer-weigh var(--trainer-hold, 350ms) linear both;
}
@keyframes trainer-weigh {
  from {
    transform: scaleX(0);
  }
  to {
    transform: scaleX(1);
  }
}
.trainer-note {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-top: 10px;
  color: var(--rr-muted);
  font-size: 13.5px;
  line-height: 1.45;
}
.trainer-note .v-icon {
  margin-top: 1px;
}
.trainer-card-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
}
.trainer-pictures {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
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
  .trainer-verdict.is-weighing::before {
    animation: none;
  }
}
</style>
