<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { renderPictureSvg } from '../core/picture';
import type { SheetDevice } from '../core/sheet';

/**
 * The device of a trainer card, drawn like its cheat sheet but with nothing written on it:
 * what each control does is the thing being asked. After an answer, the control that was
 * pressed and every control that is right are lit, and those say what they do.
 */
const props = withDefaults(
  defineProps<{
    device: SheetDevice;
    /** Controls whose labels are written out. */
    reveal?: string[];
    /** After a right answer: every control of this device that does the action. */
    right?: string[];
    /** The control that was pressed and was not it. */
    wrong?: string | undefined;
    /** After a miss: every control of this device that does the action. */
    target?: string[];
    /** Controls held on the real device right now. */
    held?: string[];
  }>(),
  { reveal: () => [], right: () => [], wrong: undefined, target: () => [], held: () => [] }
);

const host = ref<HTMLElement>();
const svg = computed(() => {
  const shown = new Set(props.reveal);
  // Every control that does something stays on the picture (to be lit), its words left off.
  return renderPictureSvg(
    { ...props.device, controls: props.device.controls.filter((c) => shown.has(c.id)) },
    { theme: 'dark', showEmpty: true, listed: props.device.controls.map((c) => c.id) }
  );
});

function paint(): void {
  const root = host.value;
  if (!root) return;
  const held = new Set(props.held);
  for (const el of root.querySelectorAll<SVGGElement>('.cs-ctl')) {
    const id = el.dataset['control'] ?? '';
    el.classList.toggle('cs-on', held.has(id));
    el.classList.toggle('tr-right', props.right.includes(id));
    el.classList.toggle('tr-wrong', id === props.wrong);
    el.classList.toggle('tr-target', props.target.includes(id));
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
    :data-right="right.join(' ')"
    :data-wrong="wrong ?? ''"
    :data-target="target.join(' ')"
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
.trainer-picture :deep(.cs-ctl .cs-card),
.trainer-picture :deep(.cs-ctl .cs-row) {
  transition:
    stroke 0.15s ease-out,
    fill 0.15s ease-out;
}
/*
 * A switch that is on stays held for the whole round. On a cheat sheet a held control is lit in
 * the accent; here that made it look like the answer. It is drawn quietly instead, so that the
 * control asked for, the one pressed and the one missed are the only ones that stand out.
 * (These come before the three below: a held control that is one of those takes their look.)
 */
.trainer-picture :deep(.cs-ctl.cs-on .cs-card),
.trainer-picture :deep(.cs-ctl.cs-on .cs-row) {
  fill: color-mix(in srgb, var(--rr-text) 6%, transparent);
  stroke: color-mix(in srgb, var(--rr-text) 42%, transparent);
  stroke-width: 1.2;
  stroke-dasharray: none;
}
.trainer-picture :deep(.cs-ctl.tr-target .cs-card),
.trainer-picture :deep(.cs-ctl.tr-target .cs-row) {
  fill: color-mix(in srgb, var(--rr-accent) 34%, transparent);
  stroke: var(--rr-accent);
  stroke-width: 3.2;
  stroke-dasharray: none;
  filter: drop-shadow(0 0 5px color-mix(in srgb, var(--rr-accent) 85%, transparent));
}
.trainer-picture :deep(.cs-ctl.tr-right .cs-card),
.trainer-picture :deep(.cs-ctl.tr-right .cs-row) {
  fill: color-mix(in srgb, var(--rr-ok) 20%, transparent);
  stroke: var(--rr-ok);
  stroke-width: 2.6;
  stroke-dasharray: none;
}
.trainer-picture :deep(.cs-ctl.tr-wrong .cs-card),
.trainer-picture :deep(.cs-ctl.tr-wrong .cs-row) {
  fill: color-mix(in srgb, var(--rr-bad) 16%, transparent);
  stroke: var(--rr-bad);
  stroke-width: 2.6;
  stroke-dasharray: 5 3;
}
@media (prefers-reduced-motion: reduce) {
  .trainer-picture :deep(.cs-ctl .cs-card),
  .trainer-picture :deep(.cs-ctl .cs-row) {
    transition: none;
  }
}
</style>
