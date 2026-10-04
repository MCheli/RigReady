<script setup lang="ts">
import { computed, ref } from 'vue';
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

const props = defineProps<{
  displays: DesktopDisplay[];
  mainIds: string[];
  boxes: MapBox[];
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
  const rects: Rect[] = [...props.displays, ...props.boxes.map((b) => b.rect)];
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
      <span class="smap-display-name">{{ labels.get(d.id) }}</span>
      <span class="smap-display-size">{{ d.width }}×{{ d.height }}</span>
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
      }"
      :style="pct(shown(box))"
      data-testid="screen-map-box"
      :data-name="box.name"
      @pointerdown="start(box, 'move', $event)"
    >
      <span class="smap-box-label">{{ box.label }}</span>
      <span class="smap-box-name">{{ box.name }}</span>
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
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  padding: 5px 7px;
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
.smap-display-name {
  color: var(--rr-text);
  line-height: 1.25;
}
.smap-display-size {
  font-size: 10.5px;
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
