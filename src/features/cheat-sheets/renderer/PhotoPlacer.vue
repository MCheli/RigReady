<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  MAX_VIEWS,
  photo as photos,
  type DeviceDrawing,
  type HatWays,
  type PhysicalControl,
  type Side,
  type Unplaced,
} from '../core/drawings';
import { knownDeviceFor } from '../core/known';
import { controlName } from '../core/layout';
import type { SheetDevice } from '../core/sheet';
import { choosePhoto } from './photoIntake';
import { useCheatSheets } from './store';

/**
 * A drawing from the user's own photos of a device. They press a control on the device,
 * then click where it is on the photo: no numbers to type. A control already on the photo
 * is moved by a new click or a drag, or taken off. The ways of one hat and its press are
 * asked for in turn and share one place. A device seen from several sides has several
 * photos, each with a name. What is and is not placed yet is said at all times; a control
 * not placed still shows on the sheet, in the list under the photo.
 *
 * The drawing belongs to the layout editor: every change goes out as `update:drawing`,
 * and nothing is stored until the editor saves.
 */
const props = defineProps<{
  device: SheetDevice;
  drawing: DeviceDrawing;
  pressed: string[];
  /** RigReady has a drawing of this device to go back to. */
  shipped: boolean;
}>();
const emit = defineEmits<{
  'update:drawing': [drawing: DeviceDrawing];
  problem: [text: string];
  cards: [];
  shipped: [];
}>();
const store = useCheatSheets();

/** The controls RigReady knows by name on this model: pressed, one comes whole. */
const named = computed(() => knownDeviceFor(props.device)?.controls ?? []);

// ---- the photos ----
const views = computed(() => photos.photoViews(props.drawing));
const viewIndex = ref(0);
const view = computed(() => views.value[Math.min(viewIndex.value, views.value.length - 1)]);
watch(
  () => views.value.length,
  (count) => {
    if (viewIndex.value >= count) viewIndex.value = Math.max(0, count - 1);
  }
);
const onView = (control: PhysicalControl): number => photos.viewAt(views.value, control.at);
const shown = computed(() =>
  props.drawing.controls.filter((control) => onView(control) === viewIndex.value)
);
const countOn = (index: number): number =>
  props.drawing.controls.filter((control) => onView(control) === index).length;

// ---- what waits for a click, what was said last, what is selected ----
type HatFlow = { kind: 'hat'; ways: HatWays; step: number; name: string };
type Armed = { kind: 'control'; control: PhysicalControl; placed: boolean } | HatFlow;
const armed = ref<Armed>();
const said = ref('');
const selected = ref<string>();
const selectedControl = computed(() =>
  props.drawing.controls.find((control) => control.id === selected.value)
);

// ---- undo ----
const before: DeviceDrawing[] = [];
const steps = ref(0);
function remember(): void {
  before.push(props.drawing);
  if (before.length > 60) before.shift();
  steps.value = before.length;
}
function change(next: DeviceDrawing): void {
  remember();
  emit('update:drawing', next);
}
function undo(): void {
  const last = before.pop();
  steps.value = before.length;
  if (!last) return;
  armed.value = undefined;
  selected.value = undefined;
  said.value = 'The last change is undone.';
  emit('update:drawing', last);
}

// ---- press a control, then click its place ----
function show(control: PhysicalControl): void {
  const index = onView(control);
  if (index >= 0) viewIndex.value = index;
}

/** Makes the control of an input wait for a click: a new one to place, or a placed one to move. */
function arm(input: string): void {
  const fresh = photos.controlOfInput(input, named.value);
  // Placed already: by this input, or as the control it is one more way of.
  const placed =
    photos.controlWith(props.drawing, input) ??
    props.drawing.controls.find((control) => control.id === fresh.id);
  said.value = '';
  if (placed) {
    armed.value = { kind: 'control', control: placed, placed: true };
    selected.value = placed.id;
    show(placed);
    return;
  }
  armed.value = { kind: 'control', control: fresh, placed: false };
  selected.value = undefined;
}

function cancel(): void {
  armed.value = undefined;
  said.value = '';
}

