<script setup lang="ts">
import DeviceTabs from './DeviceTabs.vue';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { onMachineChanged } from '../../../renderer/machine';
import type { InputState } from '../../../shared/models';
import { detectIdentify } from '../core/input';
import type { DeviceIdentity } from '../core/identity';
import type { MissingDevice, RigDevice } from '../core/model';
import DeviceRow from './DeviceRow.vue';
import NotificationSettings from './NotificationSettings.vue';
import { useDevicesStore, useInputStore } from './store';

const store = useDevicesStore();
const input = useInputStore();
const route = useRoute();

const expanded = ref<string>();
const highlighted = ref<string>();
const renameKey = ref<string>();
const showOthers = ref(false);

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

// ---- devices a setup needs that are not connected ----
const identityKey = (identity: DeviceIdentity): string =>
  [
    identity.vendorId.toUpperCase(),
    identity.productId.toUpperCase(),
    identity.serial ?? '',
    (identity.instanceId ?? '').toUpperCase(),
  ].join('|');
const openMissing = ref<string>();
const highlightedMissing = ref<string>();
function toggleMissing(m: MissingDevice): void {
  const key = identityKey(m.identity);
  openMissing.value = openMissing.value === key ? undefined : key;
  if (highlightedMissing.value !== key) highlightedMissing.value = undefined;
}
const recognisedBy = (identity: DeviceIdentity): string =>
  identity.serial !== undefined
    ? 'Vendor and product ID, and its serial number'
    : identity.instanceId !== undefined
      ? 'Vendor and product ID, and the USB port it was on when the setup was captured'
      : 'Vendor and product ID';

// ---- "Diagnose" on the Fly screen: open the device a checklist item is about ----
const diagnosis = ref<{ title: string; profile: string; found: boolean } | { error: string }>();
async function diagnose(profileId: string, itemId: string): Promise<void> {
  const result = await store.forCheck(profileId, itemId);
  if (!result.ok) {
    diagnosis.value = { error: result.message };
    return;
  }
  const device = devices.value.find((d) => result.keys.includes(d.key));
  diagnosis.value = { title: result.title, profile: result.profile, found: device !== undefined };
  if (device) {
    if (device.kind === 'other') showOthers.value = true;
    await focus(device.key);
    return;
  }
  const key = identityKey(result.identity);
  // The same model, when the setup asks for more of them than are here.
  const row =
    missing.value.find((m) => identityKey(m.identity) === key) ??
    missing.value.find(
      (m) =>
        m.identity.vendorId.toUpperCase() === result.identity.vendorId.toUpperCase() &&
        m.identity.productId.toUpperCase() === result.identity.productId.toUpperCase()
    );
  if (!row) return;
  openMissing.value = identityKey(row.identity);
  highlightedMissing.value = openMissing.value;
  await nextTick();
  document
    .querySelector('[data-testid="missing-row"][data-open="true"]')
    ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}
