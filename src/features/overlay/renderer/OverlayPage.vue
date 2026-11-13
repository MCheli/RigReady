<script setup lang="ts">
/**
 * The Overlay page: the switch, what the presses are named from, and for each part of the
 * overlay where it is on the screen and how it looks. Everything here shows what the main
 * side answered; a change that was refused is said, and the page reads again.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { Result } from '../../../core/result';
import PageSkeleton from '../../../renderer/components/PageSkeleton.vue';
import { errorText, useClient } from '../../../renderer/ipc';
import { onMachineChanged } from '../../../renderer/machine';
import { overlayContract, type OverlayState, type WidgetState } from '../contract';
import { NOT_READ } from '../core/model';
import type { At } from '../core/settings';
import { NAMED_PLACES } from '../core/shown';
import { WIDGET_PARTS } from './widgets';

const api = useClient(overlayContract);
const state = ref<OverlayState>();
const loadError = ref<string>();
const error = ref<string>();
const busy = ref(false);
/** Bumped after a refused change, so that every control shows again what is in effect. */
const revision = ref(0);

async function load(): Promise<void> {
  const result = await api.state();
  if (result.ok) {
    state.value = result.value;
    loadError.value = undefined;
  } else {
    loadError.value = errorText(result.error);
  }
}

/** One change: what comes back is what the page shows; a refusal is said, and it reads again. */
async function change(call: () => Promise<Result<OverlayState>>): Promise<void> {
  busy.value = true;
  error.value = undefined;
  const result = await call();
  busy.value = false;
  if (result.ok) {
    state.value = result.value;
  } else {
    error.value = errorText(result.error);
    // A switch keeps what was clicked on it. Drawn again, it shows what is in effect.
    revision.value++;
    void load();
  }
}

function turn(on: boolean | null): void {
  void change(() => api.set({ on: on === true }));
}

function setOptions(widget: WidgetState, options: Record<string, unknown>): void {
  void change(() => api.options({ widget: widget.id, options }));
}

function putOn(widget: WidgetState, screen: unknown): void {
  if (typeof screen !== 'string') return;
  void change(() => api.place({ widget: widget.id, screen, at: widget.place.at }));
}

function putAt(widget: WidgetState, at: At): void {
  void change(() => api.place({ widget: widget.id, at }));
}

function move(widget: WidgetState, moving: boolean): void {
  void change(() => api.move({ widget: widget.id, moving }));
}

function chooseAircraft(id: unknown): void {
  void change(() => api.aircraft({ aircraftId: typeof id === 'string' ? id : null }));
}

/** Where the overlay is up, in words. */
const showingOn = computed(() => {
  const names = (state.value?.widgets ?? [])
    .filter((widget) => widget.showing)
    .map((widget) => widget.place.screenName ?? 'the screen');
  return [...new Set(names)].join(' and ');
});

const screenItems = computed(() =>
  (state.value?.screens ?? []).map((screen) => ({
    title: screen.primary ? `${screen.name} (main)` : screen.name,
    value: screen.id,
    props: { subtitle: `${screen.width} × ${screen.height}` },
  }))
);

const aircraftItems = computed(() =>
  (state.value?.source.choices ?? []).map((choice) => ({
    title: choice.name,
    value: choice.id,
    props: { subtitle: choice.hasUserBindings ? 'Your bindings' : 'Game defaults only' },
  }))
);

/** How RigReady came to the aircraft or car the names are for. */
const how = computed(() => {
  const source = state.value?.source;
  switch (source?.aircraft?.how) {
    case 'chosen':
      return 'You chose it.';
    case 'setup':
      return `From the setup “${source.setup?.name ?? ''}”.`;
    case 'only':
      return 'The only one this game has bindings for.';
    case 'guess':
      return 'RigReady’s guess: the first one with bindings of your own. Choose the one you fly or drive if that is wrong.';
    default:
      return undefined;
  }
});

/** The shape of the screen a widget is on, small: what the nine places are drawn in. */
function screenShape(widget: WidgetState): Record<string, string> {
  const screen = state.value?.screens.find((s) => s.id === widget.place.screen);
  const ratio = screen ? Math.min(3.6, Math.max(0.5, screen.width / screen.height)) : 16 / 9;
  const width = Math.min(232, Math.round(84 * ratio));
  return { width: `${width}px`, height: `${Math.round(width / ratio)}px` };
}

