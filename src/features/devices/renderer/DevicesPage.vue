<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { onMachineChanged } from '../../../renderer/machine';
import type { InputState } from '../../../shared/models';
import { detectIdentify } from '../core/input';
import type { NotificationMode, RigDevice } from '../core/model';
import DeviceRow from './DeviceRow.vue';
import { useDevicesStore, useInputStore } from './store';

const store = useDevicesStore();
const input = useInputStore();
const route = useRoute();

const expanded = ref<string>();
const highlighted = ref<string>();
const renameKey = ref<string>();
const showOthers = ref(false);
const notifyError = ref<string>();

const devices = computed(() => store.overview?.devices ?? []);
const controllers = computed(() => devices.value.filter((d) => d.kind === 'controller'));
const others = computed(() => devices.value.filter((d) => d.kind === 'other'));
const missing = computed(() => store.overview?.missing ?? []);
const hidHide = computed(() => store.overview?.hidHide);
const hiddenCount = computed(() => devices.value.filter((d) => d.hidden).length);

// ---- Find a device: press anything ----
const identifying = ref(false);
const found = ref<{ key?: string; name: string; input: string }>();
let stopListening: (() => void) | undefined;
let baseline = new Map<number, InputState>();

async function startIdentify(): Promise<void> {
  found.value = undefined;
  identifying.value = true;
  await input.acquire();
  baseline = new Map(input.states);
  stopListening = input.onInput((state, previous) => {
    if (!baseline.has(state.index)) {
      // First time this controller reports: that is where it rests, not a press.
      baseline.set(state.index, previous ?? state);
      if (!previous) return;
    }
    const hit = detectIdentify(input.deviceFor(state.index), baseline.get(state.index), state);
    if (hit) void identified(hit.index, hit.input);
  });
}

async function stopIdentify(): Promise<void> {
  if (!identifying.value) return;
  identifying.value = false;
  stopListening?.();
  stopListening = undefined;
  await input.release();
}

async function identified(index: number, what: string): Promise<void> {
  await stopIdentify();
  const device = store.deviceOfController(index);
  const controller = input.deviceFor(index);
  found.value = {
    ...(device ? { key: device.key } : {}),
    name: device?.name ?? controller?.name.trim() ?? `Controller ${index + 1}`,
    input: what,
  };
  if (device) {
    if (device.kind === 'other') showOthers.value = true;
    await focus(device.key, !device.controllersShared);
  }
}

