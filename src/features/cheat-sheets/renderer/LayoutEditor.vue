<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { errorText } from '../../../renderer/ipc';
import SaveBar from '../../../renderer/components/SaveBar.vue';
import {
  controlName,
  HAT_ARROWS,
  HAT_DIRECTIONS,
  placedControls,
  type DeviceLayout,
  type LayoutControl,
} from '../core/layout';
import {
  DRAWING_FORMAT,
  DRAWING_VERSION,
  drawingFor,
  type DeviceDrawing,
  type DrawingChanges,
  type PhysicalControl,
  type Side,
} from '../core/drawings';
import { pictureFor, renderPictureSvg } from '../core/picture';
import { renderDeviceSvg } from '../core/render';
import type { SheetDevice } from '../core/sheet';
import { useCheatSheets } from './store';

/**
 * The layout editor. A device RigReady has a drawing of opens on the drawing: the labels
 * place themselves, and the user drags the dot of a control to where it really is, picks
 * the side its label goes on, renames it, or puts a photo of the device in place of the
 * drawing. Any other device (or one whose owner chose to) is a layout of cards: drag label
 * cards, their pointers and group frames into place, over a photo if the user has one; or
 * make a drawing of it from a photo. Pressing a control on the real device selects it.
 * Nothing is stored until Save.
 */
const props = defineProps<{ device: SheetDevice; pressed: string[] }>();
const emit = defineEmits<{ close: [saved: boolean] }>();
const store = useCheatSheets();

const layout = ref<DeviceLayout>(JSON.parse(JSON.stringify(props.device.layout)) as DeviceLayout);
const dirty = ref(false);
const busy = ref(false);
const error = ref('');
const message = ref('');
type Selection = { type: 'control' | 'group'; index: number };
const selected = ref<Selection>();
const host = ref<HTMLElement>();

// ---- drawing or cards ----
/** The device as it will be drawn once saved: the layout being edited is the user's own. */
const edited = computed(() => ({
  ...props.device,
  layout: layout.value,
  layoutSource: 'user' as const,
}));
const picture = computed(() => pictureFor(edited.value));
const drawing = computed<DeviceDrawing | undefined>(() =>
  picture.value.kind === 'drawing' ? picture.value.drawing : undefined
);
const custom = computed(
  () => picture.value.kind === 'drawing' && picture.value.source === 'custom'
);
/** RigReady's own drawing of this device, if it has one. */
const shipped = computed(() => drawingFor(props.device));
const emptyChanges = (): DrawingChanges => ({ anchors: {}, sides: {}, names: {} });
// A device RigReady has drawn opens on its drawing, unless its owner arranged cards before.
if (!layout.value.drawing && shipped.value && props.device.layoutSource !== 'user') {
  layout.value.drawing = emptyChanges();
}
const changes = (): DrawingChanges => (layout.value.drawing ??= emptyChanges());
/** The physical control selected on the drawing. */
const picked = ref<string>();

const svg = computed(() =>
  drawing.value
    ? renderPictureSvg(edited.value, { theme: 'dark', showEmpty: true, edit: true })
    : renderDeviceSvg(
        { layout: layout.value, controls: props.device.controls },
        { theme: 'dark', edit: true }
      )
);

const idsOf = (control: LayoutControl): string[] =>
  control.kind === 'cross' ? Object.values(control.inputs) : [control.input];

function paint(): void {
  const root = host.value;
  if (!root) return;
  const held = new Set(props.pressed);
  for (const el of root.querySelectorAll<SVGGElement>('.cs-ctl')) {
    el.classList.toggle('cs-on', held.has(el.dataset['control'] ?? ''));
  }
  for (const el of root.querySelectorAll<SVGGElement>('[data-item]')) {
    const on =
      selected.value?.type === 'control' && Number(el.dataset['item']) === selected.value.index;
    for (const card of el.querySelectorAll('.cs-ctl')) card.classList.toggle('cs-sel', on);
  }
  for (const el of root.querySelectorAll<SVGGElement>('[data-group]')) {
    const on =
      selected.value?.type === 'group' && Number(el.dataset['group']) === selected.value.index;
    el.querySelector('.cs-group')?.classList.toggle('cs-sel', on);
  }
  for (const el of root.querySelectorAll<SVGGElement>('.cs-callout')) {
    el.classList.toggle('cs-picked', el.dataset['anchor'] === picked.value);
  }
}
watch(svg, () => void nextTick(paint));
watch([selected, picked], paint);
// Press a control on the device: its card is selected.
watch(
  () => props.pressed,
  (now, before) => {
    const fresh = now.find((id) => !(before ?? []).includes(id));
    if (fresh && drawing.value) {
      const found = drawing.value.controls.find((c) => c.inputs.some((i) => i.id === fresh));
      if (found) picked.value = found.id;
      else
        message.value = `${controlName(fresh)} is not on the drawing. Its label is in the list under it.`;
    } else if (fresh) {
      const index = layout.value.controls.findIndex((c) => idsOf(c).includes(fresh));
      if (index >= 0) selected.value = { type: 'control', index };
      else
        message.value = `${controlName(fresh)} is not on the layout yet. Add it from the list below.`;
    }
    paint();
  }
);

