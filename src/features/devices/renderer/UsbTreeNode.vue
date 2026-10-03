<script setup lang="ts">
import { computed } from 'vue';
import type { UsbNode } from '../core/model';

defineOptions({ name: 'UsbTreeNode' });

const props = defineProps<{
  node: UsbNode;
  childrenOf: Map<string, UsbNode[]>;
  selected: string | undefined;
  hideEmpty: boolean;
}>();
const emit = defineEmits<{ select: [key: string] }>();

const children = computed(() =>
  (props.childrenOf.get(props.node.id) ?? []).filter(
    (c) => !props.hideEmpty || c.kind === 'device' || c.devicesBelow > 0
  )
);
const icon = computed(() =>
  props.node.kind === 'root'
    ? 'mdi-expansion-card-variant'
    : props.node.kind === 'hub'
      ? 'mdi-usb-port'
      : props.node.isGameController
        ? 'mdi-controller-classic-outline'
        : 'mdi-usb'
);
const isSelected = computed(
  () => props.node.deviceKey !== undefined && props.node.deviceKey === props.selected
);
</script>

<template>
  <li class="usb-item">
    <component
      :is="node.kind === 'device' ? 'button' : 'div'"
      class="usb-node"
      :class="[node.kind, { selected: isSelected, warn: node.warning }]"
      :type="node.kind === 'device' ? 'button' : undefined"
      data-testid="usb-node"
      :data-kind="node.kind"
      :data-name="node.name"
      :data-key="node.deviceKey"
      :data-selected="isSelected"
      @click="node.deviceKey && emit('select', node.deviceKey)"
    >
      <v-icon :icon="icon" size="16" class="usb-icon" />
      <span v-if="node.port !== undefined && node.kind !== 'root'" class="usb-port rr-mono">{{
        node.port
      }}</span>
      <span class="usb-name">{{ node.name }}</span>
      <span v-if="node.kind === 'hub'" class="rr-muted usb-meta">
        {{
          node.devicesBelow
            ? `${node.devicesBelow} ${node.devicesBelow === 1 ? 'device' : 'devices'}`
            : 'empty'
        }}
      </span>
      <span v-if="node.required" class="usb-tag">needed</span>
      <span v-if="node.hidden" class="usb-tag rr-warn">hidden by HidHide</span>
      <span
        v-if="node.warning"
        class="usb-tag"
        :class="node.warning === 'tooDeep' ? 'rr-bad' : 'rr-warn'"
      >
        {{ node.depth }} hubs deep{{
          node.warning === 'tooDeep' ? ': at the USB limit' : ': near the USB limit'
        }}
      </span>
    </component>
    <ul v-if="children.length" class="usb-children">
      <UsbTreeNode
        v-for="child in children"
        :key="child.id"
        :node="child"
        :children-of="childrenOf"
        :selected="selected"
        :hide-empty="hideEmpty"
        @select="emit('select', $event)"
      />
    </ul>
  </li>
</template>

<style scoped>
.usb-item {
  list-style: none;
}
.usb-children {
  margin: 0 0 0 11px;
  padding: 0 0 0 14px;
  border-left: 1px solid var(--rr-border);
}
.usb-node {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 13px;
  text-align: left;
  color: inherit;
  background: none;
  border: 1px solid transparent;
}
.usb-node.root {
  font-weight: 600;
}
.usb-node.hub {
  color: var(--rr-muted);
}
.usb-node.device {
  cursor: pointer;
}
.usb-node.device:hover {
  background: var(--rr-surface-2);
}
.usb-node.selected {
  background: color-mix(in srgb, var(--rr-accent) 16%, var(--rr-surface));
  border-color: color-mix(in srgb, var(--rr-accent) 60%, transparent);
}
.usb-icon {
  opacity: 0.8;
}
.usb-port {
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  border-radius: 4px;
  background: var(--rr-surface-2);
  color: var(--rr-muted);
  font-size: 11px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.usb-meta {
  font-size: 12px;
}
.usb-tag {
  font-size: 11.5px;
  color: var(--rr-muted);
  border: 1px solid var(--rr-border);
  border-radius: 999px;
  padding: 0 7px;
}
</style>