watch(
  () => props.pressed,
  (now, was) => {
    const fresh = now.find((id) => !(was ?? []).includes(id));
    if (!fresh) return;
    const flow = armed.value;
    if (flow?.kind === 'hat') hatHeard(flow, fresh);
    else arm(fresh);
  }
);

/** An axis moved this far (of its -1 to 1) was moved on purpose, not shaken by a press. */
const AXIS_ARM = 0.5;
let rest: Record<string, number> | undefined;
const axes = computed(() => (props.device.guid ? store.axes.get(props.device.guid) : undefined));
watch(axes, (now) => {
  if (!now) return;
  // While something waits for its click an axis changes nothing: it starts from here after.
  if (armed.value || !rest) {
    rest = { ...now };
    return;
  }
  const from = rest;
  const moved = Object.keys(now).find(
    (id) => Math.abs(now[id]! - (from[id] ?? now[id]!)) > AXIS_ARM
  );
  if (!moved) return;
  rest = { ...now };
  const placed = photos.controlWith(props.drawing, moved);
  if (!placed) {
    arm(moved);
    return;
  }
  // An axis is moved by accident far more often than a button is pressed: one that is
  // placed is only shown, never made to wait for a click that would move it.
  selected.value = placed.id;
  show(placed);
  said.value = `${placed.name} is on the photo already.`;
});

// ---- a hat: its ways in turn, then one place ----
const PRESS_STEP = photos.HAT_WAYS.findIndex((way) => way.key === 'press');

function startHat(): void {
  armed.value = {
    kind: 'hat',
    ways: {},
    step: 0,
    name: photos.nextHatName(props.drawing, props.device.reports),
  };
  selected.value = undefined;
  said.value = '';
}

function hatReady(flow: HatFlow): void {
  const pov = photos.povOf(flow.ways);
  const pushed = flow.ways.up;
  if (pov !== undefined && pushed && !flow.ways.press) {
    // A hat Windows reports, with no press of its own, is the control a push of it gives
    // anywhere else on this page: by its known name, and moved when it is placed already.
    arm(pushed);
    return;
  }
  const control = photos.hatGroup(flow.ways, pov === undefined ? flow.name : `Hat ${pov}`);
  if (!control) {
    armed.value = undefined;
    said.value = 'No way of the hat was pushed, so there is nothing to place.';
    return;
  }
  armed.value = { kind: 'control', control, placed: false };
}

function hatNext(flow: HatFlow): void {
  if (flow.step + 1 >= photos.HAT_WAYS.length) hatReady(flow);
  else armed.value = { ...flow, step: flow.step + 1 };
}

function hatHeard(flow: HatFlow, id: string): void {
  const way = photos.HAT_WAYS[flow.step];
  if (!way) return;
  if (id.startsWith('hat:')) {
    // A hat Windows reports as a hat says all its ways with one push. Only its press is
    // left to ask for.
    if (way.key !== 'press') armed.value = { ...flow, ways: { up: id }, step: PRESS_STEP };
    return;
  }
  // The same button again is the one still held, not the next way.
  if (Object.values(flow.ways).includes(id)) return;
  hatNext({ ...flow, ways: { ...flow.ways, [way.key]: id } });
}

function hatSkip(): void {
  const flow = armed.value;
  if (flow?.kind === 'hat') hatNext(flow);
}

function hatDone(): void {
  const flow = armed.value;
  if (flow?.kind === 'hat') hatReady(flow);
}

const hatHeardText = computed(() => {
  const flow = armed.value;
  if (flow?.kind !== 'hat') return '';
  if (photos.povOf(flow.ways) !== undefined) return 'all its ways';
  return photos.HAT_WAYS.filter((way) => flow.ways[way.key])
    .map((way) => `${way.tag} ${controlName(flow.ways[way.key]!)}`)
    .join(', ');
});