// ---- dragging ----
type Drag =
  | { mode: 'anchor'; id: string; x0: number; y0: number; scale: number }
  | { mode: 'move'; index: number; dx: number; dy: number }
  | { mode: 'resize'; index: number }
  | { mode: 'pin'; index: number }
  | {
      mode: 'group';
      index: number;
      dx: number;
      dy: number;
      members: number[];
      last: { x: number; y: number };
    };
let drag: Drag | undefined;
const SNAP = 2;
const snap = (v: number): number => Math.round(v / SNAP) * SNAP;

function point(event: PointerEvent): { x: number; y: number } {
  const element = host.value?.querySelector('svg') as SVGSVGElement | null;
  const matrix = element?.getScreenCTM();
  if (!element || !matrix) return { x: 0, y: 0 };
  const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  return { x: p.x, y: p.y };
}

/** Picks a control on the drawing; its dot starts a drag. */
function downOnDrawing(event: PointerEvent, target: Element): void {
  const handle = target.closest<SVGElement>('[data-anchor-handle]');
  const block = target.closest<SVGElement>('[data-anchor]');
  const id = handle?.dataset['anchorHandle'] ?? block?.dataset['anchor'];
  picked.value = id;
  if (!id || !handle) return;
  const placed = host.value?.querySelector<SVGGElement>('.cs-drawing');
  drag = {
    mode: 'anchor',
    id,
    x0: Number(placed?.dataset['x'] ?? 0),
    y0: Number(placed?.dataset['y'] ?? 0),
    scale: Number(placed?.dataset['scale'] ?? 1) || 1,
  };
  host.value?.setPointerCapture(event.pointerId);
  event.preventDefault();
}

/** Puts the dot of a control at a point of the drawing, kept on it. */
function moveAnchor(id: string, x: number, y: number): void {
  const size = drawing.value?.size;
  if (!size) return;
  changes().anchors[id] = {
    x: Math.round(Math.max(0, Math.min(size.width, x))),
    y: Math.round(Math.max(0, Math.min(size.height, y))),
  };
  dirty.value = true;
}

function down(event: PointerEvent): void {
  const target = event.target as Element;
  if (drawing.value) {
    downOnDrawing(event, target);
    return;
  }
  const at = point(event);
  const resize = target.closest<SVGElement>('[data-resize]');
  const pin = target.closest<SVGElement>('[data-pin]');
  const item = target.closest<SVGElement>('[data-item]');
  const group = target.closest<SVGElement>('[data-group]');
  if (resize) {
    const index = Number(resize.dataset['resize']);
    selected.value = { type: 'control', index };
    drag = { mode: 'resize', index };
  } else if (pin) {
    const index = Number(pin.dataset['pin']);
    selected.value = { type: 'control', index };
    drag = { mode: 'pin', index };
  } else if (item) {
    const index = Number(item.dataset['item']);
    const control = layout.value.controls[index]!;
    selected.value = { type: 'control', index };
    drag = { mode: 'move', index, dx: at.x - control.x, dy: at.y - control.y };
  } else if (group) {
    const index = Number(group.dataset['group']);
    const frame = layout.value.groups[index]!;
    selected.value = { type: 'group', index };
    // What sits inside the frame moves with it.
    const members = layout.value.controls
      .map((c, i) => ({ i, cx: c.x + c.w / 2, cy: c.y + c.h / 2 }))
      .filter(
        (c) =>
          c.cx >= frame.x &&
          c.cx <= frame.x + frame.w &&
          c.cy >= frame.y &&
          c.cy <= frame.y + frame.h
      )
      .map((c) => c.i);
    drag = {
      mode: 'group',
      index,
      dx: at.x - frame.x,
      dy: at.y - frame.y,
      members,
      last: { x: frame.x, y: frame.y },
    };
  } else {
    selected.value = undefined;
    return;
  }
  host.value?.setPointerCapture(event.pointerId);
  event.preventDefault();
}

