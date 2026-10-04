<script setup lang="ts">
import { computed } from 'vue';
import type { CheckStatus } from '../../../core/checks/engine';
import type { RigGlance } from '../contract';
import { chipNames, deviceKind, KIND_ICON, KIND_NAME } from '../core/deviceKind';
import { drawDesk } from './rigDrawing';

/**
 * The rig at a glance: the monitors drawn to scale as they are now, and the setup's
 * devices as labelled chips. A problem shows as a place, not only as a row; choosing a
 * monitor or a device leads to its row in the checklist.
 */
export type RigState = CheckStatus | 'checking' | 'off';

export interface RigDevice {
  itemId: string;
  title: string;
  state: RigState;
  required: boolean;
  /** What the check said, for the tooltip. */
  summary?: string | undefined;
}

const props = defineProps<{
  glance?: RigGlance | undefined;
  /** How the setup's monitor item stands; undefined when it has none. */
  monitorState?: RigState | undefined;
  devices: RigDevice[];
}>();
const emit = defineEmits<{ select: [itemId: string] }>();

const MAX_WIDTH = 330;
const MAX_HEIGHT = 96;
/** A box at least this wide has room for its monitor's name. */
const ROOM_FOR_NAME = 80;

/** What is different about a monitor is marked only while the checklist says the arrangement is off. */
const marked = computed(
  () =>
    props.monitorState === 'fail' || props.monitorState === 'warn' || props.monitorState === 'error'
);

const drawing = computed(() => {
  const desk = drawDesk(props.glance?.monitors ?? [], MAX_WIDTH, MAX_HEIGHT);
  if (!desk) return undefined;
  return {
    style: { width: `${desk.width}px`, height: `${desk.height}px` },
    boxes: desk.boxes.map((box) => {
      const issue = marked.value ? box.monitor.issue : undefined;
      const facts = [
        `${box.monitor.width}x${box.monitor.height}`,
        ...(box.monitor.rotation ? [`rotated ${box.monitor.rotation}°`] : []),
        ...(box.monitor.primary ? ['main display'] : []),
        ...(issue ? [issue] : []),
      ];
      return {
        ...box.monitor,
        issue,
        named: box.width >= ROOM_FOR_NAME,
        tip: `${box.monitor.label} · ${facts.join(' · ')}`,
        style: {
          left: `${box.left}px`,
          top: `${box.top}px`,
          width: `${box.width}px`,
          height: `${box.height}px`,
        },
      };
    }),
  };
});

const on = computed(() => (props.glance?.monitors ?? []).filter((m) => m.enabled));
const off = computed(() => (props.glance?.monitors ?? []).filter((m) => !m.enabled));

/** Under the drawing: what is not as the setup expects, in words, then the monitors that are off. */
const notes = computed(() => {
  const glance = props.glance;
  if (!glance) return [];
  const wrong = marked.value
    ? [
        ...glance.monitors
          .filter((m) => m.issue)
          .map((m) => ({ id: m.id, text: `${m.label}: ${m.issue}`, wrong: true })),
        ...glance.missing.map((name) => ({
          id: `missing:${name}`,
          text: `${name}: not connected`,
          wrong: true,
        })),
      ]
    : [];
  const quiet = off.value
    .filter((m) => !(marked.value && m.issue))
    .map((m) => ({ id: m.id, text: `${m.label} is off`, wrong: false }));
  return [...wrong, ...quiet];
});

const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

const summary = computed(() => {
  const parts = [`${count(on.value.length, 'monitor', 'monitors')} on`];
  if (off.value.length > 0) parts.push(`${off.value.length} off`);
  const wrong = notes.value.filter((n) => n.wrong).length;
  const tail = wrong > 0 ? `; ${wrong} not as this setup expects` : '';
  return `${parts.join(', ')}${tail}`;
});

function showMonitors(): void {
  if (props.glance?.itemId) emit('select', props.glance.itemId);
}

const STATE: Record<RigState, { icon: string; tone: string; says: string }> = {
  pass: { icon: 'mdi-check-circle', tone: 'rr-ok', says: 'OK' },
  fail: { icon: 'mdi-close-circle', tone: 'rr-bad', says: 'Not met' },
  warn: { icon: 'mdi-alert', tone: 'rr-warn', says: 'Not met (optional)' },
  error: { icon: 'mdi-alert-circle-outline', tone: 'rr-bad', says: 'Could not be checked' },
  checking: { icon: 'mdi-circle-outline', tone: 'rr-muted', says: 'Checking' },
  off: { icon: 'mdi-minus-circle-outline', tone: 'rr-muted', says: 'Off' },
};

const chips = computed(() => {
  const short = chipNames(props.devices.map((device) => device.title));
  return props.devices.map((device, index) => {
    const kind = deviceKind(device.title);
    const look = STATE[device.state];
    return {
      ...device,
      kind,
      // The maker most of them share is left out of the chip; the tooltip has the whole name.
      name: short[index] ?? device.title,
      icon: KIND_ICON[kind],
      look: device.state === 'error' && !device.required ? { ...look, tone: 'rr-warn' } : look,
      tip: `${KIND_NAME[kind]}: ${device.title} · ${device.summary ?? look.says}`,
    };
  });
});
</script>

