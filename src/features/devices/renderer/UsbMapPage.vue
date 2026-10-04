<script setup lang="ts">
import DeviceTabs from './DeviceTabs.vue';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import PageSkeleton from '../../../renderer/components/PageSkeleton.vue';
import { errorText, useClient } from '../../../renderer/ipc';
import { onMachineChanged } from '../../../renderer/machine';
import { devicesContract } from '../contract';
import type { UsbMap, UsbNode } from '../core/model';
import UsbTreeNode from './UsbTreeNode.vue';
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

const childrenOf = computed(() => {
  const out = new Map<string, UsbNode[]>();
  for (const node of map.value?.nodes ?? []) {
    if (!node.parentId) continue;
    const list = out.get(node.parentId) ?? [];
    list.push(node);
    out.set(node.parentId, list);
  }
  // Devices before hubs on each level, then by port.
  for (const list of out.values()) {
    list.sort(
      (a, b) =>
        (a.kind === 'device' ? 0 : 1) - (b.kind === 'device' ? 0 : 1) ||
        (a.port ?? 99) - (b.port ?? 99) ||
        a.name.localeCompare(b.name)
    );
  }
  return out;
});
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

async function reveal(): Promise<void> {
  await nextTick();
  document
    .querySelector(`[data-testid="usb-node"][data-selected="true"]`)
    ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
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

      <div class="usb-grid">
        <div class="rr-panel usb-tree" data-testid="usb-tree">
          <div class="usb-tree-bar">
            <v-switch
              v-model="hideEmpty"
              label="Hide empty hubs"
              class="flex-grow-0"
              data-testid="usb-hide-empty"
            />
          </div>
          <ul class="usb-roots">
            <UsbTreeNode
              v-for="root in roots"
              :key="root.id"
              :node="root"
              :children-of="childrenOf"
              :selected="selected"
              :hide-empty="hideEmpty"
              @select="select"
            />
          </ul>
          <p class="rr-muted usb-foot">
            Numbers are port numbers on the hub above. A USB 3 hub appears twice (once for USB 2
            devices, once for USB 3 devices), and one hub box often holds two or three hub chips.
          </p>
        </div>

        <aside class="rr-panel usb-side" data-testid="usb-selected">
          <template v-if="selectedNode">
            <div class="rr-section-title">Selected</div>
            <div class="rr-row-title usb-side-name">{{ selectedNode.name }}</div>
            <div v-if="selectedDevice?.location" class="rr-row-sub">
              {{ selectedDevice.location.text }}
            </div>
            <ol class="usb-chain">
              <li v-for="n in chain" :key="n.id">
                <span v-if="n.port !== undefined && n.kind !== 'root'" class="rr-mono rr-muted"
                  >{{ n.port }} ·</span
                >
                {{ n.name }}
              </li>
              <li class="usb-chain-self">
                <span v-if="selectedNode.port !== undefined" class="rr-mono rr-muted"
                  >{{ selectedNode.port }} ·</span
                >
                {{ selectedNode.name }}
              </li>
            </ol>
            <div class="rr-row-sub">
              {{ selectedNode.depth }} {{ selectedNode.depth === 1 ? 'hub' : 'hubs' }} between it
              and the computer
              <template v-if="selectedDevice?.requiredBy.length">
                · needed by {{ selectedDevice.requiredBy.join(', ') }}</template
              >
            </div>
            <v-btn
              class="mt-3"
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
          </template>
          <p v-else class="rr-muted">
            Click a device in the tree to see the path to it from the computer.
          </p>
        </aside>
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
.usb-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
  gap: 16px;
  align-items: start;
}
.usb-tree {
  padding: 12px 8px;
}
.usb-tree-bar {
  display: flex;
  justify-content: flex-end;
  margin: -4px 8px 4px;
  font-size: 13px;
}
.usb-roots {
  margin: 0;
  padding: 0;
}
.usb-foot {
  font-size: 12px;
  margin: 10px 8px 0;
}
.usb-side {
  padding: 14px 16px;
  position: sticky;
  top: 72px;
  font-size: 13px;
}
.usb-side-name {
  font-size: 15px;
  margin-bottom: 2px;
}
.usb-chain {
  list-style: none;
  margin: 10px 0;
  padding: 0 0 0 10px;
  border-left: 2px solid var(--rr-border);
}
.usb-chain li {
  padding: 2px 0;
}
.usb-chain-self {
  color: var(--rr-accent);
  font-weight: 500;
}
</style>