function move(event: PointerEvent): void {
  if (!drag) return;
  const at = point(event);
  if (drag.mode === 'anchor') {
    moveAnchor(drag.id, (at.x - drag.x0) / drag.scale, (at.y - drag.y0) / drag.scale);
    return;
  }
  const { width, height } = layout.value.canvas;
  if (drag.mode === 'group') {
    const frame = layout.value.groups[drag.index]!;
    const x = snap(Math.max(0, Math.min(width - frame.w, at.x - drag.dx)));
    const y = snap(Math.max(0, Math.min(height - frame.h, at.y - drag.dy)));
    const [mx, my] = [x - drag.last.x, y - drag.last.y];
    if (mx === 0 && my === 0) return;
    frame.x = x;
    frame.y = y;
    for (const i of drag.members) {
      const control = layout.value.controls[i]!;
      control.x += mx;
      control.y += my;
      if (control.pin) control.pin = { x: control.pin.x + mx, y: control.pin.y + my };
    }
    drag.last = { x, y };
  } else {
    const control = layout.value.controls[drag.index]!;
    if (drag.mode === 'move') {
      control.x = snap(Math.max(0, Math.min(width - control.w, at.x - drag.dx)));
      control.y = snap(Math.max(0, Math.min(height - control.h, at.y - drag.dy)));
    } else if (drag.mode === 'resize') {
      control.w = snap(
        Math.max(control.kind === 'cross' ? 180 : 44, Math.min(width - control.x, at.x - control.x))
      );
      control.h = snap(
        Math.max(
          control.kind === 'cross' ? 120 : 28,
          Math.min(height - control.y, at.y - control.y)
        )
      );
    } else {
      control.pin = {
        x: snap(Math.max(0, Math.min(width, at.x))),
        y: snap(Math.max(0, Math.min(height, at.y))),
      };
    }
  }
  dirty.value = true;
}

function up(event: PointerEvent): void {
  if (!drag) return;
  drag = undefined;
  host.value?.releasePointerCapture(event.pointerId);
}

function key(event: KeyboardEvent): void {
  if ((event.target as HTMLElement).closest('input, textarea')) return;
  const step = event.shiftKey ? 10 : 1;
  const delta: Record<string, [number, number]> = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, -step],
    ArrowDown: [0, step],
  };
  const by = delta[event.key];
  if (drawing.value) {
    const control = pickedControl.value;
    if (control && by) {
      moveAnchor(control.id, control.at.x + by[0], control.at.y + by[1]);
      event.preventDefault();
    }
    return;
  }
  const target = selected.value;
  if (!target) return;
  if (by) {
    const box =
      target.type === 'control'
        ? layout.value.controls[target.index]!
        : layout.value.groups[target.index]!;
    box.x += by[0];
    box.y += by[1];
    dirty.value = true;
    event.preventDefault();
  } else if (event.key === 'Delete') {
    removeSelected();
  }
}

// ---- the selected item ----
const current = computed(() => {
  const target = selected.value;
  if (!target) return undefined;
  return target.type === 'control'
    ? layout.value.controls[target.index]
    : layout.value.groups[target.index];
});
const currentControl = computed(() =>
  selected.value?.type === 'control' ? layout.value.controls[selected.value.index] : undefined
);
const currentName = computed(() => {
  const control = currentControl.value;
  if (!control) return selected.value ? 'Group frame' : '';
  if (control.kind === 'cross') return `Switch: ${idsOf(control).map(controlName).join(', ')}`;
  return controlName(control.input);
});

function setLabel(value: string): void {
  const item = current.value;
  if (!item) return;
  if (selected.value?.type === 'group') (item as { label: string }).label = value;
  else if (value.trim()) (item as LayoutControl).label = value;
  else delete (item as LayoutControl).label;
  dirty.value = true;
}

function togglePin(): void {
  const control = currentControl.value;
  if (!control) return;
  if (control.pin) delete control.pin;
  else control.pin = { x: Math.max(0, control.x - 30), y: control.y + control.h / 2 };
  dirty.value = true;
}

function removeSelected(): void {
  const target = selected.value;
  if (!target) return;
  if (target.type === 'control') layout.value.controls.splice(target.index, 1);
  else layout.value.groups.splice(target.index, 1);
  selected.value = undefined;
  dirty.value = true;
}

function addGroup(): void {
  layout.value.groups.push({ label: 'New group', x: 20, y: 20, w: 320, h: 140 });
  selected.value = { type: 'group', index: layout.value.groups.length - 1 };
  dirty.value = true;
}

