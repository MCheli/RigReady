<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { InputDevice } from '../../../shared/models';
import { stripLayout } from '../core/trace';
import { alpha, schedule, surfaceOf, themePalette, usePainter } from './canvas';
import { useInputStore } from './store';

/**
 * One controller at a glance, for the list of all of them: every axis as a level bar and
 * every button as a small square. A square is filled while its button is down and keeps an
 * outline once it has been pressed. Drawn on a canvas, so sixteen controllers at 60 updates
 * a second cost almost nothing; the row says the same in words beside it.
 */
const props = defineProps<{ device: InputDevice }>();
const input = useInputStore();
const canvas = ref<HTMLCanvasElement>();

// The counts change almost never, so the layout is worked out once and not on every frame.
const axes = computed(() => {
  void input.versions[props.device.index];
  return Math.max(props.device.numAxes, input.states.get(props.device.index)?.axes.length ?? 0);
});
const buttons = computed(() => {
  void input.versions[props.device.index];
  return Math.max(
    props.device.numButtons,
    input.states.get(props.device.index)?.buttons.length ?? 0
  );
});
const layout = computed(() => stripLayout(axes.value, buttons.value));

let drawn = '';

usePainter(canvas, () => {
  const { index } = props.device;
  const strip = layout.value;
  const stamp = `${index}|${input.revisions.get(index) ?? 0}|${strip.width}|${canvas.value?.clientWidth}`;
  if (stamp === drawn) return false;
  const surface = canvas.value && surfaceOf(canvas.value);
  if (!surface) return false;
  drawn = stamp;
  const { ctx } = surface;
  const colours = themePalette();
  const state = input.states.get(index);
  const tried = input.tried.get(index);

  for (const [i, bar] of strip.axes.entries()) {
    ctx.fillStyle = colours.border;
    ctx.beginPath();
    ctx.roundRect(bar.x, 0, bar.width, strip.height, 2);
    ctx.fill();
    const value = state?.axes[i];
    if (value === undefined) continue;
    const level = ((Math.max(-1, Math.min(1, value)) + 1) / 2) * strip.height;
    ctx.fillStyle = alpha(colours.accent, 0.45);
    ctx.beginPath();
    ctx.roundRect(bar.x, strip.height - level, bar.width, level, 2);
    ctx.fill();
    // The level itself, as a bright line on top of the fill.
    ctx.fillStyle = colours.accent;
    ctx.fillRect(
      bar.x,
      Math.max(0, Math.min(strip.height - 2, strip.height - level - 1)),
      bar.width,
      2
    );
  }

  for (const [i, pip] of strip.pips.entries()) {
    if (state?.buttons[i]) {
      ctx.fillStyle = colours.accent;
      ctx.fillRect(pip.x, pip.y, pip.size, pip.size);
    } else if (tried?.has(i)) {
      ctx.fillStyle = alpha(colours.accent, 0.16);
      ctx.fillRect(pip.x, pip.y, pip.size, pip.size);
      ctx.strokeStyle = alpha(colours.accent, 0.7);
      ctx.lineWidth = 1;
      ctx.strokeRect(pip.x + 0.5, pip.y + 0.5, pip.size - 1, pip.size - 1);
    } else {
      ctx.fillStyle = colours.border;
      ctx.fillRect(pip.x, pip.y, pip.size, pip.size);
    }
  }
  return false;
});

watch(layout, () => schedule());
</script>

<template>
  <canvas
    ref="canvas"
    class="strip"
    aria-hidden="true"
    data-testid="controller-strip"
    :style="{ width: `${layout.width}px`, height: `${layout.height}px` }"
  />
</template>

<style scoped>
.strip {
  display: block;
  flex-shrink: 0;
}
</style>
