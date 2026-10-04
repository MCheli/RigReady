<script setup lang="ts">
import { computed } from 'vue';
import type { UsbNode } from '../core/model';
import { layoutUsbTree, pathTo, USB_TREE } from '../core/usbTree';

/**
 * The USB map drawn as a tree: a USB controller of the computer heads each tree, hubs branch
 * off to the right, and every device is at the end of its branch. The way to the selected
 * device is drawn through in the accent colour, from the controller to the device.
 */
const props = defineProps<{
  nodes: UsbNode[];
  selected: string | undefined;
  hideEmpty: boolean;
}>();
const emit = defineEmits<{ select: [key: string] }>();

const drawing = computed(() => layoutUsbTree(props.nodes, { hideEmpty: props.hideEmpty }));
const path = computed(() => pathTo(props.nodes, props.selected));
const byId = computed(() => new Map(props.nodes.map((node) => [node.id, node])));
/** The lines of the way to the selected device come last, so they lie on top of the rest. */
const links = computed(() =>
  drawing.value.links
    .map((link) => ({ ...link, on: path.value.has(link.to) }))
    .sort((a, b) => Number(a.on) - Number(b.on))
);

const icon = (node: UsbNode): string =>
  node.kind === 'root'
    ? 'mdi-expansion-card-variant'
    : node.kind === 'hub'
      ? 'mdi-usb-port'
      : node.isGameController
        ? 'mdi-controller-classic-outline'
        : 'mdi-usb';

const behind = (node: UsbNode): string =>
  node.devicesBelow
    ? `${node.devicesBelow} ${node.devicesBelow === 1 ? 'device' : 'devices'} behind it`
    : 'nothing plugged in';

/** Where a node is plugged in, in words: what a pointer resting on it is told. */
function plugged(node: UsbNode): string {
  const parent = node.parentId ? byId.value.get(node.parentId) : undefined;
  if (!parent) return node.name;
  return node.port !== undefined
    ? `${node.name}: port ${node.port} on ${parent.name}`
    : `${node.name}: on ${parent.name}`;
}
</script>

<template>
  <div
    class="usb-drawing"
    :style="{
      height: `${drawing.height}px`,
      minWidth: `${drawing.deepestX + 240}px`,
      '--usb-row': `${USB_TREE.rowHeight}px`,
      '--usb-box': `${USB_TREE.boxHeight}px`,
      '--usb-hub': `${USB_TREE.hubWidth}px`,
    }"
    data-testid="usb-drawing"
  >
    <svg class="usb-lines" :height="drawing.height" aria-hidden="true">
      <path
        v-for="link in links"
        :key="`${link.from}>${link.to}`"
        :d="link.d"
        class="usb-link"
        :class="{ on: link.on }"
        data-testid="usb-link"
        :data-on="link.on"
      />
    </svg>
    <template v-for="box in drawing.boxes" :key="box.node.id">
      <button
        v-if="box.node.kind === 'device'"
        type="button"
        class="usb-node device"
        :class="{ selected: box.node.deviceKey === selected }"
        :style="{
          left: `${box.x}px`,
          top: `${box.y}px`,
          maxWidth: `calc(100% - ${box.x}px)`,
        }"
        :title="plugged(box.node)"
        data-testid="usb-node"
        data-kind="device"
        :data-name="box.node.name"
        :data-key="box.node.deviceKey"
        :data-selected="box.node.deviceKey !== undefined && box.node.deviceKey === selected"
        @click="box.node.deviceKey && emit('select', box.node.deviceKey)"
      >
        <span v-if="box.node.port !== undefined" class="usb-port rr-mono">{{ box.node.port }}</span>
        <v-icon :icon="icon(box.node)" size="16" class="usb-icon" />
        <span class="usb-name">{{ box.node.name }}</span>
        <span v-if="box.node.required" class="usb-tag">needed</span>
        <span v-if="box.node.hidden" class="usb-tag rr-warn">hidden by HidHide</span>
        <span
          v-if="box.node.warning"
          class="usb-tag"
          :class="box.node.warning === 'tooDeep' ? 'rr-bad' : 'rr-warn'"
        >
          {{ box.node.depth }} hubs deep{{
            box.node.warning === 'tooDeep' ? ': at the USB limit' : ': near the USB limit'
          }}
        </span>
      </button>
      <div
        v-else-if="box.node.kind === 'root'"
        class="usb-node root"
        :class="{ on: path.has(box.node.id) }"
        :style="{ left: `${box.x}px`, top: `${box.y}px` }"
        data-testid="usb-node"
        data-kind="root"
        :data-name="box.node.name"
        :data-on="path.has(box.node.id)"
      >
        <v-icon :icon="icon(box.node)" size="16" class="usb-icon" />
        <span class="usb-name">{{ box.node.name }}</span>
        <span v-if="box.end" class="usb-meta">nothing plugged in</span>
      </div>
      <div
        v-else
        class="usb-hub"
        :style="{ left: `${box.x}px`, top: `${box.y}px` }"
        :title="`${plugged(box.node)}. ${behind(box.node)}`"
        data-testid="usb-node"
        data-kind="hub"
        :data-name="box.node.name"
        :data-on="path.has(box.node.id)"
      >
        <span class="usb-node hub" :class="{ on: path.has(box.node.id) }">
          <span v-if="box.node.port !== undefined" class="usb-port rr-mono">{{
            box.node.port
          }}</span>
          <v-icon :icon="icon(box.node)" size="14" class="usb-icon" />
        </span>
        <!-- A hub with something behind it is its port in the drawing and its name to a
             pointer and a screen reader; an empty one has the row to itself and says so. -->
        <span :class="box.end ? 'usb-meta' : 'usb-unseen'"
          >{{ box.node.name }}<template v-if="box.end"> · empty</template></span
        >
      </div>
    </template>
  </div>