/** Where in that shape the widget is: the same share of the free room as on the screen. */
function markAt(widget: WidgetState): Record<string, string> {
  return { '--op-x': String(widget.place.at.x), '--op-y': String(widget.place.at.y) };
}

function isAt(widget: WidgetState, at: At): boolean {
  return widget.place.at.x === at.x && widget.place.at.y === at.y;
}

function previewBox(widget: WidgetState): Record<string, string> {
  return { width: `${widget.width}px`, height: `${widget.height}px` };
}

const stops: (() => void)[] = [];
onMounted(() => {
  stops.push(
    api.on('changed', (next) => {
      state.value = next;
    }),
    onMachineChanged(() => void load())
  );
  return load();
});
onBeforeUnmount(() => {
  for (const stop of stops) stop();
});
</script>

<template>
  <div class="rr-page" data-testid="overlay-page">
    <h1 class="rr-page-title">Overlay</h1>
    <p class="rr-page-sub">
      A small see-through list over the game: each button or hat you press, with what it does in the
      game for the aircraft or car you are in. Clicks go through it and it never takes the keyboard,
      so the game does not notice it.
    </p>

    <v-alert
      v-if="loadError"
      type="error"
      variant="tonal"
      class="mb-4"
      data-testid="overlay-load-error"
    >
      {{ loadError }}
      <template #append>
        <v-btn variant="text" size="small" @click="load">Try again</v-btn>
      </template>
    </v-alert>
    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      class="mb-4"
      closable
      data-testid="overlay-error"
      @click:close="error = undefined"
    >
      {{ error }}
    </v-alert>

    <div v-if="state" :key="revision">
      <v-alert
        v-if="state.problem"
        type="warning"
        variant="tonal"
        class="mb-4"
        data-testid="overlay-settings-problem"
      >
        <div data-testid="overlay-settings-said">{{ state.problem }}</div>
        <div data-testid="overlay-settings-advice">
          Repair the overlay's settings file or delete it: once it is deleted, the overlay starts
          again from its first settings, turned off.
        </div>
      </v-alert>

      <div class="rr-panel op-section" data-testid="overlay-main" :data-on="state.on">
        <div class="rr-row">
          <div class="rr-row-main">
            <div class="rr-row-title">Show the overlay</div>
            <div class="rr-row-sub" data-testid="overlay-status">
              <template v-if="!state.on">
                Off. Nothing is put over the game, and the controllers are not read for it.
              </template>
              <template v-else-if="showingOn">
                On, over whatever is on {{ showingOn }}. It comes up again whenever RigReady runs,
                until you turn it off here.
              </template>
              <span v-else class="rr-warn">On, but it is not showing. The reason is below.</span>
            </div>
          </div>
          <v-switch
            :model-value="state.on"
            :loading="busy"
            hide-details
            class="flex-grow-0"
            aria-label="Show the overlay"
            data-testid="overlay-on"
            @update:model-value="turn"
          />
        </div>
        <div v-if="state.input && !state.input.ok" class="rr-row">
          <div class="rr-row-main">
            <div class="rr-warn" data-testid="overlay-not-read">{{ NOT_READ }}.</div>
            <div v-if="state.input.problem" class="rr-row-sub" data-testid="overlay-input-problem">
              {{ state.input.problem }}
            </div>
          </div>
        </div>
        <div class="rr-row">
          <div class="rr-row-main rr-row-sub" data-testid="overlay-where">
            <strong>Where it shows.</strong> Over the desktop and over a game that runs in a window
            or as a borderless window. Over a game in exclusive full screen it may not show: set the
            game to borderless if you do not see it. It does not show inside a VR headset.
          </div>
        </div>
      </div>

      <div class="rr-section-title">What the presses are named from</div>
      <div class="rr-panel op-section" data-testid="overlay-source">
        <div class="rr-row">
          <div class="rr-row-main">
            <div class="rr-row-title" data-testid="overlay-source-game">
              <template v-if="state.source.game">{{ state.source.game.name }}</template>
              <template v-else>No game</template>
            </div>
            <div class="rr-row-sub">
              <template v-if="state.source.setup">
                The game of the setup in use, “{{ state.source.setup.name }}”: the one you played
                last. The names are the ones this game gives its actions.
              </template>
              <template v-else>
                There is no setup yet, so RigReady goes by the games whose bindings it finds on this
                PC.
              </template>
            </div>
            <div v-if="state.source.problem" class="rr-row-sub">
              <span class="rr-warn" data-testid="overlay-source-problem">
                {{ state.source.problem }}
              </span>
            </div>
          </div>
        </div>
        <div v-if="state.source.choices.length > 0" class="rr-row">
          <div class="rr-row-main">
            <div class="rr-row-title">Aircraft or car</div>
            <div class="rr-row-sub">
              A game keeps its own bindings for each one, and nothing tells RigReady which one you
              are in right now.
              <span v-if="how" data-testid="overlay-aircraft-how">{{ how }}</span>
            </div>
          </div>
          <v-btn
            v-if="state.source.aircraft?.how === 'chosen'"
            variant="text"
            size="small"
            data-testid="overlay-aircraft-auto"
            @click="chooseAircraft(null)"
          >
            Let RigReady pick
          </v-btn>
          <v-select
            class="op-aircraft"
            :items="aircraftItems"
            :model-value="state.source.aircraft?.id"
            label="Aircraft or car"
            density="compact"
            variant="outlined"
            hide-details
            data-testid="overlay-aircraft"
            @update:model-value="chooseAircraft"
          />
        </div>
      </div>

      <template v-for="widget in state.widgets" :key="widget.id">
        <div class="rr-section-title">{{ widget.title }}</div>
        <div
          class="rr-panel op-section"
          data-testid="overlay-widget"
          :data-widget="widget.id"
          :data-showing="widget.showing"
          :data-moving="widget.moving"
          :data-screen="widget.place.screen"
          :data-x="widget.place.at.x"
          :data-y="widget.place.at.y"
        >
          <div class="rr-row">
            <div class="rr-row-main">
              <div class="rr-row-sub">{{ widget.summary }}</div>
              <div v-if="widget.problem" class="rr-row-sub">
                <span class="rr-warn" data-testid="overlay-widget-problem">
                  {{ widget.problem }}
                </span>
              </div>
            </div>
          </div>

          <div class="rr-row">
            <div class="rr-row-main">
              <div class="rr-row-title">Screen</div>
              <div class="rr-row-sub">
                Remembered for that monitor, so it is on the same one after you change your monitor
                layout.
                <span v-if="widget.place.away" data-testid="overlay-away">
                  It belongs on “{{ widget.place.away }}”, which is off now, so it is on the main
                  screen until that one is back.
                </span>
              </div>
            </div>
            <v-select
              class="op-screen-select"
              :items="screenItems"
              :model-value="widget.place.screen"
              label="Screen"
              density="compact"
              variant="outlined"
              hide-details
              data-testid="overlay-screen"
              @update:model-value="putOn(widget, $event)"
            />
          </div>

          <div class="rr-row">
            <div class="rr-row-main">
              <div class="rr-row-title">Place</div>
              <div class="rr-row-sub" data-testid="overlay-place-words">
                <template v-if="widget.moving">
                  It is framed on the screen now: drag it to where it should be, then lock it. While
                  it can be dragged it takes clicks.
                </template>
                <template v-else-if="widget.showing">
                  Pick a corner, an edge or the middle, or move it by hand to anywhere on the
                  screen, clear of what the game shows.
                </template>
                <template v-else-if="state.on">
                  Pick a corner, an edge or the middle. To move it by hand, it has to be showing
                  first.
                </template>
                <template v-else>
                  Pick a corner, an edge or the middle. To move it by hand, turn the overlay on
                  first.
                </template>
              </div>
            </div>
            <div
              class="op-screen"
              :style="[screenShape(widget), markAt(widget)]"
              role="group"
              aria-label="Where on the screen"
              data-testid="overlay-places"
            >
              <button
                v-for="place in NAMED_PLACES"
                :key="place.label"
                type="button"
                class="op-spot"
                :class="{ 'op-spot-on': isAt(widget, place.at) }"
                :title="place.label"
                :aria-label="place.label"
                :aria-pressed="isAt(widget, place.at)"
                data-testid="overlay-place"
                :data-place="place.label"
                @click="putAt(widget, place.at)"
              ></button>
              <span class="op-mark" aria-hidden="true"></span>
            </div>
            <v-btn
              :variant="widget.moving ? 'flat' : 'tonal'"
              :color="widget.moving ? 'primary' : undefined"
              :prepend-icon="widget.moving ? 'mdi-lock-outline' : 'mdi-cursor-move'"
              :disabled="!widget.showing"
              data-testid="overlay-move"
              @click="move(widget, !widget.moving)"
            >
              {{ widget.moving ? 'Lock it here' : 'Move it on screen' }}
            </v-btn>
          </div>

          <component
            :is="WIDGET_PARTS[widget.id]?.options"
            v-if="WIDGET_PARTS[widget.id]"
            :options="widget.options"
            @change="setOptions(widget, $event)"
          />

          <div class="rr-row op-preview-row" data-testid="overlay-preview-row">
            <div class="rr-row-main">
              <div class="rr-row-title">Preview</div>
              <div class="rr-row-sub" data-testid="overlay-preview-words">
                <template v-if="state.on">
                  The size it has over the game, on a bright scene. Press a button on a controller:
                  it shows here as it does there.
                </template>
                <template v-else>
                  The size it has over the game. Turn the overlay on and what you press shows here
                  too.
                </template>
              </div>
            </div>
            <!-- It scrolls when the window is narrower than a large list, so the keyboard
                 must reach it. -->
            <div
              class="op-preview"
              role="group"
              aria-label="Preview of the overlay"
              tabindex="0"
              data-testid="overlay-preview"
            >
              <div class="op-preview-box" :style="previewBox(widget)">
                <component
                  :is="WIDGET_PARTS[widget.id]?.view"
                  v-if="WIDGET_PARTS[widget.id]"
                  :options="widget.options"
                  :at="widget.place.at"
                />
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>
    <PageSkeleton v-else-if="!loadError" label="Reading the overlay…" />
  </div>