// ---- the control picked on the drawing ----
const pickedControl = computed<PhysicalControl | undefined>(() =>
  drawing.value?.controls.find((c) => c.id === picked.value)
);
const pickedInputs = computed(() =>
  (pickedControl.value?.inputs ?? []).map((input) => controlName(input.id)).join(', ')
);
const pickedChanged = computed(() => {
  const id = picked.value;
  const now = layout.value.drawing;
  return Boolean(id && now && (now.anchors[id] || now.sides[id] || now.names[id]));
});

function rename(value: string): void {
  const id = picked.value;
  if (!id) return;
  const names = changes().names;
  if (value.trim()) names[id] = value.trim().slice(0, 60);
  else delete names[id];
  dirty.value = true;
}

function setSide(side: Side): void {
  const id = picked.value;
  if (!id) return;
  changes().sides[id] = side;
  dirty.value = true;
}

/** Back to where the drawing has it, its own side and its own name. */
function putBack(): void {
  const id = picked.value;
  if (!id) return;
  const now = changes();
  delete now.anchors[id];
  delete now.sides[id];
  delete now.names[id];
  dirty.value = true;
}

/** The cards of the layout instead of the drawing (the layout of 1.x, its places kept). */
function useCards(): void {
  delete layout.value.drawing;
  delete layout.value.background;
  picked.value = undefined;
  dirty.value = true;
  message.value = 'The cards are shown instead of the drawing. Drag them into place, then Save.';
}

function useDrawing(): void {
  layout.value.drawing = emptyChanges();
  delete layout.value.background;
  selected.value = undefined;
  dirty.value = true;
  message.value =
    'The drawing is shown. Its labels place themselves; drag a dot to move a control.';
}

/** Probes a picture for its size, for a drawing made from it. */
function imageSize(image: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const probe = new Image();
    probe.onload = () => resolve({ w: probe.naturalWidth || 4, h: probe.naturalHeight || 3 });
    probe.onerror = () => resolve({ w: 4, h: 3 });
    probe.src = image;
  });
}

/** A physical control for one input (or one hat) of the device, for a drawing of the user's. */
function controlFor(id: string): PhysicalControl {
  const hat = /^hat:(\d)$/.exec(id);
  const base = { at: { x: 0, y: 0 }, hidden: false, assumed: false } as const;
  if (hat) {
    return {
      ...base,
      id: `hat-${hat[1]}`,
      name: `Hat ${hat[1]}`,
      glyph: 'hat',
      inputs: HAT_DIRECTIONS.map((d) => ({ id: `hat:${hat[1]}:${d}`, tag: HAT_ARROWS[d] })),
    };
  }
  return {
    ...base,
    id: id.replace(':', '-'),
    name: controlName(id),
    glyph: id.startsWith('axis:') ? 'axis' : 'button',
    inputs: [{ id }],
  };
}

/**
 * A drawing of the user's own from a photo of the device: the photo, with a dot for every
 * axis and hat it reports and every button that does something, set out in a grid on the
 * photo for the user to drag onto the real controls.
 */
async function drawOnPhoto(): Promise<void> {
  error.value = '';
  const result = await store.api.pickBackground();
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  const image = result.value.image;
  if (!image) return;
  const size = await imageSize(image);
  const width = 500;
  const height = Math.round(Math.max(200, Math.min(1400, (width * size.h) / size.w)));
  const reports = props.device.reports;
  const ids = [
    ...(reports?.axes ?? []).map((a) => `axis:${a}`),
    ...Array.from({ length: reports?.hats ?? 0 }, (_, i) => `hat:${i + 1}`),
  ];
  for (const control of props.device.controls) {
    if (control.bindings.length === 0 && !control.note) continue;
    const hat = /^hat:(\d):/.exec(control.id);
    const id = hat ? `hat:${hat[1]}` : control.id;
    if (!ids.includes(id)) ids.push(id);
  }
  if (ids.length === 0) {
    error.value =
      'This device reports no controls and has nothing bound, so there is nothing to place.';
    return;
  }
  const columns = Math.ceil(Math.sqrt(ids.length));
  const rows = Math.ceil(ids.length / columns);
  const controls = ids.slice(0, 200).map((id, i) => {
    const control = controlFor(id);
    const column = i % columns;
    const row = Math.floor(i / columns);
    control.at = {
      x: Math.round(width * (0.15 + (0.7 * (column + 0.5)) / columns)),
      y: Math.round(height * (0.15 + (0.7 * (row + 0.5)) / rows)),
    };
    return control;
  });
  const own: DeviceDrawing = {
    format: DRAWING_FORMAT,
    version: DRAWING_VERSION,
    name: `${props.device.title} (my drawing)`.slice(0, 120),
    match: { vendorId: props.device.vendorId!, productIds: [props.device.productId!], names: [] },
    view: 'A photo of the device',
    size: { width, height },
    paths: [],
    texts: [],
    image,
    controls,
    columnWidth: 300,
  };
  layout.value.drawing = { ...emptyChanges(), custom: own };
  delete layout.value.background;
  selected.value = undefined;
  dirty.value = true;
  message.value = `A dot for each of ${controls.length} controls is on the photo. Drag each onto its control, then Save.`;
}

