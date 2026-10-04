<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { renderDeviceSvg, type ThemeName } from '../core/render';
import type { SheetDevice } from '../core/sheet';

/**
 * The picture of one device with its labels. The picture is drawn once per sheet (the
 * same drawing the PDF and the kneeboard use); what changes while it is on screen, such
 * as a held control, the search and the selection, is only classes on its elements.
 */
const props = withDefaults(
  defineProps<{
    device: SheetDevice;
    theme?: ThemeName;
    showEmpty?: boolean;
    /** Controls held on the real device right now. */
    pressed?: string[];
    /** Axis positions, -1 .. 1, by control id. */
    axes?: Record<string, number>;
    selected?: string | undefined;
    /** When set, every control not in it is dimmed (search, legend filter). */
    keep?: Set<string> | undefined;
  }>(),
  {
    theme: 'dark',
    showEmpty: true,
    pressed: () => [],
    axes: () => ({}),
    selected: undefined,
    keep: undefined,
  }
);
const emit = defineEmits<{ control: [id: string] }>();

const host = ref<HTMLElement>();
const svg = computed(() =>
  renderDeviceSvg(props.device, { theme: props.theme, showEmpty: props.showEmpty })
);

function paint(): void {
  const root = host.value;
  if (!root) return;
  const held = new Set(props.pressed);
  for (const el of root.querySelectorAll<SVGGElement>('.cs-ctl')) {
    const id = el.dataset['control'] ?? '';
    el.classList.toggle('cs-on', held.has(id));
    el.classList.toggle('cs-sel', id === props.selected);
    el.classList.toggle('cs-dim', props.keep !== undefined && !props.keep.has(id));
    el.classList.toggle('cs-hit', props.keep !== undefined && props.keep.has(id));
  }
  for (const el of root.querySelectorAll<SVGRectElement>('.cs-axis-val')) {
    const value = props.axes[el.dataset['axis'] ?? ''];
    const card = el.closest('.cs-ctl');
    card?.classList.toggle('cs-live', value !== undefined);
    if (value === undefined) continue;
    const x0 = Number(el.dataset['x0']);
    const w = Number(el.dataset['w']);
    el.setAttribute('x', String(x0 + ((value + 1) / 2) * w - 2));
  }
}

function click(event: MouseEvent): void {
  const target = (event.target as Element | null)?.closest<SVGGElement>('.cs-ctl');
  const id = target?.dataset['control'];
  if (id) emit('control', id);
}

watch(svg, () => void nextTick(paint));
watch(() => [props.pressed, props.axes, props.selected, props.keep], paint, { deep: false });
onMounted(paint);
</script>

<template>
  <!-- The SVG is built by core/render from escaped text. -->
  <!-- eslint-disable vue/no-v-html -->
  <div
    ref="host"
    class="sheet-view"
    data-testid="sheet-view"
    :data-device="device.key"
    @click="click"
    v-html="svg"
  ></div>
</template>

<style scoped>
.sheet-view {
  width: 100%;
  line-height: 0;
}
.sheet-view :deep(svg) {
  width: 100%;
  height: auto;
  border-radius: 10px;
}
.sheet-view :deep(.cs-ctl) {
  cursor: pointer;
}
</style>