</template>

<style scoped>
.op-section {
  margin-bottom: 24px;
}
.op-aircraft {
  flex: none;
  width: 280px;
}
.op-screen-select {
  flex: none;
  width: 280px;
}

/* The screen, small, with the nine places that have a name. */
.op-screen {
  position: relative;
  flex: none;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: repeat(3, 1fr);
  border: 1px solid var(--rr-border-strong);
  border-radius: 6px;
  background: var(--rr-surface-2);
  overflow: hidden;
}
.op-spot {
  position: relative;
  min-width: 0;
  min-height: 0;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}
.op-spot::after {
  content: '';
  position: absolute;
  inset: 0;
  margin: auto;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--rr-border-strong);
}
.op-spot:hover {
  background: var(--rr-surface);
}
.op-spot:hover::after {
  background: var(--rr-text-2);
}
.op-spot:focus-visible {
  outline: 2px solid var(--rr-focus);
  outline-offset: -2px;
}
.op-spot-on::after {
  background: transparent;
}
/* Where it is now: at a named place or wherever it was dragged to. */
.op-mark {
  position: absolute;
  left: calc((100% - 26px) * var(--op-x));
  top: calc((100% - 12px) * var(--op-y));
  width: 26px;
  height: 12px;
  border-radius: 3px;
  background: var(--rr-accent);
  pointer-events: none;
  transition:
    left var(--rr-motion-base) var(--rr-ease),
    top var(--rr-motion-base) var(--rr-ease);
}

.op-preview-row {
  align-items: flex-start;
}
.op-preview {
  flex: none;
  max-width: 60%;
  overflow: auto;
  border: 1px solid var(--rr-border-strong);
  border-radius: 6px;
}
/* A bright sky over ground: about the hardest thing the list has to be read on. */
.op-preview-box {
  background: linear-gradient(180deg, #7fb0dc 0%, #cfe3f2 58%, #8a9a6b 58%, #5d6d47 100%);
}
</style>