/** Inputs the device reports that a drawing of the user's does not place yet. */
const missing = computed(() => {
  const own = layout.value.drawing?.custom;
  if (!custom.value || !own) return [];
  const placed = new Set(own.controls.flatMap((c) => c.inputs.map((i) => i.id)));
  const reports = props.device.reports;
  const ids = [
    ...(reports?.axes ?? []).map((a) => `axis:${a}`),
    ...Array.from({ length: reports?.hats ?? 0 }, (_, i) => `hat:${i + 1}`),
    ...Array.from({ length: Math.min(reports?.buttons ?? 0, 128) }, (_, i) => `button:${i + 1}`),
  ];
  const bound = new Set(
    props.device.controls.filter((c) => c.bindings.length > 0).map((c) => c.id)
  );
  return ids
    .filter((id) => (id.startsWith('hat:') ? !placed.has(`${id}:U`) : !placed.has(id)))
    .map((id) => ({
      key: id,
      label: id.startsWith('button:')
        ? `${id.slice(7)}${bound.has(id) ? ' •' : ''}`
        : controlName(id.startsWith('hat:') ? `${id}:U` : id).replace(/ up$/, ''),
    }));
});

function addToDrawing(id: string): void {
  const own = layout.value.drawing?.custom;
  if (!own || own.controls.length >= 200) return;
  const control = controlFor(id);
  control.at = { x: Math.round(own.size.width / 2), y: Math.round(own.size.height / 2) };
  own.controls.push(control);
  picked.value = control.id;
  dirty.value = true;
}

// ---- controls the device has that are not on the layout ----
const unplaced = computed(() => {
  const placed = placedControls(layout.value);
  const chips: { key: string; label: string; add: () => LayoutControl }[] = [];
  const reports = props.device.reports;
  const spot = (): { x: number; y: number } => ({ x: 24, y: 24 });
  for (const name of reports?.axes ?? []) {
    const id = `axis:${name}`;
    if (!placed.has(id)) {
      chips.push({
        key: id,
        label: controlName(id),
        add: () => ({ kind: 'axis', input: id, ...spot(), w: 230, h: 60 }),
      });
    }
  }
  for (let hat = 1; hat <= (reports?.hats ?? 0); hat++) {
    const ids = HAT_DIRECTIONS.map((d) => `hat:${hat}:${d}`);
    if (ids.every((id) => !placed.has(id))) {
      chips.push({
        key: `hat:${hat}`,
        label: `Hat ${hat}`,
        add: () => ({
          kind: 'cross',
          label: `Hat ${hat}`,
          inputs: Object.fromEntries(HAT_DIRECTIONS.map((d) => [d, `hat:${hat}:${d}`])),
          ...spot(),
          w: 312,
          h: 204,
        }),
      });
    }
  }
  const bound = new Set(
    props.device.controls.filter((c) => c.bindings.length > 0).map((c) => c.id)
  );
  const count = Math.max(reports?.buttons ?? 0, 0);
  for (let n = 1; n <= count; n++) {
    const id = `button:${n}`;
    if (!placed.has(id)) {
      chips.push({
        key: id,
        label: bound.has(id) ? `${n} •` : String(n),
        add: () => ({ kind: 'button', input: id, ...spot(), w: 120, h: 54 }),
      });
    }
  }
  return chips;
});

function addControl(chip: { add: () => LayoutControl }): void {
  layout.value.controls.push(chip.add());
  selected.value = { type: 'control', index: layout.value.controls.length - 1 };
  dirty.value = true;
}

// ---- background picture ----
async function chooseBackground(): Promise<void> {
  error.value = '';
  const result = await store.api.pickBackground();
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  const image = result.value.image;
  if (!image) return;
  const own = layout.value.drawing?.custom;
  if (drawing.value && custom.value && own) {
    own.image = image;
    dirty.value = true;
    message.value = 'The photo of your drawing is changed.';
    return;
  }
  if (drawing.value) {
    // In place of the silhouette, stretched over the drawing; the dots stay where they are.
    const { width, height } = drawing.value.size;
    layout.value.background = { image, x: 0, y: 0, w: width, h: height, opacity: 0.85 };
    dirty.value = true;
    message.value = 'Picture added in place of the drawing. Drag each dot onto its control.';
    return;
  }
  const size = await imageSize(image);
  const w = layout.value.canvas.width;
  const h = Math.round((w * size.h) / size.w);
  layout.value.background = { image, x: 0, y: 0, w, h, opacity: 0.55 };
  if (h > layout.value.canvas.height) layout.value.canvas.height = h;
  dirty.value = true;
  message.value = 'Picture added behind the controls. Drag the cards onto it.';
}

