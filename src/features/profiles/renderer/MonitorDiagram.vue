<script setup lang="ts">
import { computed } from 'vue';

/**
 * The monitor arrangement a capture found, drawn to scale: every monitor that is on at
 * its place and size, portrait ones visibly tall, the main display marked. Monitors that
 * are connected but off are listed under the drawing.
 */
export interface DiagramMonitor {
  label: string;
  enabled: boolean;
  primary: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

const props = withDefaults(defineProps<{ monitors: DiagramMonitor[]; maxHeight?: number }>(), {
  maxHeight: 170,
});

const on = computed(() => props.monitors.filter((m) => m.enabled && m.width > 0 && m.height > 0));
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
    maxWidth: `${Math.round(props.maxHeight / ratio)}px`,
    boxes: list.map((m) => ({
      ...m,
      // Narrow boxes (a portrait screen beside an ultrawide) only have room for the size.
      narrow: m.width / width < 0.16,
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
  <div class="md" data-testid="capture-monitor-diagram">
    <div v-if="drawing" class="md-frame" :style="{ maxWidth: drawing.maxWidth }">
      <div class="md-canvas" :style="{ paddingBottom: `${drawing.ratio * 100}%` }">
        <div
          v-for="(box, index) in drawing.boxes"
          :key="index"
          class="md-box"
          :class="{ primary: box.primary, narrow: box.narrow }"
          :style="box.style"
          :title="`${box.label} · ${box.width}x${box.height} at ${box.x},${box.y}${box.rotation ? ` · rotated ${box.rotation}°` : ''}${box.primary ? ' · main display' : ''}`"
          data-testid="capture-monitor-box"
        >
          <span v-if="!box.narrow" class="md-name">{{ box.label }}</span>
          <span class="md-size">{{ box.width }}×{{ box.height }}</span>
          <span v-if="box.primary" class="md-main"><v-icon icon="mdi-star" size="11" /> main</span>
          <span v-else-if="box.rotation" class="md-main">{{ box.rotation }}°</span>
        </div>
      </div>
    </div>
    <div v-if="off.length > 0" class="md-off" data-testid="capture-monitor-off">
      <v-icon icon="mdi-monitor-off" size="14" />
      Off in this arrangement: {{ off.map((m) => m.label).join(', ') }}
    </div>
  </div>
</template>

<style scoped>
.md-frame {
  width: 100%;
}
.md-canvas {
  position: relative;
  width: 100%;
  height: 0;
}
.md-box {
  position: absolute;
  box-sizing: border-box;
  border: 1px solid #47566a;
  background: #222b36;
  border-radius: 3px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  overflow: hidden;
  font-size: 11px;
  line-height: 1.25;
  color: var(--rr-text);
  text-align: center;
  padding: 2px;
}
.md-box.primary {
  border-color: var(--rr-accent);
  background: #1f3145;
}
.md-box.narrow {
  font-size: 9.5px;
}
.md-name {
  font-weight: 600;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.md-size {
  color: #aab4c0;
  white-space: nowrap;
}
.md-main {
  color: #aab4c0;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.md-box.primary .md-main {
  color: var(--rr-accent);
}
.md-off {
  margin-top: 8px;
  font-size: 12.5px;
  color: var(--rr-muted);
  display: flex;
  align-items: center;
  gap: 6px;
}
</style>
