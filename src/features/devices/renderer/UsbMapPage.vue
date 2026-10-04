<script setup lang="ts">
import DeviceTabs from './DeviceTabs.vue';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import PageSkeleton from '../../../renderer/components/PageSkeleton.vue';
import { errorText, useClient } from '../../../renderer/ipc';
import { onMachineChanged } from '../../../renderer/machine';
import { devicesContract } from '../contract';
import type { UsbMap, UsbNode } from '../core/model';
import UsbTreeDrawing from './UsbTreeDrawing.vue';
import { useReducedMotion } from './canvas';
import { useDevicesStore } from './store';

const api = useClient(devicesContract);
const devicesStore = useDevicesStore();
const route = useRoute();
const router = useRouter();
const map = ref<UsbMap>();
const error = ref<string>();
const hideEmpty = ref(true);
const showSpare = ref<string>();

const selected = computed(() => {
  const value = route.query['select'];
  return typeof value === 'string' ? value : undefined;
});

async function load(): Promise<void> {
  const result = await api.usbMap();
  if (result.ok) {
    map.value = result.value;
    error.value = undefined;
  } else {
    error.value = errorText(result.error);
  }
  if (!devicesStore.overview) void devicesStore.load();
}

const roots = computed(() => (map.value?.nodes ?? []).filter((n) => n.kind === 'root'));
const selectedNode = computed(() =>
  selected.value === undefined
    ? undefined
    : map.value?.nodes.find((n) => n.deviceKey === selected.value)
);
const selectedDevice = computed(() =>
  devicesStore.overview?.devices.find((d) => d.key === selected.value)
);
const chain = computed(() => {
  const out: UsbNode[] = [];
  let node = selectedNode.value;
  const byId = new Map((map.value?.nodes ?? []).map((n) => [n.id, n]));
  while (node?.parentId) {
    node = byId.get(node.parentId);
    if (node) out.unshift(node);
  }
  return out;
});
const deepWarnings = computed(() => (map.value?.nodes ?? []).filter((n) => n.warning));

async function select(key: string): Promise<void> {
  await router.replace({ query: { select: key } });
}

const bar = ref<HTMLElement>();
const reducedMotion = useReducedMotion();

/**
 * Bring the selected device into view. One that is in view already (it was clicked) stays
 * under the pointer; one chosen elsewhere, in Devices or in the list of what can be
 * unplugged, is brought to the middle of the window.
 */
async function reveal(): Promise<void> {
  await nextTick();
  const node = document.querySelector(`[data-testid="usb-node"][data-selected="true"]`);
  if (!node) return;
  const box = node.getBoundingClientRect();
  const under = bar.value?.getBoundingClientRect().bottom ?? 0;
  if (box.top >= under && box.bottom <= window.innerHeight) return;
  node.scrollIntoView({ block: 'center', behavior: reducedMotion.value ? 'auto' : 'smooth' });
}

let off: (() => void) | undefined;
onMounted(async () => {
  off = onMachineChanged(() => void load());
  await load();
  if (selected.value) await reveal();
});
onBeforeUnmount(() => off?.());
watch(selected, () => void reveal());
</script>