async function focus(key: string, rename = false): Promise<void> {
  expanded.value = key;
  highlighted.value = key;
  renameKey.value = rename ? key : undefined;
  await nextTick();
  document
    .querySelector(`[data-testid="device-row"][data-key="${CSS.escape(key)}"]`)
    ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function toggle(device: RigDevice): void {
  renameKey.value = undefined;
  expanded.value = expanded.value === device.key ? undefined : device.key;
  if (highlighted.value !== device.key) highlighted.value = undefined;
}

// ---- notifications ----
const notifyOptions: { value: NotificationMode; title: string; sub: string }[] = [
  {
    value: 'controllers',
    title: 'Game controllers',
    sub: 'Sticks, throttles, pedals, panels, wheels, and anything a setup needs',
  },
  {
    value: 'required',
    title: 'Only what the current setup needs',
    sub: 'The devices on the checklist of the setup you used last',
  },
  { value: 'all', title: 'Every USB device', sub: 'Keyboards, mice, headsets and the rest too' },
  { value: 'off', title: 'Off', sub: 'No notifications about devices' },
];
async function setMode(mode: NotificationMode | null): Promise<void> {
  if (!mode) return;
  notifyError.value = await store.setNotifications(mode);
}

let off: (() => void) | undefined;
onMounted(async () => {
  input.setNamer((d) => store.controllerName(d));
  off = onMachineChanged(() => void store.load());
  await store.load();
  const select = route.query['select'];
  if (typeof select === 'string' && devices.value.some((d) => d.key === select)) {
    const target = devices.value.find((d) => d.key === select)!;
    if (target.kind === 'other') showOthers.value = true;
    await focus(select);
  }
});
onBeforeUnmount(() => {
  off?.();
  void stopIdentify();
});
watch(
  () => route.query['select'],
  (select) => {
    if (typeof select === 'string') void focus(select);
  }
);
</script>

<template>
  <div data-testid="devices-page">
    <div class="d-flex align-start mb-2">
      <div>
        <h1 class="rr-page-title">Devices</h1>
        <p class="rr-page-sub">
          Everything plugged in, as RigReady recognises it. Not sure which is which? Find it by
          pressing a button on it.
        </p>
      </div>
      <v-spacer />
      <div class="d-flex ga-2">
        <v-btn
          v-if="!identifying"
          color="primary"
          prepend-icon="mdi-gesture-tap"
          data-testid="devices-identify"
          @click="startIdentify"
          >Find a device</v-btn
        >
        <v-btn
          variant="tonal"
          prepend-icon="mdi-refresh"
          data-testid="devices-refresh"
          :loading="store.loading"
          @click="store.load()"
          >Refresh</v-btn
        >
      </div>
    </div>

    <div
      v-if="identifying"
      class="rr-panel identify"
      data-testid="identify-banner"
      :data-listening="input.watching"
    >
      <span class="identify-pulse" />
      <div class="rr-row-main">
        <div class="rr-row-title">
          Press any button or move any control on the device you want to find
        </div>
        <div class="rr-row-sub">
          {{
            input.error
              ? input.error
              : 'Listening to every game controller. Small wobbles of an axis are ignored.'
          }}
        </div>
      </div>
      <v-btn variant="text" data-testid="identify-cancel" @click="stopIdentify">Cancel</v-btn>
    </div>

    <div v-else-if="found" class="rr-panel identify found" data-testid="identify-found">
      <v-icon icon="mdi-target" color="primary" />
      <div class="rr-row-main">
        <div class="rr-row-title">That was {{ found.name }}</div>
        <div class="rr-row-sub">
          {{ found.input }}.
          <template v-if="found.key"
            >It is highlighted below{{
              renameKey ? ': give it a name you will recognise.' : '.'
            }}</template
          >
          <template v-else>It is a controller RigReady has no USB device for.</template>
        </div>
      </div>
      <v-btn variant="text" @click="startIdentify">Find another</v-btn>
      <v-btn
        variant="text"
        icon="mdi-close"
        size="small"
        aria-label="Dismiss"
        @click="found = undefined"
      />
    </div>

    <v-alert
      v-if="store.error"
      type="error"
      variant="tonal"
      class="mb-4"
      data-testid="devices-error"
      >{{ store.error }}</v-alert
    >
    <v-alert
      v-if="store.overview?.inputError && !store.overview.inputPending"
      type="info"
      variant="tonal"
      density="compact"
      class="mb-4"
    >
      Game controller details are not available: {{ store.overview.inputError }}
    </v-alert>
    <v-alert
      v-if="hidHide?.state === 'ok' && hidHide.cloak && hiddenCount > 0"
      type="warning"
      variant="tonal"
      class="mb-4"
      data-testid="hidhide-warning"
    >
      HidHide is hiding
      {{ hiddenCount === 1 ? 'a connected device' : `${hiddenCount} connected devices` }} from
      programs that are not on its allow list. Games that are not on the list do not see
      {{ hiddenCount === 1 ? 'it' : 'them' }}.
    </v-alert>

    <template v-if="store.overview">
      <section class="mb-6">
        <h2 class="rr-section-title">Game controllers · {{ controllers.length }}</h2>
        <div class="rr-panel" data-testid="devices-controllers">
          <DeviceRow
            v-for="device in controllers"
            :key="device.key"
            :device="device"
            :expanded="expanded === device.key"
            :highlighted="highlighted === device.key"
            :rename-now="renameKey === device.key"
            :hid-hide-installed="hidHide?.state === 'ok'"
            @toggle="toggle(device)"
            @renamed="renameKey = undefined"
          />
          <div v-if="controllers.length === 0" class="rr-empty">
            No game controllers are connected. Plug in a stick, wheel or panel and it appears here.
          </div>
        </div>
      </section>

      <section v-if="missing.length" class="mb-6">
        <h2 class="rr-section-title">Needed by a setup, not connected · {{ missing.length }}</h2>
        <div class="rr-panel" data-testid="devices-missing">
          <div
            v-for="m in missing"
            :key="JSON.stringify(m.identity)"
            class="rr-row"
            data-testid="missing-row"
            :data-name="m.title"
          >
            <v-icon icon="mdi-usb-port" class="rr-bad" />
            <div class="rr-row-main">
              <div class="rr-row-title">{{ m.title }}</div>
              <div class="rr-row-sub">
                Needed by {{ m.profiles.join(', ') }} ·
                <template v-if="m.lastSeen"
                  >last seen {{ m.lastSeen }},
                  {{ m.lastLocation?.replace(/^./, (c) => c.toLowerCase()) }} (USB path
                  {{ m.lastPath }})</template
                >
                <template v-else>RigReady has not seen it plugged in yet</template>
              </div>
              <div
                v-if="m.otherUnit && (m.identity.serial || m.identity.instanceId)"
                class="rr-row-sub"
              >
                Another unit of the same model is connected, but not this one.
              </div>
            </div>
            <span class="rr-mono rr-muted"
              >{{ m.identity.vendorId.toUpperCase() }}:{{
                m.identity.productId.toUpperCase()
              }}</span
            >
          </div>
        </div>
      </section>

      <section class="mb-6">
        <div class="d-flex align-center">
          <h2 class="rr-section-title">Other USB devices · {{ others.length }}</h2>
          <v-spacer />
          <v-btn
            size="small"
            variant="text"
            data-testid="devices-toggle-others"
            @click="showOthers = !showOthers"
            >{{ showOthers ? 'Hide' : 'Show' }}</v-btn
          >
        </div>
        <div v-if="showOthers" class="rr-panel" data-testid="devices-others">
          <DeviceRow
            v-for="device in others"
            :key="device.key"
            :device="device"
            :expanded="expanded === device.key"
            :highlighted="highlighted === device.key"
            :rename-now="renameKey === device.key"
            :hid-hide-installed="hidHide?.state === 'ok'"
            @toggle="toggle(device)"
            @renamed="renameKey = undefined"
          />
          <div v-if="others.length === 0" class="rr-empty">Nothing else is plugged in.</div>
        </div>
        <p v-else class="rr-muted devices-collapsed">
          Keyboards, mice, headsets, screens and the like. Hubs are on the USB map.
        </p>
      </section>

      <div class="devices-columns">
        <section>
          <h2 class="rr-section-title">HidHide</h2>
          <div class="rr-panel devices-panel" data-testid="devices-hidhide">
            <template v-if="hidHide?.state === 'notInstalled'">
              <p class="rr-muted">HidHide is not installed, so nothing hides devices from games.</p>
            </template>
            <template v-else-if="hidHide?.state === 'error'">
              <p class="rr-warn">
                HidHide is installed but could not be asked: {{ hidHide.message }}
              </p>
            </template>
            <template v-else-if="hidHide?.state === 'ok'">
              <p>
                Cloaking is <strong>{{ hidHide.cloak ? 'on' : 'off' }}</strong
                >{{
                  hidHide.inverse
                    ? ' (inverse mode: listed programs are the ones that cannot see hidden devices)'
                    : ''
                }}.
                <template v-if="!hidHide.cloak">
                  Devices on its list are visible to every program.</template
                >
                {{ hidHide.hiddenCount === 0 ? 'No connected device is on the hidden list.' : '' }}
              </p>
              <div
                v-for="p in hidHide.programs"
                :key="p.exe"
                class="hid-program"
                data-testid="hidhide-program"
                :data-label="p.label"
              >
                <v-icon
                  :icon="p.seesHidden ? 'mdi-eye-outline' : 'mdi-eye-off-outline'"
                  size="16"
                  :class="
                    p.seesHidden || !hidHide.cloak || hidHide.hiddenCount === 0
                      ? 'rr-muted'
                      : 'rr-warn'
                  "
                />
                <span>{{ p.label }}</span>
                <span class="rr-muted">{{
                  p.onList ? 'on the allow list' : 'not on the allow list'
                }}</span>
              </div>
              <p class="rr-muted hid-foot">
                RigReady only reads HidHide. Change it in HidHide Configuration Client.
              </p>
            </template>
          </div>
        </section>
        <section>
          <h2 class="rr-section-title">Notifications</h2>
          <div class="rr-panel devices-panel" data-testid="devices-notifications">
            <p class="mb-2">
              While RigReady is in the tray, tell me when these are plugged in or unplugged:
            </p>
            <v-radio-group
              :model-value="store.overview.notifications"
              density="compact"
              hide-details
              data-testid="notify-mode"
              @update:model-value="setMode"
            >
              <v-radio
                v-for="o in notifyOptions"
                :key="o.value"
                :value="o.value"
                :data-testid="`notify-${o.value}`"
              >
                <template #label>
                  <div>
                    <div>{{ o.title }}</div>
                    <div class="rr-row-sub">{{ o.sub }}</div>
                  </div>
                </template>
              </v-radio>
            </v-radio-group>
            <p v-if="notifyError" class="rr-bad">{{ notifyError }}</p>
          </div>
        </section>
      </div>
    </template>
    <div v-else-if="!store.error" class="rr-empty">Looking at what is plugged in…</div>
  </div>
</template>

<style scoped>
.identify {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 16px;
  margin-bottom: 16px;
  border-color: color-mix(in srgb, var(--rr-accent) 55%, transparent);
}
.identify-pulse {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--rr-accent);
  animation: pulse 1.4s ease-out infinite;
  flex-shrink: 0;
}
@keyframes pulse {
  0% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--rr-accent) 60%, transparent);
  }
  100% {
    box-shadow: 0 0 0 12px transparent;
  }
}
.devices-collapsed {
  font-size: 13px;
  margin: 0;
}
.devices-columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}
.devices-panel {
  padding: 14px 16px;
  font-size: 13.5px;
}
.devices-panel p {
  margin: 0 0 8px;
}
.hid-program {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 0;
}
.hid-foot {
  font-size: 12px;
  margin-top: 10px !important;
}
</style>