// ---- the words over the photo ----
const state = computed(() => {
  const now = armed.value;
  if (!now) return 'idle';
  if (now.kind === 'hat') return 'hat';
  return now.placed ? 'move' : 'place';
});
const ask = computed(() => {
  const now = armed.value;
  if (now?.kind === 'hat') return photos.HAT_WAYS[now.step]?.ask ?? '';
  if (now?.kind === 'control') {
    return now.placed
      ? `${now.control.name} is on the photo already.`
      : `${now.control.name}: click where it is on the photo.`;
  }
  if (said.value) return said.value;
  return props.device.connected
    ? 'Press a control on the device.'
    : 'This device is not connected.';
});
const more = computed(() => {
  const now = armed.value;
  if (now?.kind === 'hat') {
    // A hat Windows reports says which hat it is with its first push: its own name from then.
    const pushed = photos.povOf(now.ways) !== undefined ? now.ways.up : undefined;
    const name = pushed ? photos.controlOfInput(pushed, named.value).name : now.name;
    const count = `${name}, step ${now.step + 1} of ${photos.HAT_WAYS.length}.`;
    return hatHeardText.value
      ? `${count} So far: ${hatHeardText.value}.`
      : `${count} Each way of the hat is asked for in turn. They share one place on the photo.`;
  }
  if (now?.kind === 'control') {
    if (now.placed) return 'Click a new place to move it, or take it off.';
    const ways = now.control.inputs.length;
    const wrong = props.device.connected
      ? 'Pressed the wrong one? Press another.'
      : 'Picked the wrong one? Click another.';
    return ways > 1 ? `Its ${ways} ways share this one place. ${wrong}` : wrong;
  }
  if (!props.device.connected) {
    return 'Pressing it does nothing here. Click a control under Not placed yet, then click its place on the photo.';
  }
  return props.drawing.controls.length === 0
    ? 'Then click where it is on the photo. No numbers to type. You can save once one control is placed.'
    : 'Then click where it is on the photo. For a hat with several ways, use Place a hat.';
});

// ---- the photo: click, drag, keys ----
const canvas = ref<SVGSVGElement>();
/** Drawing units per pixel on screen: dots and their names keep one size on any photo. */
const unit = ref(1);
function measure(): void {
  const box = canvas.value?.getBoundingClientRect();
  const now = view.value;
  if (!box || !now || box.width <= 0 || box.height <= 0) return;
  unit.value = Math.max(now.w / box.width, now.h / box.height);
}
watch(view, () => void nextTick(measure));

interface Point {
  x: number;
  y: number;
}
/** Where the pointer is on the photo shown, in drawing units, kept on that photo. */
function point(event: PointerEvent): Point {
  const matrix = canvas.value?.getScreenCTM();
  const now = view.value;
  if (!matrix || !now) return { x: 0, y: 0 };
  const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  return within({ x: p.x, y: p.y });
}
function within(at: Point): Point {
  const now = view.value;
  if (!now) return at;
  return {
    x: Math.max(now.x, Math.min(now.x + now.w, at.x)),
    y: Math.max(now.y, Math.min(now.y + now.h, at.y)),
  };
}

let drag: { id: string; moved: boolean; x: number; y: number } | undefined;

function down(event: PointerEvent): void {
  if (event.button !== 0) return;
  const now = armed.value;
  if (now?.kind === 'hat') return;
  if (now) {
    change(photos.place(props.drawing, now.control, point(event)));
    const next = props.device.connected
      ? 'Press the next control.'
      : 'Click the next one under Not placed yet.';
    said.value = now.placed
      ? `${now.control.name} is moved.`
      : `${now.control.name} is placed. ${next}`;
    selected.value = now.control.id;
    armed.value = undefined;
    event.preventDefault();
    return;
  }
  const dot = (event.target as Element).closest<SVGElement>('[data-dot]');
  const id = dot?.dataset['dot'];
  selected.value = id;
  if (!id) return;
  drag = { id, moved: false, x: event.clientX, y: event.clientY };
  canvas.value?.setPointerCapture(event.pointerId);
  event.preventDefault();
}

function move(event: PointerEvent): void {
  if (!drag) return;
  if (!drag.moved) {
    // A click that slips a pixel or two is a click, not a move.
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 3) return;
    drag.moved = true;
    remember();
  }
  emit('update:drawing', photos.moveTo(props.drawing, drag.id, point(event)));
}

function up(event: PointerEvent): void {
  if (!drag) return;
  drag = undefined;
  canvas.value?.releasePointerCapture(event.pointerId);
}

function takeOff(id: string): void {
  const control = props.drawing.controls.find((c) => c.id === id);
  if (!control) return;
  change(photos.takeOff(props.drawing, id));
  said.value = `${control.name} is off the photo.`;
  selected.value = undefined;
  armed.value = undefined;
}