<template>
  <div data-testid="usb-page">
    <h1 class="rr-page-title">USB map</h1>
    <p class="rr-page-sub">
      Where everything is plugged in: each USB controller in the computer, the hubs behind it, and
      the devices on their ports. Click a device to see the way to it.
    </p>
    <DeviceTabs />

    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>

    <template v-if="map">
      <div v-if="roots.length === 0" class="rr-panel rr-empty">No USB devices found.</div>

      <div
        v-for="c in map.controllers"
        :key="c.id"
        class="rr-panel usb-controller"
        data-testid="usb-controller"
        :data-status="c.status"
      >
        <v-icon
          :icon="
            c.status === 'over'
              ? 'mdi-close-circle'
              : c.status === 'near'
                ? 'mdi-alert'
                : 'mdi-check-circle'
          "
          :class="c.status === 'over' ? 'rr-bad' : c.status === 'near' ? 'rr-warn' : 'rr-ok'"
        />
        <div class="rr-row-main">
          <div class="rr-row-title">{{ c.name }}</div>
          <div class="rr-row-sub" data-testid="usb-controller-counts">
            {{ c.devices }} {{ c.devices === 1 ? 'device' : 'devices' }} and {{ c.hubs }}
            {{ c.hubs === 1 ? 'hub' : 'hubs' }} · {{ c.addresses }} of 127 USB addresses used ·
            deepest device {{ c.deepest }} {{ c.deepest === 1 ? 'hub' : 'hubs' }} down
          </div>
          <div
            v-if="c.status !== 'ok'"
            class="rr-row-sub"
            :class="c.status === 'over' ? 'rr-bad' : 'rr-warn'"
          >
            {{
              c.status === 'over'
                ? 'Over the limit: Windows cannot start every device on this controller. Move some to another USB controller or unplug what you do not need.'
                : 'Close to the limit. Before adding more, move some devices to another USB controller (a PCIe USB card adds one).'
            }}
          </div>
          <div class="rr-row-sub usb-meter">
            <div
              class="usb-meter-fill"
              :class="c.status"
              :style="{ width: `${Math.min(100, (c.addresses / 127) * 100)}%` }"
            />
          </div>
        </div>
        <v-btn
          v-if="map.activeProfile && c.spare.length"
          size="small"
          variant="text"
          data-testid="usb-spare-toggle"
          @click="showSpare = showSpare === c.id ? undefined : c.id"
          >{{ showSpare === c.id ? 'Hide' : 'What can I unplug?' }}</v-btn
        >
      </div>
      <div
        v-for="c in map.controllers.filter((x) => showSpare === x.id)"
        :key="`spare-${c.id}`"
        class="rr-panel usb-spare"
        data-testid="usb-spare"
      >
        <div class="rr-row-sub mb-2">
          Not needed by <strong>{{ map.activeProfile }}</strong
          >, so these are the first to unplug or move when this controller runs short:
        </div>
        <div v-for="s in c.spare" :key="s.key" class="usb-spare-row">
          <a href="#" @click.prevent="select(s.key)">{{ s.name }}</a>
          <span class="rr-muted">{{ s.location }}</span>
        </div>
      </div>

      <v-alert
        v-for="n in deepWarnings"
        :key="n.id"
        :type="n.warning === 'tooDeep' ? 'error' : 'warning'"
        variant="tonal"
        density="compact"
        class="mb-2"
      >
        {{ n.name }} is {{ n.depth }} hubs away from the computer. USB allows five; plug it in
        closer to the computer.
      </v-alert>

      <div class="rr-panel usb-tree" data-testid="usb-tree">
        <!-- The way to the selected device in words. It stays in view while the drawing
             scrolls under it, so the whole width is the drawing's. -->
        <div ref="bar" class="usb-bar">
          <div class="usb-picked" data-testid="usb-selected">
            <template v-if="selectedNode">
              <div class="usb-picked-head">
                <span class="usb-picked-name">{{ selectedNode.name }}</span>
                <span class="rr-muted">
                  <template v-if="selectedDevice?.location"
                    >{{ selectedDevice.location.text }} ·
                  </template>
                  {{ selectedNode.depth }} {{ selectedNode.depth === 1 ? 'hub' : 'hubs' }} between
                  it and the computer<template v-if="selectedDevice?.requiredBy.length">
                    · needed by {{ selectedDevice.requiredBy.join(', ') }}</template
                  >
                </span>
              </div>
              <ol class="usb-chain" aria-label="The way to it from the computer">
                <li v-for="n in chain" :key="n.id">
                  <span
                    v-if="n.port !== undefined && n.kind !== 'root'"
                    class="rr-mono usb-chain-port"
                    >{{ n.port }}</span
                  >
                  {{ n.name }}
                </li>
                <li class="usb-chain-self">
                  <span v-if="selectedNode.port !== undefined" class="rr-mono usb-chain-port">{{
                    selectedNode.port
                  }}</span>
                  {{ selectedNode.name }}
                </li>
              </ol>
            </template>
            <span v-else class="rr-muted">
              Click a device in the tree to see the path to it from the computer.
            </span>
          </div>
          <v-btn
            v-if="selectedNode"
            variant="tonal"
            size="small"
            prepend-icon="mdi-format-list-bulleted"
            data-testid="usb-show-device"
            @click="
              router.push({
                path: '/configure/devices',
                query: { select: selectedNode.deviceKey },
              })
            "
            >Show in Devices</v-btn
          >
          <v-switch
            v-model="hideEmpty"
            label="Hide empty hubs"
            class="flex-grow-0"
            data-testid="usb-hide-empty"
          />
        </div>
        <div class="usb-scroll">
          <UsbTreeDrawing
            :nodes="map.nodes"
            :selected="selected"
            :hide-empty="hideEmpty"
            @select="select"
          />
        </div>
        <p class="rr-muted usb-foot">
          Follow a line from the USB controller to a device: each round box on the way is a hub, and
          every number is the port something is plugged into on the hub before it. Point at a hub
          for its name. A USB 3 hub appears twice (once for USB 2 devices, once for USB 3 devices),
          and one hub box often holds two or three hub chips.
        </p>
      </div>
    </template>
    <PageSkeleton v-else-if="!error" label="Reading the USB tree…" :rows="6" />
  </div>
