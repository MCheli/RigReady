<script setup lang="ts">
import { ref, watch } from 'vue';
import { axisPercent } from '../core/input';
import { TRACE_MS, tracePoints } from '../core/trace';
import { alpha, inset, schedule, surfaceOf, themePalette, usePainter } from './canvas';
import { useInputStore } from './store';

/**
 * One axis as a strip chart: the last few seconds run right to left and the pen at the
 * right edge is where the axis is now. The shaded band is the range it has reached. With
 * less motion asked for, the same strip is a still gauge: the range and the position along it.
 */
const props = defineProps<{ index: number; axis: number; reduced: boolean }>();
const input = useInputStore();
const canvas = ref<HTMLCanvasElement>();

/** Room at the right edge for the pen. */
const PEN = 7;
const PAD = 5;

let drawn = '';

function drawTrace(now: number): number {
  const surface = canvas.value && surfaceOf(canvas.value);
  if (!surface) return 0;
  const { ctx, width, height } = surface;
  const colours = themePalette();
  inset(surface);
  const history = input.histories.get(props.index);
  const range = input.ranges.get(`${props.index}:${props.axis}`);
  const y = (v: number): number => PAD + (1 - (v + 1) / 2) * (height - 2 * PAD);
  const right = width - PEN;

  // Centre line: half travel.
  ctx.strokeStyle = colours.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(1, Math.round(height / 2) + 0.5);
  ctx.lineTo(width - 1, Math.round(height / 2) + 0.5);
  ctx.stroke();

  if (range && range.max > range.min) {
    const top = y(range.max);
    const bottom = y(range.min);
    ctx.fillStyle = alpha(colours.accent, 0.1);
    ctx.fillRect(1, top, width - 2, bottom - top);
    ctx.strokeStyle = alpha(colours.accent, 0.42);
    ctx.beginPath();
    for (const edge of [top, bottom]) {
      ctx.moveTo(1, Math.round(edge) + 0.5);
      ctx.lineTo(width - 1, Math.round(edge) + 0.5);
    }
    ctx.stroke();
  }
  if (!history || history.length === 0) return 0;

  const line = tracePoints(history, props.axis, now, TRACE_MS, right, height, PAD);
  ctx.strokeStyle = colours.accent;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < line.length; i += 2) {
    if (i === 0) ctx.moveTo(line[i]!, line[i + 1]!);
    else ctx.lineTo(line[i]!, line[i + 1]!);
  }
  ctx.stroke();

  // The pen.
  const penY = line[line.length - 1]!;
  ctx.fillStyle = colours.accent;
  ctx.beginPath();
  ctx.arc(right, penY, 3, 0, Math.PI * 2);
  ctx.fill();
  return line.length / 2;
}

function drawGauge(): void {
  const surface = canvas.value && surfaceOf(canvas.value);
  if (!surface) return;
  const { ctx, width, height } = surface;
  const colours = themePalette();
  inset(surface);
  const value = input.states.get(props.index)?.axes[props.axis];
  const range = input.ranges.get(`${props.index}:${props.axis}`);
  const x = (v: number): number => PAD + ((v + 1) / 2) * (width - 2 * PAD);

  ctx.strokeStyle = colours.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(Math.round(width / 2) + 0.5, 1);
  ctx.lineTo(Math.round(width / 2) + 0.5, height - 1);
  ctx.stroke();

  if (range && range.max > range.min) {
    ctx.fillStyle = alpha(colours.accent, 0.16);
    ctx.fillRect(x(range.min), 4, x(range.max) - x(range.min), height - 8);
  }
  if (value === undefined) return;
  ctx.fillStyle = colours.accent;
  ctx.beginPath();
  ctx.roundRect(x(value) - 1.5, 4, 3, height - 8, 1.5);
  ctx.fill();
}

usePainter(canvas, (now) => {
  const history = input.histories.get(props.index);
  const range = input.ranges.get(`${props.index}:${props.axis}`);
  const moving =
    !props.reduced && history !== undefined && now - history.lastChange(props.axis) < TRACE_MS;
  const stamp = [
    props.index,
    props.axis,
    props.reduced,
    input.revisions.get(props.index) ?? 0,
    range?.min,
    range?.max,
    canvas.value?.clientWidth,
    canvas.value?.clientHeight,
  ].join('|');
  if (!moving && stamp === drawn) return false;
  const element = canvas.value;
  if (!element) return false;
  if (props.reduced) {
    drawGauge();
    element.dataset['points'] = '0';
  } else {
    element.dataset['points'] = String(drawTrace(now));
  }
  const value = input.states.get(props.index)?.axes[props.axis];
  element.dataset['pen'] = value === undefined ? '' : String(Math.round(axisPercent(value)));
  drawn = stamp;
  return moving;
});

watch(
  () => [props.index, props.axis, props.reduced],
  () => schedule()
);
</script>

<template>
  <canvas
    ref="canvas"
    class="trace"
    aria-hidden="true"
    data-testid="axis-trace"
    :data-mode="reduced ? 'gauge' : 'trace'"
  />
</template>

<style scoped>
.trace {
  display: block;
  width: 100%;
  height: 34px;
}
</style>
