<script setup lang="ts">
import { ref, watch } from 'vue';
import { axisPercent } from '../core/input';
import { TRAIL_MS, trailPoints } from '../core/trace';
import { alpha, inset, schedule, surfaceOf, themePalette, usePainter } from './canvas';
import { useInputStore } from './store';

/**
 * Two axes against each other, the way Windows' own controller panel draws a stick: the
 * dot is where it is now, the trail is where it has just been, and the box is how far it
 * has been pushed in each direction. With less motion asked for there is no trail.
 */
const props = defineProps<{ index: number; x: number; y: number; reduced: boolean }>();
const input = useInputStore();
const canvas = ref<HTMLCanvasElement>();

const PAD = 10;
let drawn = '';

function draw(now: number): number {
  const surface = canvas.value && surfaceOf(canvas.value);
  if (!surface) return 0;
  const { ctx, width, height } = surface;
  const colours = themePalette();
  inset(surface, 6);
  const half = Math.min(width, height) / 2 - PAD;
  const cx = width / 2;
  const cy = height / 2;
  // Screen coordinates, as Windows draws it: a stick pushed forward moves the dot up.
  const px = (v: number): number => cx + v * half;
  const py = (v: number): number => cy + v * half;

  // The frame of full travel, its circle and the cross through the centre.
  ctx.strokeStyle = colours.border;
  ctx.lineWidth = 1;
  ctx.strokeRect(Math.round(cx - half) + 0.5, Math.round(cy - half) + 0.5, half * 2, half * 2);
  ctx.beginPath();
  ctx.arc(cx, cy, half, 0, Math.PI * 2);
  ctx.moveTo(cx - half, Math.round(cy) + 0.5);
  ctx.lineTo(cx + half, Math.round(cy) + 0.5);
  ctx.moveTo(Math.round(cx) + 0.5, cy - half);
  ctx.lineTo(Math.round(cx) + 0.5, cy + half);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, half / 2, 0, Math.PI * 2);
  ctx.setLineDash([2, 4]);
  ctx.stroke();
  ctx.setLineDash([]);

  // How far it has been pushed.
  const rx = input.ranges.get(`${props.index}:${props.x}`);
  const ry = input.ranges.get(`${props.index}:${props.y}`);
  if (rx && ry && (rx.max > rx.min || ry.max > ry.min)) {
    const left = px(rx.min);
    const top = py(ry.min);
    const w = Math.max(1, px(rx.max) - left);
    const h = Math.max(1, py(ry.max) - top);
    ctx.fillStyle = alpha(colours.accent, 0.08);
    ctx.fillRect(left, top, w, h);
    ctx.strokeStyle = alpha(colours.accent, 0.42);
    ctx.strokeRect(Math.round(left) + 0.5, Math.round(top) + 0.5, Math.round(w), Math.round(h));
  }

  const history = input.histories.get(props.index);
  let points = 0;
  if (history && !props.reduced) {
    const trail = trailPoints(history, props.x, props.y, now, TRAIL_MS);
    points = trail.length / 3;
    ctx.lineCap = 'round';
    for (let i = 3; i < trail.length; i += 3) {
      // Fresh and full at the dot, thin and gone at the far end.
      const fresh = 1 - trail[i + 2]!;
      ctx.lineWidth = 1 + 1.25 * fresh;
      ctx.strokeStyle = alpha(colours.accent, 0.9 * fresh ** 1.3);
      ctx.beginPath();
      ctx.moveTo(px(trail[i - 3]!), py(trail[i - 2]!));
      ctx.lineTo(px(trail[i]!), py(trail[i + 1]!));
      ctx.stroke();
    }
  }

  const state = input.states.get(props.index);
  const vx = state?.axes[props.x];
  const vy = state?.axes[props.y];
  if (vx !== undefined && vy !== undefined) {
    ctx.fillStyle = alpha(colours.accent, 0.22);
    ctx.beginPath();
    ctx.arc(px(vx), py(vy), 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = colours.accent;
    ctx.beginPath();
    ctx.arc(px(vx), py(vy), 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = colours.bg;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  return points;
}

usePainter(canvas, (now) => {
  const history = input.histories.get(props.index);
  const rx = input.ranges.get(`${props.index}:${props.x}`);
  const ry = input.ranges.get(`${props.index}:${props.y}`);
  const moving =
    !props.reduced &&
    history !== undefined &&
    now - history.lastChangeOf([props.x, props.y]) < TRAIL_MS;
  const stamp = [
    props.index,
    props.x,
    props.y,
    props.reduced,
    input.revisions.get(props.index) ?? 0,
    rx?.min,
    rx?.max,
    ry?.min,
    ry?.max,
    canvas.value?.clientWidth,
  ].join('|');
  if (!moving && stamp === drawn) return false;
  const element = canvas.value;
  if (!element) return false;
  element.dataset['trail'] = String(draw(now));
  const state = input.states.get(props.index);
  const vx = state?.axes[props.x];
  const vy = state?.axes[props.y];
  element.dataset['x'] = vx === undefined ? '' : String(Math.round(axisPercent(vx)));
  element.dataset['y'] = vy === undefined ? '' : String(Math.round(axisPercent(vy)));
  drawn = stamp;
  return moving;
});

watch(
  () => [props.index, props.x, props.y, props.reduced],
  () => schedule()
);
</script>

<template>
  <canvas
    ref="canvas"
    class="plot"
    aria-hidden="true"
    data-testid="stick-plot"
    :data-mode="reduced ? 'still' : 'trail'"
  />
</template>

<style scoped>
.plot {
  display: block;
  width: 100%;
  aspect-ratio: 1;
}
</style>