</template>

<style scoped>
.usb-controller {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 14px 16px;
  margin-bottom: 12px;
}
.usb-meter {
  height: 6px;
  border-radius: 3px;
  background: var(--rr-surface-2);
  margin-top: 8px;
  max-width: 420px;
  overflow: hidden;
}
.usb-meter-fill {
  height: 100%;
  background: var(--rr-ok);
}
.usb-meter-fill.near {
  background: var(--rr-warn);
}
.usb-meter-fill.over {
  background: var(--rr-bad);
}
.usb-spare {
  padding: 12px 16px;
  margin: -4px 0 12px;
  font-size: 13px;
}
.usb-spare-row {
  display: flex;
  gap: 12px;
  padding: 2px 0;
}
.usb-spare-row a {
  color: var(--rr-accent);
  text-decoration: none;
}
.usb-tree {
  padding-bottom: 12px;
}
.usb-bar {
  position: sticky;
  top: var(--v-layout-top, 56px);
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 14px;
  /* The height of a selection, so that the first click does not move the drawing. */
  min-height: 70px;
  padding: 8px 16px;
  margin-bottom: 10px;
  background: var(--rr-surface);
  border-bottom: 1px solid var(--rr-border);
  border-radius: calc(var(--rr-radius) - 1px) calc(var(--rr-radius) - 1px) 0 0;
  font-size: 13px;
}
.usb-bar :deep(.v-label) {
  font-size: 13px;
}
.usb-picked {
  flex: 1;
  min-width: 0;
}
.usb-picked-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 10px;
}
.usb-picked-name {
  font-size: 15px;
  font-weight: 600;
}
.usb-chain {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 0;
  margin: 6px 0 0;
  padding: 0;
}
.usb-chain li {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.usb-chain li + li::before {
  content: '›';
  margin: 0 2px 0 8px;
  color: var(--rr-muted);
}
.usb-chain-port {
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  border-radius: 4px;
  background: var(--rr-surface-2);
  color: var(--rr-muted);
  font-size: 11px;
  line-height: 18px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.usb-chain-self {
  color: var(--rr-accent);
  font-weight: 500;
}
.usb-scroll {
  overflow-x: auto;
  padding: 2px 16px 6px;
}
.usb-foot {
  font-size: 12px;
  margin: 10px 16px 0;
}
</style>
