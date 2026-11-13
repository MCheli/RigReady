<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { planCaptions } from '../core/mapCaptions';
import { boundingBox, monitorLabels, type DesktopDisplay, type Rect } from '../core/screens';

/**
 * The desktop drawn to scale with DCS viewports on it. Editable boxes can be dragged to
 * another monitor (or around one) and resized by their edges; both snap to monitor edges.
 */
export interface MapBox {
  key: string;
  /** Large text: "Left DDI". */
  label: string;
  /** Small text: "LEFT_MFCD". */
  name: string;
  /** Desktop coordinates. */
  rect: Rect;
  displayId?: string;
  editable: boolean;
  selected?: boolean;
  /** Drawn as a problem (not on a monitor). */
  bad?: boolean;
}

/**
 * Something DCS draws that the user cannot place here (the kneeboard): an outline with a
 * tag, over the viewports, that takes no clicks so the viewports under it still drag.
 */
export interface MapOutline {
  key: string;
  label: string;
  /** Desktop coordinates. */
  rect: Rect;
  /** Drawn as a problem (not all of it on one monitor). */
  bad?: boolean;
}

const props = defineProps<{
  displays: DesktopDisplay[];
  mainIds: string[];
  boxes: MapBox[];
  outlines?: MapOutline[];
  /** The DCS window, outlined when given. */
  window?: Rect | undefined;
}>();
const emit = defineEmits<{
  select: [key: string];
  place: [key: string, displayId: string, rect: Rect];
}>();

const SNAP = 14;
const MIN = 40;

const labels = computed(() => monitorLabels(props.displays));
const area = computed<Rect>(() => {
  const rects: Rect[] = [
    ...props.displays,
    ...props.boxes.map((b) => b.rect),
    ...(props.outlines ?? []).map((o) => o.rect),
  ];
  return rects.length ? boundingBox(rects) : { x: 0, y: 0, width: 1, height: 1 };
});

const pct = (r: Rect) => {
  const a = area.value;
  return {
    left: `${((r.x - a.x) / a.width) * 100}%`,
    top: `${((r.y - a.y) / a.height) * 100}%`,
    width: `${(r.width / a.width) * 100}%`,
    height: `${(r.height / a.height) * 100}%`,
  };
};

const map = ref<HTMLElement>();
type Edge = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const drag = ref<{
  key: string;
  edge: Edge;
  start: { x: number; y: number };
  from: Rect;
  rect: Rect;
  over?: string;
}>();

function toDesktop(e: PointerEvent): { x: number; y: number } {
  const r = map.value!.getBoundingClientRect();
  const a = area.value;
  return {
    x: a.x + ((e.clientX - r.left) / r.width) * a.width,
    y: a.y + ((e.clientY - r.top) / r.height) * a.height,
  };
}

const displayAt = (p: { x: number; y: number }) =>
  props.displays.find(
    (d) => p.x >= d.x && p.x < d.x + d.width && p.y >= d.y && p.y < d.y + d.height
  );

function snap(value: number, edges: number[]): number {
  for (const edge of edges) if (Math.abs(value - edge) <= SNAP) return edge;
  return Math.round(value);
}

function start(box: MapBox, edge: Edge, e: PointerEvent): void {
  if (!box.editable || e.button !== 0) return;
  emit('select', box.key);
  (e.target as HTMLElement).setPointerCapture(e.pointerId);
  drag.value = {
    key: box.key,
    edge,
    start: toDesktop(e),
    from: { ...box.rect },
    rect: { ...box.rect },
    ...(box.displayId ? { over: box.displayId } : {}),
  };
  e.preventDefault();
}

function moveTo(e: PointerEvent): void {
  const d = drag.value;
  if (!d) return;
  const p = toDesktop(e);
  const dx = p.x - d.start.x;
  const dy = p.y - d.start.y;
  const f = d.from;
  if (d.edge === 'move') {
    const target = displayAt(p);
    if (target) d.over = target.id;
    const host = props.displays.find((x) => x.id === d.over);
    let x = f.x + dx;
    let y = f.y + dy;
    if (host) {
      x = snap(x, [host.x, host.x + host.width - f.width]);
      y = snap(y, [host.y, host.y + host.height - f.height]);
    }
    d.rect = { x: Math.round(x), y: Math.round(y), width: f.width, height: f.height };
    return;
  }
  const host = props.displays.find((x) => x.id === d.over);
  if (!host) return;
  let left = f.x;
  let top = f.y;
  let right = f.x + f.width;
  let bottom = f.y + f.height;
  if (d.edge.includes('w')) left = Math.min(snap(f.x + dx, [host.x]), right - MIN);
  if (d.edge.includes('e')) right = Math.max(snap(right + dx, [host.x + host.width]), left + MIN);
  if (d.edge.includes('n')) top = Math.min(snap(f.y + dy, [host.y]), bottom - MIN);
  if (d.edge.includes('s')) bottom = Math.max(snap(bottom + dy, [host.y + host.height]), top + MIN);
  left = Math.max(left, host.x);
  top = Math.max(top, host.y);
  right = Math.min(right, host.x + host.width);
  bottom = Math.min(bottom, host.y + host.height);
  d.rect = { x: left, y: top, width: right - left, height: bottom - top };
}