function key(event: KeyboardEvent): void {
  if ((event.target as HTMLElement).closest('input, textarea')) return;
  if (event.key === 'Escape' && armed.value) {
    cancel();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    undo();
    event.preventDefault();
    return;
  }
  const control = selectedControl.value;
  if (!control || armed.value) return;
  const step = event.shiftKey ? 10 : 1;
  const delta: Record<string, [number, number]> = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, -step],
    ArrowDown: [0, step],
  };
  const by = delta[event.key];
  if (by) {
    const at = within({ x: control.at.x + by[0], y: control.at.y + by[1] });
    change(photos.moveTo(props.drawing, control.id, at));
    event.preventDefault();
  } else if (event.key === 'Delete') {
    takeOff(control.id);
  }
}

// ---- the selected control ----
const selectedInputs = computed(() =>
  (selectedControl.value?.inputs ?? [])
    .map((input) => (input.tag ? `${input.tag} ` : '') + controlName(input.id))
    .join(', ')
);
/**
 * What is typed in the name field of the control. It is kept apart from the drawing until
 * the field is left: the page is drawn again each time the device reports something, and
 * that must not take the letters typed so far back.
 */
const controlNameText = ref('');
watch(
  [() => selectedControl.value?.id, () => selectedControl.value?.name],
  ([, name]) => (controlNameText.value = name ?? ''),
  { immediate: true }
);
function rename(): void {
  const control = selectedControl.value;
  if (!control) return;
  const name = controlNameText.value.trim();
  // An emptied field keeps the name the control had.
  controlNameText.value = name || control.name;
  if (name) change(photos.renameControl(props.drawing, control.id, name));
}
function setSide(side: string): void {
  const control = selectedControl.value;
  if (!control) return;
  change(
    photos.sideControl(props.drawing, control.id, side === 'auto' ? undefined : (side as Side))
  );
}

// ---- what is placed and what is not ----
const bound = computed(() =>
  props.device.controls.filter((c) => c.bindings.length > 0 || c.note).map((c) => c.id)
);
const progress = computed(() =>
  photos.placement(props.drawing, props.device.reports, bound.value, named.value)
);
/** A control not placed yet whose chip lights while it is held: this is the one. */
function held(chip: Unplaced): boolean {
  const ids = photos.controlOfInput(chip.input, named.value).inputs.map((input) => input.id);
  return props.pressed.some((id) => ids.includes(id));
}

// ---- several photos ----
const keptChars = (skip = -1): number =>
  views.value.reduce((sum, item, index) => sum + (index === skip ? 0 : item.image.length), 0);

async function addView(): Promise<void> {
  emit('problem', '');
  const got = await choosePhoto(store.api, keptChars());
  if (got.problem) emit('problem', got.problem);
  const next = got.photo ? photos.addView(props.drawing, got.photo) : undefined;
  if (!next) return;
  change(next);
  viewIndex.value = photos.photoViews(next).length - 1;
  armed.value = undefined;
  said.value = 'The photo is added. Give each photo a name, such as Top or Back.';
}

async function replaceView(): Promise<void> {
  emit('problem', '');
  const index = viewIndex.value;
  const got = await choosePhoto(store.api, keptChars(index));
  if (got.problem) emit('problem', got.problem);
  if (!got.photo) return;
  change(photos.replaceView(props.drawing, index, got.photo));
  said.value = 'The photo is replaced. Check that each control is still at its place.';
}

function removeView(): void {
  const index = viewIndex.value;
  const gone = view.value;
  if (!gone || views.value.length < 2) return;
  const count = countOn(index);
  change(photos.removeView(props.drawing, index));
  viewIndex.value = Math.max(0, index - 1);
  armed.value = undefined;
  selected.value = undefined;
  said.value =
    count === 0
      ? `The photo ${gone.name} is removed.`
      : `The photo ${gone.name} is removed, and with it ${count === 1 ? 'the control' : `the ${count} controls`} placed on it.`;
}