/** The route's own words are checked before use: ids of a setup and one of its items. */
function diagnoseFromRoute(): void {
  const { profile, item } = route.query;
  if (typeof profile !== 'string' || typeof item !== 'string') return;
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(profile) || item.length === 0 || item.length > 200) {
    diagnosis.value = { error: 'That link does not name a checklist item.' };
    return;
  }
  void diagnose(profile, item);
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
  diagnoseFromRoute();
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
watch(
  () => [route.query['profile'], route.query['item']],
  () => diagnoseFromRoute()
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
    <DeviceTabs />

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
      v-if="diagnosis"
      :type="'error' in diagnosis ? 'warning' : 'info'"
      variant="tonal"
      density="compact"
      class="mb-4"
      closable
      data-testid="devices-diagnosis"
      @click:close="diagnosis = undefined"
    >
      <template v-if="'error' in diagnosis">{{ diagnosis.error }}</template>
      <template v-else-if="diagnosis.found">
        "{{ diagnosis.title }}" on the checklist of {{ diagnosis.profile }} is this device. It is
        connected: its details are open below.
      </template>
      <template v-else>
        "{{ diagnosis.title }}" on the checklist of {{ diagnosis.profile }} is not connected. What
        RigReady knows about it is open below.
      </template>
    </v-alert>
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
            class="missing"
            :class="{ highlighted: highlightedMissing === identityKey(m.identity) }"
            data-testid="missing-row"
            :data-name="m.title"
            :data-open="openMissing === identityKey(m.identity)"
          >
            <button
              type="button"
              class="rr-row missing-head"
              :aria-expanded="openMissing === identityKey(m.identity)"
              @click="toggleMissing(m)"
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
              <v-icon
                :icon="
                  openMissing === identityKey(m.identity) ? 'mdi-chevron-up' : 'mdi-chevron-down'
                "
                class="rr-muted"
                size="20"
              />
            </button>
            <div
              v-if="openMissing === identityKey(m.identity)"
              class="missing-detail"
              data-testid="missing-detail"
            >
              <dl class="missing-fields">
                <dt>Status</dt>
                <dd class="rr-bad">Not connected</dd>
                <dt>Needed by</dt>
                <dd>{{ m.profiles.join(', ') }}</dd>
                <dt>Vendor : product</dt>
                <dd class="rr-mono">
                  {{ m.identity.vendorId.toUpperCase() }}:{{ m.identity.productId.toUpperCase() }}
                </dd>
                <template v-if="m.identity.serial">
                  <dt>Serial number</dt>
                  <dd class="rr-mono">{{ m.identity.serial }}</dd>
                </template>
                <template v-if="m.identity.instanceId">
                  <dt>Instance path</dt>
                  <dd class="rr-mono">{{ m.identity.instanceId }}</dd>
                </template>
                <dt>Recognised by</dt>
                <dd>{{ recognisedBy(m.identity) }}</dd>
                <dt>Last plugged into</dt>
                <dd v-if="m.lastSeen">
                  {{ m.lastLocation }}
                  <span class="rr-muted">· USB path {{ m.lastPath }} · {{ m.lastSeen }}</span>
                </dd>
                <dd v-else class="rr-muted">RigReady has not seen it plugged in yet</dd>
              </dl>
              <p class="missing-steps">
                <template v-if="m.otherUnit && m.identity.instanceId">
                  A device of this model is connected on another USB port. This setup recognises it
                  by port, so plug it back into the port above, or capture the setup again with it
                  where it is now.
                </template>
                <template v-else-if="m.otherUnit && m.identity.serial">
                  A device of this model is connected, with another serial number. This setup needs
                  the unit with the serial number above.
                </template>
                <template v-else>
                  Check the cable at both ends and that the device and its hub have power. It
                  appears here within a couple of seconds of being plugged in. If it stays away, the
                  USB map shows whether its hub is still there.
                </template>
              </p>
              <div class="d-flex ga-2">
                <v-btn
                  variant="tonal"
                  prepend-icon="mdi-family-tree"
                  to="/configure/devices/usb"
                  data-testid="missing-show-usb"
                  >Open the USB map</v-btn
                >
              </div>
            </div>
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
          <div class="rr-panel"><NotificationSettings /></div>
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
.missing {
  border-top: 1px solid var(--rr-border);
}
.missing:first-child {
  border-top: none;
}
.missing.highlighted {
  box-shadow: inset 3px 0 0 var(--rr-accent);
  background: color-mix(in srgb, var(--rr-accent) 12%, var(--rr-surface));
}
.missing-head {
  width: 100%;
  text-align: left;
  color: inherit;
  background: none;
  border: none;
  cursor: pointer;
}
.missing-detail {
  padding: 4px 16px 16px 52px;
  font-size: 13px;
}
.missing-fields {
  display: grid;
  grid-template-columns: 150px 1fr;
  gap: 6px 16px;
  margin: 8px 0 12px;
}
.missing-fields dt {
  color: var(--rr-muted);
}
.missing-fields dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.missing-steps {
  margin: 0 0 12px;
  max-width: 720px;
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