function end(): void {
  const d = drag.value;
  drag.value = undefined;
  if (!d || !d.over) return;
  const moved =
    d.rect.x !== d.from.x ||
    d.rect.y !== d.from.y ||
    d.rect.width !== d.from.width ||
    d.rect.height !== d.from.height;
  if (moved) emit('place', d.key, d.over, d.rect);
}

const shown = (box: MapBox): Rect => (drag.value?.key === box.key ? drag.value.rect : box.rect);
const EDGES: Edge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

// How wide the map is drawn, so a monitor's name can keep clear of the viewports over it.
const drawnWidth = ref(0);
let resized: ResizeObserver | undefined;
onMounted(() => {
  if (!map.value) return;
  drawnWidth.value = map.value.clientWidth;
  resized = new ResizeObserver(() => {
    drawnWidth.value = map.value?.clientWidth ?? 0;
  });
  resized.observe(map.value);
});
onBeforeUnmount(() => resized?.disconnect());

const captions = computed(() =>
  planCaptions(
    props.displays,
    props.boxes.map((box) => ({ key: box.key, rect: shown(box) })),
    drawnWidth.value / area.value.width
  )
);
/** The name of a monitor that is drawn on the monitor itself, and how tall it may be. */
const ownName = (d: DesktopDisplay): { height: string } | undefined => {
  const place = captions.value.monitors.get(d.id);
  if (!place || place.on !== 'monitor') return undefined;
  return { height: place.room === undefined ? '100%' : `${place.room}px` };
};
const size = (d: DesktopDisplay): string => `${d.width}×${d.height}`;
/** The monitor whose name this viewport shows above its own text. */
const named = (
  box: MapBox
): { label: string; size?: string; tip: string; short: boolean } | undefined => {
  const held = captions.value.viewports.get(box.key);
  const monitor = held && props.displays.find((d) => d.id === held.monitor);
  if (!held || !monitor) return undefined;
  const label = labels.value.get(monitor.id) ?? '';
  return {
    label,
    ...(held.withSize ? { size: size(monitor) } : {}),
    tip: `${label} · ${size(monitor)}`,
    short: held.short,
  };
};
</script>

<template>
  <div
    ref="map"
    class="smap"
    :style="{ paddingBottom: `${(area.height / area.width) * 100}%` }"
    data-testid="screen-map"
    @pointermove="moveTo"
    @pointerup="end"
    @pointercancel="end"
  >
    <div
      v-for="d in displays"
      :key="d.id"
      class="smap-display"
      :class="{
        main: mainIds.includes(d.id),
        target: drag?.edge === 'move' && drag.over === d.id,
      }"
      :style="pct(d)"
      data-testid="screen-map-display"
      :data-name="labels.get(d.id)"
    >
      <div v-if="ownName(d)" class="smap-caption" :style="ownName(d)">
        <span class="smap-display-name" data-testid="screen-map-display-name">{{
          labels.get(d.id)
        }}</span>
        <span class="smap-display-size">{{ size(d) }}</span>
      </div>
      <span v-if="mainIds.includes(d.id)" class="smap-main-tag">Main view</span>
    </div>
    <div v-if="window" class="smap-window" :style="pct(window)" title="The DCS window" />
    <div
      v-for="box in boxes"
      :key="box.key"
      class="smap-box"
      :class="{
        editable: box.editable,
        selected: box.selected,
        bad: box.bad,
        dragging: drag?.key === box.key,
        naming: !!named(box),
        short: named(box)?.short,
      }"
      :style="pct(shown(box))"
      data-testid="screen-map-box"
      :data-name="box.name"
      @pointerdown="start(box, 'move', $event)"
    >
      <!-- The monitor's name, when this viewport covers the corner where the monitor shows it. -->
      <span v-if="named(box)" class="smap-box-monitor" :title="named(box)!.tip">
        <span class="smap-box-monitor-name" data-testid="screen-map-display-name">{{
          named(box)!.label
        }}</span>
        <span v-if="named(box)!.size" class="smap-display-size">{{ named(box)!.size }}</span>
      </span>
      <span class="smap-box-text">
        <span class="smap-box-label">{{ box.label }}</span>
        <span v-if="box.name !== box.label" class="smap-box-name">{{ box.name }}</span>
      </span>
      <template v-if="box.editable && box.selected">
        <span
          v-for="edge in EDGES"
          :key="edge"
          class="smap-handle"
          :class="`smap-${edge}`"
          :data-testid="`screen-map-handle-${edge}`"
          @pointerdown.stop="start(box, edge, $event)"
        />
      </template>
    </div>
    <div
      v-for="outline in outlines ?? []"
      :key="outline.key"
      class="smap-outline"
      :class="{ bad: outline.bad }"
      :style="pct(outline.rect)"
      data-testid="screen-map-outline"
      :data-name="outline.key"
      :data-bad="!!outline.bad"
    >
      <span class="smap-outline-tag">{{ outline.label }}</span>
    </div>
  </div>
</template>