function removeBackground(): void {
  delete layout.value.background;
  dirty.value = true;
}

// ---- files ----
async function importLayout(): Promise<void> {
  error.value = '';
  message.value = '';
  const result = await store.api.importLayout({
    vendorId: props.device.vendorId!,
    productId: props.device.productId!,
    name: props.device.title,
  });
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  if (!result.value.layout) return;
  layout.value = result.value.layout;
  selected.value = undefined;
  dirty.value = true;
  message.value =
    result.value.from === 'rigready-drawing'
      ? `Imported the drawing ${result.value.file}. Check where its dots are, then Save.`
      : result.value.from === 'joystick-diagrams'
        ? `Converted ${result.value.file}: ${result.value.layout.controls.length} controls placed${
            result.value.skipped.length
              ? `, ${result.value.skipped.length} placeholders not understood`
              : ''
          }. Check it, then Save.`
        : `Imported ${result.value.file}. Check it, then Save.`;
}

async function exportLayout(): Promise<void> {
  error.value = '';
  const result = await store.api.exportLayout({ layout: layout.value });
  if (!result.ok) error.value = errorText(result.error);
  else if (result.value.path) message.value = `Saved to ${result.value.path}`;
}

async function save(): Promise<void> {
  busy.value = true;
  error.value = '';
  const result = await store.api.saveLayout({
    vendorId: props.device.vendorId!,
    productId: props.device.productId!,
    layout: layout.value,
  });
  busy.value = false;
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  emit('close', true);
}

async function reset(): Promise<void> {
  busy.value = true;
  const result = await store.api.resetLayout({
    vendorId: props.device.vendorId!,
    productId: props.device.productId!,
  });
  busy.value = false;
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  emit('close', true);
}

onMounted(() => {
  paint();
  window.addEventListener('keydown', key);
});
onBeforeUnmount(() => window.removeEventListener('keydown', key));
</script>

