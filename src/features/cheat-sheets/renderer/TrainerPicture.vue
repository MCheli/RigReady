<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { renderDeviceSvg } from '../core/render';
import type { SheetDevice } from '../core/sheet';

/**
 * The device of a trainer card, drawn like its cheat sheet but with nothing written on it:
 * what each control does is the thing being asked. After an answer, the control that was
 * pressed and the one that was right are lit, and those two say what they do.
 */
const props = withDefaults(
  defineProps<{
    device: SheetDevice;
    /** Controls whose labels are written out. */
    reveal?: string[];
    /** The control that was the right answer and was pressed. */
    right?: string | undefined;
    /** The control that was pressed and was not it. */
    wrong?: string | undefined;
    /** The right answer, shown after a miss. */
    target?: string | undefined;
    /** Controls held on the real device right now. */
    held?: string[];
  }>(),
  { reveal: () => [], right: undefined, wrong: undefined, target: undefined, held: () => [] }
);

const host = ref<HTMLElement>();
const svg = computed(() => {
  const shown = new Set(props.reveal);
  return renderDeviceSvg(
    { layout: props.device.layout, controls: props.device.controls.filter((c) => shown.has(c.id)) },
    { theme: 'dark', showEmpty: true }
  );
});

function paint(): void {
  const root = host.value;
  if (!root) return;
  const held = new Set(props.held);
  for (const el of root.querySelectorAll<SVGGElement>('.cs-ctl')) {
    const id = el.dataset['control'] ?? '';
    el.classList.toggle('cs-on', held.has(id));
    el.classList.toggle('tr-right', id === props.right);
    el.classList.toggle('tr-wrong', id === props.wrong);
    el.classList.toggle('tr-target', id === props.target);
  }
}

watch(svg, () => void nextTick(paint));
watch(() => [props.held, props.right, props.wrong, props.target], paint);
onMounted(paint);
</script>

<template>
  <!-- The SVG is built by core/render from escaped text. -->
  <!-- eslint-disable vue/no-v-html -->
  <div
    ref="host"
    class="trainer-picture"
    aria-hidden="true"
    data-testid="trainer-picture"
    :data-device="device.key"
    :data-right="right ?? ''"
    :data-wrong="wrong ?? ''"
    :data-target="target ?? ''"
    v-html="svg"
  ></div>
</template>

<style scoped>
.trainer-picture {
  width: 100%;
  line-height: 0;
}
.trainer-picture :deep(svg) {
  width: 100%;
  height: auto;
  max-height: max(320px, calc(100vh - 340px));
  border-radius: 10px;
}
/* The words beside the picture say which is which; these outlines show where. */
.trainer-picture :deep(.cs-ctl .cs-card) {
  transition:
    stroke 0.15s ease-out,
    fill 0.15s ease-out;
}
.trainer-picture :deep(.cs-ctl.tr-target .cs-card) {
  fill: color-mix(in srgb, var(--rr-accent) 22%, transparent);
  stroke: var(--rr-accent);
  stroke-width: 2.6;
  stroke-dasharray: none;
}
.trainer-picture :deep(.cs-ctl.tr-right .cs-card) {
  fill: color-mix(in srgb, var(--rr-ok) 20%, transparent);
  stroke: var(--rr-ok);
  stroke-width: 2.6;
  stroke-dasharray: none;
}
.trainer-picture :deep(.cs-ctl.tr-wrong .cs-card) {
  fill: color-mix(in srgb, var(--rr-bad) 16%, transparent);
  stroke: var(--rr-bad);
  stroke-width: 2.6;
  stroke-dasharray: 5 3;
}
@media (prefers-reduced-motion: reduce) {
  .trainer-picture :deep(.cs-ctl .cs-card) {
    transition: none;
  }
}
</style>