<style scoped>
.smap {
  position: relative;
  width: 100%;
  user-select: none;
  touch-action: none;
}
.smap-display {
  position: absolute;
  border: 1px solid var(--rr-border);
  outline: 2px solid var(--rr-bg);
  outline-offset: -3px;
  background: var(--rr-surface-2);
  font-size: 11.5px;
  overflow: hidden;
  color: var(--rr-muted);
}
.smap-display.main {
  background: color-mix(in srgb, var(--rr-accent) 10%, var(--rr-surface-2));
  border-color: color-mix(in srgb, var(--rr-accent) 55%, var(--rr-border));
}
.smap-display.target {
  border-color: var(--rr-accent);
  border-style: dashed;
}
/* The monitor's name and size, in the room above the first viewport drawn on the monitor. A line
   that does not fit in that room wraps into a second column, which is cut off: the size goes
   before the name does. The side padding is on the lines, so that column starts past the edge. */
.smap-caption {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  max-height: 100%;
  box-sizing: border-box;
  padding-top: 4px;
  display: flex;
  flex-flow: column wrap;
  align-content: flex-start;
  overflow: hidden;
}
.smap-caption > span {
  width: 100%;
  box-sizing: border-box;
  padding: 0 7px;
}
.smap-display-name {
  color: var(--rr-text);
  line-height: 13px;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
}
.smap-display-size {
  font-size: 10.5px;
  line-height: 13px;
}
/* On the tinted main screen the muted grey is too faint to read. */
.smap-display.main .smap-display-size {
  color: color-mix(in srgb, var(--rr-text) 75%, var(--rr-muted));
}
.smap-main-tag {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--rr-accent);
  pointer-events: none;
}
.smap-window {
  position: absolute;
  border: 1px dashed color-mix(in srgb, var(--rr-text) 35%, transparent);
  pointer-events: none;
}
.smap-box {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  background: color-mix(in srgb, #9b7bea 26%, transparent);
  border: 1px solid #9b7bea;
  border-radius: 3px;
  font-size: 11.5px;
  overflow: visible;
  color: var(--rr-text);
}
.smap-box.editable {
  cursor: grab;
}
.smap-box.dragging {
  cursor: grabbing;
  opacity: 0.85;
  z-index: 3;
}
.smap-box.selected {
  border-width: 2px;
  background: color-mix(in srgb, #9b7bea 40%, transparent);
  z-index: 2;
}
.smap-box.bad {
  border-color: var(--rr-warn);
  background: color-mix(in srgb, var(--rr-warn) 22%, transparent);
}
.smap-box-text {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
/* Drawn over the viewports and takes no clicks: what is under it can still be dragged. */
.smap-outline {
  position: absolute;
  z-index: 4;
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  border: 1px dashed var(--rr-ok);
  border-radius: 3px;
  pointer-events: none;
}
.smap-outline.bad {
  border-color: var(--rr-warn);
}
.smap-outline-tag {
  margin: 0 3px 3px 0;
  padding: 0 5px;
  border-radius: 3px;
  font-size: 10.5px;
  line-height: 16px;
  white-space: nowrap;
  color: var(--rr-bg);
  background: var(--rr-ok);
}
.smap-outline.bad .smap-outline-tag {
  background: var(--rr-warn);
}
/* A viewport over the corner of a small monitor shows that monitor's name above its own text,
   so the two never lie on top of each other. */
.smap-box.naming {
  justify-content: flex-start;
}
.smap-box.naming .smap-box-text {
  flex: 1 1 0;
  min-height: 0;
}
.smap-box.short .smap-box-name {
  display: none;
}
.smap-box-monitor {
  align-self: stretch;
  flex: none;
  display: flex;
  flex-direction: column;
  padding: 4px 6px 0;
  text-align: left;
}
.smap-box-monitor .smap-display-size {
  color: color-mix(in srgb, var(--rr-text) 75%, transparent);
}
.smap-box-monitor-name {
  line-height: 13px;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
}
.smap-box-label {
  font-weight: 600;
  white-space: nowrap;
}
.smap-box-name {
  font-family: 'Cascadia Mono', Consolas, monospace;
  font-size: 10.5px;
  color: color-mix(in srgb, var(--rr-text) 75%, transparent);
}
.smap-handle {
  position: absolute;
  width: 11px;
  height: 11px;
  background: var(--rr-text);
  border: 2px solid #9b7bea;
  border-radius: 2px;
}
.smap-n,
.smap-s {
  left: calc(50% - 5px);
  cursor: ns-resize;
}
.smap-e,
.smap-w {
  top: calc(50% - 5px);
  cursor: ew-resize;
}
.smap-n,
.smap-ne,
.smap-nw {
  top: -6px;
}
.smap-s,
.smap-se,
.smap-sw {
  bottom: -6px;
}
.smap-e,
.smap-ne,
.smap-se {
  right: -6px;
}
.smap-w,
.smap-nw,
.smap-sw {
  left: -6px;
}
.smap-ne,
.smap-sw {
  cursor: nesw-resize;
}
.smap-nw,
.smap-se {
  cursor: nwse-resize;
}
</style>