<template>
  <section
    v-if="glance || devices.length > 0"
    class="rr-panel rig"
    aria-label="The rig at a glance"
    data-testid="fly-rig"
  >
    <div
      v-if="glance"
      class="rig-part rig-monitors"
      data-testid="rig-monitors"
      :data-state="monitorState ?? 'none'"
    >
      <h2 class="rr-section-title">Monitors</h2>
      <div v-if="glance.error" class="rig-note rr-warn" data-testid="rig-monitors-error">
        The monitors cannot be read: {{ glance.error }}
      </div>
      <template v-else>
        <component
          :is="glance.itemId ? 'button' : 'div'"
          v-if="drawing"
          class="rig-desk"
          :class="{ 'rig-desk-link': glance.itemId }"
          :type="glance.itemId ? 'button' : undefined"
          :role="glance.itemId ? undefined : 'img'"
          :aria-label="glance.itemId ? `${summary}. Show the monitor check` : summary"
          data-testid="rig-desk"
          @click="showMonitors"
        >
          <span class="rig-canvas" :style="drawing.style">
            <span
              v-for="box in drawing.boxes"
              :key="box.id"
              class="rig-monitor"
              :class="{ 'rig-monitor-main': box.primary, 'rig-monitor-wrong': box.issue }"
              :style="box.style"
              :title="box.tip"
              data-testid="rig-monitor"
              :data-label="box.label"
              :data-issue="box.issue ?? ''"
              :data-rotation="box.rotation"
            >
              <span v-if="box.named" class="rig-monitor-name">{{ box.label }}</span>
              <v-icon
                v-if="box.issue"
                icon="mdi-alert-circle"
                class="rr-bad rig-monitor-mark"
                size="14"
                :aria-label="`${box.label}: ${box.issue}`"
              />
            </span>
          </span>
        </component>
        <div v-else class="rig-note rr-muted" data-testid="rig-no-monitor">No monitor is on.</div>
        <ul v-if="notes.length" class="rig-notes" data-testid="rig-notes">
          <li
            v-for="note in notes"
            :key="note.id"
            :class="note.wrong ? 'rr-bad' : 'rr-muted'"
            :data-wrong="note.wrong"
          >
            {{ note.text }}
          </li>
        </ul>
      </template>
    </div>

    <div v-if="devices.length > 0" class="rig-part rig-devices">
      <h2 class="rr-section-title">Devices</h2>
      <ul class="rig-chips">
        <li v-for="device in chips" :key="device.itemId">
          <button
            type="button"
            class="rig-chip"
            :class="`rig-chip-${device.state}`"
            :title="device.tip"
            data-testid="rig-device"
            :data-item="device.itemId"
            :data-state="device.state"
            :data-kind="device.kind"
            @click="emit('select', device.itemId)"
          >
            <v-icon :icon="device.icon" size="16" class="rig-chip-kind" />
            <span class="rig-chip-name">{{ device.name }}</span>
            <v-icon
              :icon="device.look.icon"
              :class="device.look.tone"
              size="15"
              :aria-label="device.look.says"
            />
          </button>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.rig {
  display: flex;
  gap: 32px;
  padding: 14px 24px 16px;
  margin-bottom: 20px;
}
.rig-part {
  min-width: 0;
}
.rig-monitors {
  flex: none;
  max-width: 360px;
}
.rig-devices {
  flex: 1;
}
.rig-desk {
  display: block;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: none;
  color: inherit;
  text-align: left;
}
.rig-desk-link {
  cursor: pointer;
}
.rig-canvas {
  position: relative;
  display: block;
}
/* A monitor: a screen inside a thin bezel, in the proportions it has on the desk. */
.rig-monitor {
  position: absolute;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid color-mix(in srgb, var(--rr-muted) 55%, var(--rr-border));
  border-radius: 3px;
  background: var(--rr-surface-2);
  box-shadow: inset 0 0 0 2px var(--rr-surface);
  transition:
    border-color 180ms ease-out,
    left 180ms ease-out,
    top 180ms ease-out,
    width 180ms ease-out,
    height 180ms ease-out;
}
.rig-desk-link:hover .rig-monitor {
  border-color: color-mix(in srgb, var(--rr-accent) 60%, var(--rr-border));
}
.rig-monitor-main {
  border-color: var(--rr-accent);
}
/* Dashed as well as red: it reads without colour, and the mark inside says what it is. */
.rig-monitor-wrong,
.rig-desk-link:hover .rig-monitor-wrong {
  border: 1px dashed var(--rr-bad);
}
.rig-monitor-name {
  max-width: 100%;
  padding: 0 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--rr-muted);
}
.rig-monitor {
  gap: 4px;
}
.rig-monitor-mark {
  flex: none;
}
.rig-note {
  font-size: 12.5px;
}
.rig-notes {
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
  font-size: 12px;
}
.rig-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.rig-chips li {
  min-width: 0;
  max-width: 100%;
}
.rig-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 236px;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--rr-border);
  border-radius: 14px;
  background: var(--rr-surface-2);
  color: var(--rr-text);
  font-size: 12.5px;
  cursor: pointer;
  transition:
    border-color 150ms ease-out,
    background-color 150ms ease-out;
}
.rig-chip:hover {
  border-color: color-mix(in srgb, var(--rr-accent) 60%, var(--rr-border));
}
.rig-chip-kind {
  flex: none;
  color: var(--rr-muted);
}
.rig-chip-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rig-chip-fail,
.rig-chip-error {
  border-color: color-mix(in srgb, var(--rr-bad) 60%, var(--rr-border));
}
.rig-chip-warn {
  border-color: color-mix(in srgb, var(--rr-warn) 55%, var(--rr-border));
}
.rig-chip-off .rig-chip-name,
.rig-chip-checking .rig-chip-name {
  color: var(--rr-muted);
}
@media (prefers-reduced-motion: reduce) {
  .rig-monitor,
  .rig-chip {
    transition: none;
  }
}
</style>
