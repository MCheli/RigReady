<script setup lang="ts">
import { computed } from 'vue';
import { orientationText } from '../core/labels';
import type { MapMonitor } from './mapTypes';

/**
 * The desktop drawn to scale: every monitor that is on at its position and size, rotated
 * monitors visibly tall, the main display marked. Monitors that are off are listed under
 * the drawing; monitors a saved layout wants but that are not connected are dashed.
 */
const props = withDefaults(
  defineProps<{
    monitors: MapMonitor[];
    /** The drawing never gets taller than this. */
    maxHeight?: number;
    compact?: boolean;
  }>(),
  { maxHeight: 280, compact: false }
);

const on = computed(() => props.monitors.filter((m) => m.enabled && m.width > 0));
const off = computed(() => props.monitors.filter((m) => !m.enabled));

const drawing = computed(() => {
  const list = on.value;
  if (list.length === 0) return undefined;
  const minX = Math.min(...list.map((m) => m.x));
  const minY = Math.min(...list.map((m) => m.y));
  const width = Math.max(...list.map((m) => m.x + m.width)) - minX;
  const height = Math.max(...list.map((m) => m.y + m.height)) - minY;
  const ratio = height / width;
  return {
    ratio,
    // Wide enough to fill the row, but never taller than maxHeight.
    maxWidth: `${Math.round(props.maxHeight / ratio)}px`,
    boxes: list.map((m) => ({
      ...m,
      orientation: orientationText(m.rotation),
      style: {
        left: `${((m.x - minX) / width) * 100}%`,
        top: `${((m.y - minY) / height) * 100}%`,
        width: `${(m.width / width) * 100}%`,
        height: `${(m.height / height) * 100}%`,
      },
    })),
  };
});
</script>

<template>
  <div class="mm" :class="{ compact }">
    <div v-if="drawing" class="mm-frame" :style="{ maxWidth: drawing.maxWidth }">
      <div class="mm-canvas" :style="{ paddingBottom: `${drawing.ratio * 100}%` }">
        <div
          v-for="box in drawing.boxes"
          :key="box.id"
          class="mm-box"
          :class="{ primary: box.primary, missing: box.connected === false }"
          :style="box.style"
          :title="`${box.label} · ${box.width}x${box.height} · ${box.orientation}${box.primary ? ' · main display' : ''}${box.connected === false ? ' · not connected' : ''}`"
          data-testid="map-monitor"
          :data-label="box.label"
          :data-rotation="box.rotation"
        >
          <span v-if="box.number !== undefined" class="mm-number">{{ box.number }}</span>
          <v-icon
            v-if="box.primary"
            icon="mdi-star"
            size="13"
            class="mm-star"
            aria-label="Main display"
          />
          <div class="mm-text">
            <span class="mm-label">{{ box.label }}</span>
            <small v-if="!compact">{{ box.width }}x{{ box.height }}</small>
            <small v-if="box.rotation" class="mm-rot">
              <v-icon
                icon="mdi-phone-rotate-portrait"
                size="12"
                :style="{ transform: `rotate(${box.rotation - 90}deg)` }"
              />
              {{ compact ? `${box.rotation}°` : `${box.orientation} · ${box.rotation}°` }}
            </small>
            <small v-if="box.connected === false" class="rr-warn">not connected</small>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="mm-nothing rr-muted">No monitor is on.</div>
    <div v-if="off.length" class="mm-off">
      <span
        v-for="m in off"
        :key="m.id"
        class="mm-off-item"
        data-testid="map-monitor-off"
        :data-label="m.label"
      >
        <v-icon icon="mdi-monitor-off" size="14" />
        {{ m.label }} · off<template v-if="m.connected === false"> · not connected</template>
      </span>
    </div>
  </div>
</template>

<style scoped>
.mm-frame {
  margin: 0 auto;
}
.mm-canvas {
  position: relative;
  width: 100%;
}
.mm-box {
  position: absolute;
  box-sizing: border-box;
  border: 1px solid var(--rr-border);
  outline: 3px solid var(--rr-surface);
  outline-offset: -4px;
  background: var(--rr-surface-2);
  overflow: hidden;
  border-radius: 3px;
}
.mm-box.primary {
  border: 2px solid var(--rr-accent);
}
.mm-box.missing {
  border: 1px dashed var(--rr-muted);
  background: transparent;
}
.mm-text {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  padding: 2px 4px;
  text-align: center;
  font-size: 12px;
  line-height: 1.25;
}
.compact .mm-text {
  font-size: 10.5px;
}
.mm-label {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}
.mm-text small {
  color: var(--rr-muted);
  white-space: nowrap;
}
.mm-rot {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.mm-number {
  position: absolute;
  top: 4px;
  left: 4px;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  border-radius: 9px;
  background: var(--rr-accent);
  color: #0f1317;
  font-size: 11px;
  font-weight: 700;
  line-height: 18px;
  text-align: center;
  z-index: 1;
}
.compact .mm-number {
  display: none;
}
.mm-star {
  position: absolute;
  top: 5px;
  right: 5px;
  color: var(--rr-accent);
  z-index: 1;
}
.mm-nothing {
  padding: 24px;
  text-align: center;
}
.mm-off {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  margin-top: 10px;
  font-size: 12px;
  color: var(--rr-muted);
}
.mm-off-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
</style>