<template>
  <div class="ed" data-testid="layout-editor" :data-dirty="dirty">
    <div class="ed-bar">
      <div class="rr-row-main">
        <div class="ed-title" data-testid="editor-mode" :data-mode="drawing ? 'drawing' : 'cards'">
          {{ drawing ? 'Drawing' : 'Layout' }} of {{ device.title }}
        </div>
        <div v-if="drawing" class="rr-row-sub">
          Drag a dot to where the control is; its label follows. Press a control on the device to
          find it. Saved for this device model.
        </div>
        <div v-else class="rr-row-sub">
          Drag cards, pointers and frames. Press a control on the device to find its card. Saved for
          this device model.
        </div>
      </div>
      <v-btn size="small" variant="text" data-testid="editor-import" @click="importLayout"
        >Import…</v-btn
      >
      <v-btn size="small" variant="text" data-testid="editor-export" @click="exportLayout"
        >Share as file…</v-btn
      >
      <v-btn
        v-if="device.layoutSource === 'user'"
        size="small"
        variant="text"
        color="warning"
        :disabled="busy"
        data-testid="editor-reset"
        @click="reset"
        >Discard my layout</v-btn
      >
    </div>
    <!--
      Save layout and Cancel are in the shared bar at the bottom of the window, whatever the
      size of the drawing. The bar is moved to the end of the page: it stays in view only as
      the last thing in it. Cancel, and leaving the page, ask first when something was changed.
    -->
    <Teleport defer to=".cs-page">
      <SaveBar
        :dirty="dirty"
        :saving="busy"
        :disabled="!dirty"
        :error="error || undefined"
        save-label="Save layout"
        back-label="Cancel"
        save-testid="editor-save"
        back-testid="editor-cancel"
        @save="save"
        @back="emit('close', false)"
      />
    </Teleport>
    <v-alert
      v-if="error"
      type="warning"
      variant="tonal"
      density="compact"
      class="mb-2"
      data-testid="editor-error"
    >
      {{ error }}
    </v-alert>
    <div v-if="message" class="ed-message" data-testid="editor-message">{{ message }}</div>

    <div class="ed-row">
      <!-- The SVG is built by core/render from escaped text. -->
      <!-- eslint-disable vue/no-v-html -->
      <div
        ref="host"
        class="ed-canvas"
        data-testid="editor-canvas"
        @pointerdown="down"
        @pointermove="move"
        @pointerup="up"
        @pointercancel="up"
        v-html="svg"
      ></div>

      <aside v-if="drawing" class="ed-side rr-panel" data-testid="editor-drawing-side">
        <div class="rr-section-title">Selected</div>
        <template v-if="pickedControl">
          <v-text-field
            :model-value="pickedControl.name"
            label="Name"
            density="compact"
            variant="outlined"
            hide-details
            maxlength="60"
            class="mt-1"
            data-testid="editor-control-name"
            @update:model-value="rename(String($event ?? ''))"
          />
          <div class="rr-row-sub mt-1" data-testid="editor-control-inputs">
            {{ pickedInputs || 'No inputs: drawn, never labelled.' }}
          </div>
          <div class="rr-row-sub mt-2">Label goes</div>
          <v-btn-toggle
            :model-value="pickedControl.side ?? ''"
            density="compact"
            variant="outlined"
            divided
            mandatory
            data-testid="editor-control-side"
            @update:model-value="setSide($event as Side)"
          >
            <v-btn size="small" value="left" data-testid="editor-side-left">Left</v-btn>
            <v-btn size="small" value="right" data-testid="editor-side-right">Right</v-btn>
            <v-btn size="small" value="top">Above</v-btn>
            <v-btn size="small" value="bottom">Below</v-btn>
          </v-btn-toggle>
          <div class="ed-actions">
            <v-btn
              size="small"
              variant="text"
              :disabled="!pickedChanged"
              data-testid="editor-put-back"
              @click="putBack"
              >Put it back</v-btn
            >
          </div>
        </template>
        <div v-else class="rr-muted ed-hint">
          Nothing selected. Click a label or a dot, or press a control on the device. Arrow keys
          move the selected dot.
        </div>

        <div class="rr-section-title mt-4">Picture behind</div>
        <div class="ed-actions">
          <v-btn
            size="small"
            variant="tonal"
            prepend-icon="mdi-image-outline"
            data-testid="editor-background"
            @click="chooseBackground"
            >{{
              layout.background || custom ? 'Change picture…' : 'Use a photo of the device…'
            }}</v-btn
          >
          <v-btn
            v-if="layout.background"
            size="small"
            variant="text"
            data-testid="editor-background-remove"
            @click="removeBackground"
            >Remove</v-btn
          >
        </div>
        <v-slider
          v-if="layout.background"
          v-model="layout.background.opacity"
          :min="0.1"
          :max="1"
          :step="0.05"
          label="Strength"
          density="compact"
          hide-details
          @update:model-value="dirty = true"
        />

        <template v-if="custom">
          <div class="rr-section-title mt-4">Not on the drawing ({{ missing.length }})</div>
          <div v-if="missing.length === 0" class="rr-muted ed-hint">Every control is placed.</div>
          <div v-else class="ed-tray" data-testid="editor-missing">
            <button
              v-for="chip in missing"
              :key="chip.key"
              type="button"
              class="ed-chip"
              data-testid="editor-missing-chip"
              :data-control="chip.key"
              @click="addToDrawing(chip.key)"
            >
              {{ chip.label }}
            </button>
          </div>
        </template>

        <div class="rr-section-title mt-4">Instead</div>
        <v-btn
          size="small"
          variant="text"
          prepend-icon="mdi-card-outline"
          data-testid="editor-use-cards"
          @click="useCards"
          >Arrange cards myself</v-btn
        >
        <div v-if="custom" class="rr-row-sub">Your drawing and its photo are dropped.</div>
      </aside>

      <aside v-else class="ed-side rr-panel">
        <div class="rr-section-title">Selected</div>
        <template v-if="current">
          <div class="ed-name" data-testid="editor-selected">{{ currentName }}</div>
          <v-text-field
            :model-value="current.label ?? ''"
            :label="selected?.type === 'group' ? 'Group name' : 'Printed on the device'"
            density="compact"
            variant="outlined"
            hide-details
            maxlength="80"
            class="mt-2"
            data-testid="editor-label"
            @update:model-value="setLabel(String($event ?? ''))"
          />
          <div class="ed-size">
            <v-text-field
              v-model.number="current.w"
              label="Width"
              type="number"
              density="compact"
              variant="outlined"
              hide-details
              data-testid="editor-width"
              @update:model-value="dirty = true"
            />
            <v-text-field
              v-model.number="current.h"
              label="Height"
              type="number"
              density="compact"
              variant="outlined"
              hide-details
              @update:model-value="dirty = true"
            />
          </div>
          <div class="ed-actions">
            <v-btn
              v-if="currentControl"
              size="small"
              variant="tonal"
              data-testid="editor-pin"
              @click="togglePin"
              >{{ currentControl.pin ? 'Remove pointer' : 'Add pointer' }}</v-btn
            >
            <v-btn
              size="small"
              variant="text"
              color="warning"
              data-testid="editor-remove"
              @click="removeSelected"
              >Take off the layout</v-btn
            >
          </div>
        </template>
        <div v-else class="rr-muted ed-hint">
          Nothing selected. Click a card or a frame, or press a control on the device.
        </div>

        <div class="rr-section-title mt-4">Groups</div>
        <v-btn
          size="small"
          variant="tonal"
          prepend-icon="mdi-shape-rectangle-plus"
          data-testid="editor-add-group"
          @click="addGroup"
          >Add a group frame</v-btn
        >

        <div class="rr-section-title mt-4">Picture behind</div>
        <div class="ed-actions">
          <v-btn
            size="small"
            variant="tonal"
            prepend-icon="mdi-image-outline"
            data-testid="editor-background"
            @click="chooseBackground"
            >{{ layout.background ? 'Change picture…' : 'Choose a photo or drawing…' }}</v-btn
          >
          <v-btn
            v-if="layout.background"
            size="small"
            variant="text"
            data-testid="editor-background-remove"
            @click="removeBackground"
            >Remove</v-btn
          >
        </div>
        <v-slider
          v-if="layout.background"
          v-model="layout.background.opacity"
          :min="0.1"
          :max="1"
          :step="0.05"
          label="Strength"
          density="compact"
          hide-details
          @update:model-value="dirty = true"
        />

        <div class="rr-section-title mt-4">Not on the layout ({{ unplaced.length }})</div>
        <div v-if="unplaced.length === 0" class="rr-muted ed-hint">Every control is placed.</div>
        <div v-else class="ed-tray" data-testid="editor-unplaced">
          <button
            v-for="chip in unplaced"
            :key="chip.key"
            type="button"
            class="ed-chip"
            data-testid="editor-unplaced-chip"
            :data-control="chip.key"
            @click="addControl(chip)"
          >
            {{ chip.label }}
          </button>
        </div>
        <div v-if="unplaced.length > 0" class="rr-row-sub mt-1">
          Click one to add it. • has a binding.
        </div>

        <div class="rr-section-title mt-4">Drawing</div>
        <v-btn
          v-if="shipped"
          size="small"
          variant="tonal"
          prepend-icon="mdi-draw"
          data-testid="editor-use-drawing"
          @click="useDrawing"
          >Use RigReady's drawing</v-btn
        >
        <template v-else>
          <v-btn
            size="small"
            variant="tonal"
            prepend-icon="mdi-image-edit-outline"
            data-testid="editor-photo-drawing"
            @click="drawOnPhoto"
            >Make a drawing from a photo…</v-btn
          >
          <div class="rr-row-sub mt-1">
            The labels then place themselves around the photo. You drag a dot onto each control.
          </div>
        </template>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.ed-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.ed-title {
  font-size: 18px;
  font-weight: 650;
}
.ed-message {
  font-size: 13px;
  color: var(--rr-accent);
  margin-bottom: 8px;
}
.ed-row {
  display: flex;
  gap: 14px;
  align-items: flex-start;
}
.ed-canvas {
  flex: 1;
  min-width: 0;
  line-height: 0;
  touch-action: none;
  user-select: none;
  border: 1px dashed var(--rr-border);
  border-radius: 10px;
}
.ed-canvas :deep(svg) {
  width: 100%;
  height: auto;
  border-radius: 10px;
}
.ed-side {
  width: 272px;
  flex-shrink: 0;
  padding: 12px 14px;
  position: sticky;
  top: 68px;
  max-height: calc(100vh - 84px);
  overflow-y: auto;
}
.ed-name {
  font-weight: 600;
  font-size: 14px;
}
.ed-size {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
.ed-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
.ed-hint {
  font-size: 12.5px;
}
.ed-tray {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  max-height: 150px;
  overflow-y: auto;
}
.ed-chip {
  font-size: 12px;
  min-width: 30px;
  padding: 2px 7px;
  border-radius: 6px;
  border: 1px solid var(--rr-border);
  background: var(--rr-surface-2);
  color: var(--rr-text);
  cursor: pointer;
}
.ed-chip:hover {
  border-color: var(--rr-accent);
}
</style>