/** What is typed in the name field of the photo, kept like the name of a control is. */
const viewNameText = ref('');
watch([viewIndex, () => view.value?.name], ([, name]) => (viewNameText.value = name ?? ''), {
  immediate: true,
});
function renameView(): void {
  const name = viewNameText.value.trim();
  viewNameText.value = name || (view.value?.name ?? '');
  if (name) change(photos.renameView(props.drawing, viewIndex.value, name));
}

// ---- drawing the dots ----
/** How wide the name of a dot is drawn, in pixels. */
const tagWidth = (control: PhysicalControl): number => 14 + control.name.length * 6.6;
/** The name goes left of a dot near the right edge of the photo. */
function tagLeft(control: PhysicalControl): boolean {
  const now = view.value;
  return now ? control.at.x > now.x + now.w * 0.62 : false;
}
const lit = (control: PhysicalControl): boolean =>
  control.inputs.some((input) => props.pressed.includes(input.id));

let observer: ResizeObserver | undefined;
onMounted(() => {
  observer = new ResizeObserver(measure);
  if (canvas.value) observer.observe(canvas.value);
  measure();
  window.addEventListener('keydown', key);
});
onBeforeUnmount(() => {
  observer?.disconnect();
  window.removeEventListener('keydown', key);
});
</script>