</template>

<style scoped>
.usb-drawing {
  position: relative;
}
.usb-lines {
  position: absolute;
  inset: 0;
  width: 100%;
  overflow: visible;
  pointer-events: none;
}
.usb-link {
  fill: none;
  stroke: color-mix(in srgb, var(--rr-muted) 38%, var(--rr-border));
  stroke-width: 1.25;
  transition: stroke 0.15s ease-out;
}
.usb-link.on {
  stroke: var(--rr-accent);
  stroke-width: 2;
}
.usb-node {
  display: flex;
  align-items: center;
  gap: 7px;
  height: var(--usb-box);
  padding: 0 8px;
  box-sizing: border-box;
  border: 1px solid var(--rr-border);
  border-radius: 6px;
  background: var(--rr-surface);
  color: inherit;
  font-size: 13px;
  text-align: left;
  white-space: nowrap;
  transition:
    border-color 0.15s ease-out,
    background-color 0.15s ease-out;
}
.usb-node.root,
.usb-node.device,
.usb-hub {
  position: absolute;
  margin-top: calc((var(--usb-row) - var(--usb-box)) / 2);
}
.usb-node.root {
  font-weight: 600;
  background: var(--rr-surface-2);
}
.usb-hub {
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
}
.usb-node.hub {
  width: var(--usb-hub);
  flex-shrink: 0;
  justify-content: center;
  gap: 4px;
  padding: 0 4px;
  border-radius: 999px;
  color: var(--rr-muted);
}
.usb-node.on {
  border-color: var(--rr-accent);
  color: var(--rr-text);
}
.usb-node.device {
  border-color: transparent;
  background: none;
  cursor: pointer;
}
.usb-node.device:hover {
  background: var(--rr-surface-2);
}
.usb-node.device.selected {
  background: color-mix(in srgb, var(--rr-accent) 16%, var(--rr-surface));
  border-color: color-mix(in srgb, var(--rr-accent) 60%, transparent);
}
.usb-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.usb-icon {
  opacity: 0.8;
  flex-shrink: 0;
}
.usb-port {
  flex-shrink: 0;
  min-width: 16px;
  font-size: 11px;
  text-align: center;
  color: var(--rr-muted);
  font-variant-numeric: tabular-nums;
}
.usb-node.device .usb-port {
  height: 18px;
  padding: 0 4px;
  border-radius: 4px;
  background: var(--rr-surface-2);
  line-height: 18px;
}
.usb-meta {
  font-size: 12px;
  font-weight: 400;
  color: var(--rr-muted);
}
.usb-unseen {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
.usb-tag {
  flex-shrink: 0;
  font-size: 11.5px;
  border: 1px solid var(--rr-border);
  border-radius: 999px;
  padding: 0 7px;
}
/* A tag that warns keeps the colour and the icon its status class gives it. */
.usb-tag:not(.rr-warn, .rr-bad) {
  color: var(--rr-muted);
}
@media (prefers-reduced-motion: reduce) {
  .usb-link,
  .usb-node {
    transition: none;
  }
}
</style>