<template>
  <div class="ph" data-testid="photo-placer">
    <div class="ph-prompt rr-panel" data-testid="photo-prompt" :data-state="state">
      <div class="rr-row-main">
        <div class="ph-ask" data-testid="photo-ask">{{ ask }}</div>
        <div class="rr-row-sub" data-testid="photo-ask-more">{{ more }}</div>
      </div>
      <template v-if="armed?.kind === 'hat'">
        <v-btn size="small" variant="tonal" data-testid="photo-hat-skip" @click="hatSkip">{{
          armed.step === PRESS_STEP ? 'It does not press' : 'Skip this way'
        }}</v-btn>
        <v-btn
          size="small"
          variant="tonal"
          :disabled="!hatHeardText"
          data-testid="photo-hat-done"
          @click="hatDone"
          >That is all of it</v-btn
        >
      </template>
      <v-btn
        v-if="armed?.kind === 'control' && armed.placed"
        size="small"
        variant="tonal"
        color="warning"
        data-testid="photo-armed-take-off"
        @click="takeOff(armed.control.id)"
        >Take it off the photo</v-btn
      >
      <v-btn v-if="armed" size="small" variant="text" data-testid="photo-cancel" @click="cancel"
        >Cancel</v-btn
      >
      <v-btn
        v-else
        size="small"
        variant="tonal"
        prepend-icon="mdi-gamepad-circle-outline"
        data-testid="photo-hat"
        @click="startHat"
        >Place a hat…</v-btn
      >
      <v-btn
        size="small"
        variant="text"
        prepend-icon="mdi-undo"
        :disabled="steps === 0"
        data-testid="photo-undo"
        @click="undo"
        >Undo</v-btn
      >
    </div>

    <div class="ph-row">
      <div class="ph-main">
        <div class="ph-tabs">
          <button
            v-for="(item, index) in views"
            :key="index"
            type="button"
            class="ph-tab"
            :class="{ on: index === viewIndex }"
            data-testid="photo-view-tab"
            :data-view="index"
            :data-placed="countOn(index)"
            @click="viewIndex = index"
          >
            {{ item.name }} <span class="ph-count">· {{ countOn(index) }} placed</span>
          </button>
          <v-btn
            size="small"
            variant="text"
            prepend-icon="mdi-image-plus-outline"
            :disabled="views.length >= MAX_VIEWS"
            data-testid="photo-add-view"
            @click="addView"
            >Add another photo…</v-btn
          >
        </div>
        <svg
          v-if="view"
          ref="canvas"
          class="ph-canvas"
          :class="{ aim: state === 'place' || state === 'move' }"
          data-testid="photo-canvas"
          :viewBox="`${view.x} ${view.y} ${view.w} ${view.h}`"
          :style="{ aspectRatio: `${view.w} / ${view.h}` }"
          @pointerdown="down"
          @pointermove="move"
          @pointerup="up"
          @pointercancel="up"
        >
          <image
            :href="view.image"
            :x="view.x"
            :y="view.y"
            :width="view.w"
            :height="view.h"
            preserveAspectRatio="xMidYMid meet"
          />
          <g
            v-for="control in shown"
            :key="control.id"
            class="ph-dot"
            :class="{ on: lit(control), sel: control.id === selected }"
            data-testid="photo-dot"
            :data-dot="control.id"
            :transform="`translate(${control.at.x} ${control.at.y}) scale(${unit})`"
          >
            <rect
              class="ph-tag"
              :x="tagLeft(control) ? -(15 + tagWidth(control)) : 15"
              y="-11"
              :width="tagWidth(control)"
              height="22"
              rx="6"
            />
            <text class="ph-name" :x="tagLeft(control) ? -(8 + tagWidth(control)) : 22" y="4.5">
              {{ control.name }}
            </text>
            <circle class="ph-ring" r="10" />
            <circle class="ph-spot" r="4" />
          </g>
        </svg>
      </div>

      <aside class="ph-side rr-panel" data-testid="photo-side">
        <div class="rr-section-title">Placed</div>
        <div
          class="ph-progress"
          data-testid="photo-progress"
          :data-placed="progress.placed"
          :data-total="progress.total"
        >
          {{ progress.placed }} of {{ progress.total }} controls placed
        </div>
        <v-progress-linear
          :model-value="progress.total ? (100 * progress.placed) / progress.total : 0"
          height="6"
          rounded
          color="primary"
          class="mt-1"
        />
        <template v-if="progress.unplaced.length > 0">
          <div class="rr-row-sub mt-2" data-testid="photo-unplaced-text">
            Not placed yet: {{ progress.text }}.
          </div>
          <div class="ph-tray mt-1" data-testid="photo-unplaced">
            <button
              v-for="chip in progress.unplaced"
              :key="chip.key"
              type="button"
              class="ph-chip"
              :class="{ on: held(chip) }"
              data-testid="photo-chip"
              :data-control="chip.key"
              @click="arm(chip.input)"
            >
              {{ chip.label }}{{ chip.bound ? ' •' : '' }}
            </button>
          </div>
          <div class="rr-row-sub mt-1">
            Click one to place it without pressing it. • is in use. What is not placed still shows
            on the sheet, in the list under the photo.
          </div>
        </template>
        <div v-else class="rr-row-sub mt-2" data-testid="photo-unplaced-text">
          Every control is placed.
        </div>

        <div class="rr-section-title mt-4">Selected</div>
        <template v-if="selectedControl">
          <input
            v-model="controlNameText"
            class="ph-input"
            maxlength="60"
            aria-label="Name of the control"
            data-testid="photo-control-name"
            @change="rename()"
          />
          <div class="rr-row-sub mt-1" data-testid="photo-control-inputs">{{ selectedInputs }}</div>
          <div class="rr-row-sub mt-2">Label goes</div>
          <v-btn-toggle
            :model-value="selectedControl.side ?? 'auto'"
            density="compact"
            variant="outlined"
            divided
            mandatory
            data-testid="photo-control-side"
            @update:model-value="setSide(String($event))"
          >
            <v-btn size="small" value="auto">Nearest</v-btn>
            <v-btn size="small" value="left" data-testid="photo-side-left">Left</v-btn>
            <v-btn size="small" value="right" data-testid="photo-side-right">Right</v-btn>
          </v-btn-toggle>
          <div class="ph-actions">
            <v-btn
              size="small"
              variant="text"
              color="warning"
              data-testid="photo-take-off"
              @click="takeOff(selectedControl.id)"
              >Take it off the photo</v-btn
            >
          </div>
        </template>
        <div v-else class="rr-muted ph-hint">
          Nothing selected. Click a dot on the photo to name it or take it off. Drag a dot to move
          it.
        </div>

        <div class="rr-section-title mt-4">This photo</div>
        <input
          v-if="view"
          v-model="viewNameText"
          class="ph-input"
          maxlength="40"
          aria-label="Name of the photo"
          data-testid="photo-view-name"
          @change="renameView()"
        />
        <div class="ph-actions">
          <v-btn size="small" variant="tonal" data-testid="photo-view-replace" @click="replaceView"
            >Replace…</v-btn
          >
          <v-btn
            v-if="views.length > 1"
            size="small"
            variant="text"
            color="warning"
            data-testid="photo-view-remove"
            @click="removeView"
            >Remove</v-btn
          >
        </div>
        <div class="rr-row-sub mt-2" data-testid="photo-private">
          <v-icon icon="mdi-lock-outline" size="14" /> Your photos stay on this PC, in RigReady's
          folder. Nothing is uploaded. They show only on sheets you print, export or share yourself.
        </div>

        <div class="rr-section-title mt-4">Instead</div>
        <div class="ph-actions">
          <v-btn
            v-if="shipped"
            size="small"
            variant="text"
            prepend-icon="mdi-draw"
            data-testid="photo-use-shipped"
            @click="emit('shipped')"
            >Use RigReady's drawing</v-btn
          >
          <v-btn
            size="small"
            variant="text"
            prepend-icon="mdi-card-outline"
            data-testid="photo-use-cards"
            @click="emit('cards')"
            >Arrange cards myself</v-btn
          >
        </div>
        <div class="rr-row-sub">Your photos and what you placed are dropped.</div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.ph-prompt {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  margin-bottom: 10px;
  position: sticky;
  top: 60px;
  z-index: 2;
  border-left: 3px solid var(--rr-accent);
}
.ph-ask {
  font-size: 17px;
  font-weight: 650;
}
.ph-row {
  display: flex;
  gap: 14px;
  align-items: flex-start;
}
.ph-main {
  flex: 1;
  min-width: 0;
}
.ph-tabs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}
.ph-tab {
  font-size: 13px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 8px;
  border: 1px solid var(--rr-border);
  background: var(--rr-surface-2);
  color: var(--rr-text);
  cursor: pointer;
}
.ph-tab.on {
  border-color: var(--rr-accent);
  color: var(--rr-accent);
}
.ph-count {
  font-weight: 500;
  margin-left: 4px;
}
.ph-canvas {
  display: block;
  width: 100%;
  min-height: 260px;
  max-height: calc(100vh - 250px);
  touch-action: none;
  user-select: none;
  border: 1px dashed var(--rr-border);
  border-radius: 10px;
  background: var(--rr-surface-2);
}
.ph-canvas.aim {
  cursor: crosshair;
  border-color: var(--rr-accent);
  border-style: solid;
}
.ph-dot {
  cursor: grab;
}
.ph-canvas.aim .ph-dot {
  cursor: crosshair;
}
.ph-ring {
  fill: rgba(10, 14, 20, 0.55);
  stroke: #ffffff;
  stroke-width: 2;
}
.ph-spot {
  fill: #ffffff;
}
.ph-tag {
  fill: rgba(10, 14, 20, 0.8);
}
.ph-name {
  fill: #ffffff;
  font-size: 12px;
  font-weight: 600;
}
.ph-dot.sel .ph-ring {
  stroke: var(--rr-accent);
  stroke-width: 3;
}
.ph-dot.sel .ph-spot {
  fill: var(--rr-accent);
}
.ph-dot.on .ph-ring {
  fill: var(--rr-accent);
}
.ph-side {
  width: 272px;
  flex-shrink: 0;
  padding: 12px 14px;
  position: sticky;
  top: 132px;
  max-height: calc(100vh - 148px);
  overflow-y: auto;
}
.ph-progress {
  font-size: 15px;
  font-weight: 650;
}
.ph-tray {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  max-height: 132px;
  overflow-y: auto;
}
.ph-chip {
  font-size: 12px;
  min-width: 30px;
  padding: 2px 7px;
  border-radius: 6px;
  border: 1px solid var(--rr-border);
  background: var(--rr-surface-2);
  color: var(--rr-text);
  cursor: pointer;
}
.ph-chip:hover,
.ph-chip.on {
  border-color: var(--rr-accent);
}
.ph-chip.on {
  background: var(--rr-accent);
  color: #0b0f14;
}
.ph-input {
  width: 100%;
  font-size: 14px;
  padding: 6px 8px;
  margin-top: 4px;
  border-radius: 6px;
  border: 1px solid var(--rr-border);
  background: var(--rr-surface-2);
  color: var(--rr-text);
}
.ph-input:focus {
  outline: 2px solid var(--rr-accent);
  outline-offset: 0;
}
.ph-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
.ph-hint {
  font-size: 12.5px;
}
</style>
