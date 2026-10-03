<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import type { RigDevice } from '../core/model';
import { useDevicesStore } from './store';

const props = defineProps<{
  device: RigDevice;
  expanded: boolean;
  highlighted: boolean;
  /** Start renaming as soon as the row opens (after "Find a device"). */
  renameNow: boolean;
  hidHideInstalled: boolean;
}>();
const emit = defineEmits<{ toggle: []; renamed: [] }>();
const store = useDevicesStore();
const router = useRouter();

const editing = ref(false);
const draft = ref('');
const saving = ref(false);
const renameError = ref<string>();
const field = ref<{ focus(): void } | null>(null);

const icon = computed(() => {
  if (props.device.kind !== 'controller') return 'mdi-usb-port';
  const name = props.device.productName.toLowerCase();
  if (/wheel|dd2|base dd/.test(name)) return 'mdi-steering';
  if (/rudder|pedal/.test(name)) return 'mdi-shoe-print';
  if (/throttle/.test(name)) return 'mdi-tune-vertical-variant';
  if (/joystick|stick|grip/.test(name)) return 'mdi-controller-classic-outline';
  return 'mdi-gamepad-square-outline';
});

const identifiedBy = computed(() => {
  switch (props.device.identifiedBy) {
    case 'serial':
      return 'Serial number (there are identical devices)';
    case 'port':
      return 'USB port: identical devices without a usable serial number. Moving it to another port changes its identity.';
    case 'guid':
      return 'DirectInput instance GUID (no USB device of its own: virtual or wireless)';
    default:
      return 'Vendor and product ID';
  }
});

const inputCounts = (c: RigDevice['controllers'][number]): string =>
  [
    `${c.numAxes} ${c.numAxes === 1 ? 'axis' : 'axes'}`,
    `${c.numButtons} ${c.numButtons === 1 ? 'button' : 'buttons'}`,
    ...(c.numHats ? [`${c.numHats} ${c.numHats === 1 ? 'hat' : 'hats'}`] : []),
  ].join(' · ');

async function startRename(): Promise<void> {
  draft.value = props.device.givenName ?? '';
  renameError.value = undefined;
  editing.value = true;
  await nextTick();
  field.value?.focus();
}

async function save(): Promise<void> {
  saving.value = true;
  renameError.value = await store.rename(props.device.key, draft.value);
  saving.value = false;
  if (!renameError.value) {
    editing.value = false;
    emit('renamed');
  }
}

watch(
  () => [props.expanded, props.renameNow] as const,
  ([open, now]) => {
    if (open && now) void startRename();
    if (!open) editing.value = false;
  },
  { immediate: true }
);

function test(): void {
  const first = props.device.controllers[0];
  void router.push({
    path: '/configure/devices/test',
    query: first ? { controller: String(first.index) } : {},
  });
}
</script>

<template>
  <div
    class="device"
    :class="{ open: expanded, highlighted }"
    data-testid="device-row"
    :data-key="device.key"
    :data-name="device.name"
  >
    <button class="device-head" type="button" :aria-expanded="expanded" @click="emit('toggle')">
      <v-icon :icon="icon" class="device-icon" />
      <div class="rr-row-main">
        <div class="rr-row-title">
          {{ device.name }}
          <span v-if="device.givenName" class="rr-muted device-product">{{
            device.productName
          }}</span>
        </div>
        <div class="rr-row-sub">
          <template v-if="device.location"
            >{{ device.location.text }}
            <span
              class="rr-mono device-path"
              title="Port numbers from the computer to the device"
              >{{ device.location.path }}</span
            >
            ·
          </template>
          <span class="rr-mono">{{ device.vendorId }}:{{ device.productId }}</span>
          <template v-if="device.controllers.length > 1 && !device.controllersShared">
            · {{ device.controllers.length }} game controllers in Windows
          </template>
        </div>
      </div>
      <span v-if="device.hidden" class="device-chip warn" data-testid="device-hidden-badge">
        <v-icon icon="mdi-eye-off-outline" size="14" /> Hidden by HidHide
      </span>
      <span v-if="device.twins > 1" class="device-chip" :title="identifiedBy">
        {{ device.twins }} identical ·
        {{ device.identifiedBy === 'port' ? 'told apart by USB port' : 'told apart by serial' }}
      </span>
      <span
        v-if="device.requiredBy.length"
        class="device-chip"
        :title="device.requiredBy.join(', ')"
      >
        Needed by
        {{
          device.requiredBy.length === 1
            ? device.requiredBy[0]
            : `${device.requiredBy.length} setups`
        }}
      </span>
      <v-icon :icon="expanded ? 'mdi-chevron-up' : 'mdi-chevron-down'" class="rr-muted" size="20" />
    </button>

    <div v-if="expanded" class="device-detail" data-testid="device-detail">
      <div v-if="editing" class="device-rename">
        <v-text-field
          ref="field"
          v-model="draft"
          label="Name"
          :placeholder="device.productName"
          maxlength="80"
          data-testid="device-name-input"
          :error-messages="renameError"
          @keydown.enter="save"
          @keydown.esc="editing = false"
        />
        <v-btn color="primary" :loading="saving" data-testid="device-name-save" @click="save"
          >Save</v-btn
        >
        <v-btn variant="text" @click="editing = false">Cancel</v-btn>
      </div>
      <p v-if="editing" class="rr-muted device-hint">
        The name is shown everywhere in RigReady. Leave it empty to use the name the device reports.
      </p>

      <dl class="device-fields">
        <dt>Name</dt>
        <dd>
          {{ device.givenName ?? 'Not named yet' }}
          <v-btn
            v-if="!editing"
            size="small"
            variant="text"
            prepend-icon="mdi-pencil-outline"
            data-testid="device-rename"
            @click="startRename"
            >{{ device.givenName ? 'Rename' : 'Name it' }}</v-btn
          >
        </dd>
        <dt>Reports itself as</dt>
        <dd>
          {{ device.productName
          }}<span
            v-if="device.manufacturer && !device.manufacturer.startsWith('(')"
            class="rr-muted"
          >
            · {{ device.manufacturer }}</span
          >
        </dd>
        <dt>Vendor : product</dt>
        <dd class="rr-mono">{{ device.vendorId }}:{{ device.productId }}</dd>
        <template v-if="device.instanceId">
          <dt>Serial number</dt>
          <dd :class="{ 'rr-mono': device.serial }">{{ device.serial ?? 'none' }}</dd>
        </template>
        <dt>Recognised by</dt>
        <dd>{{ identifiedBy }}</dd>
        <template v-if="device.instanceId">
          <dt>Instance path</dt>
          <dd class="rr-mono">{{ device.instanceId }}</dd>
        </template>
        <template v-if="device.location">
          <dt>Plugged into</dt>
          <dd>
            {{ device.location.text }}
            <span class="rr-muted"
              >· USB path {{ device.location.path }} · {{ device.location.depth }}
              {{ device.location.depth === 1 ? 'hub' : 'hubs' }} deep</span
            >
            <div v-if="device.location.depth >= 4" class="rr-warn">
              {{
                device.location.depth >= 5
                  ? 'At the USB limit of five hubs: it may stop working. Plug it in closer to the computer.'
                  : 'Four hubs deep, one short of the USB limit. Plugging it in closer to the computer is safer.'
              }}
            </div>
          </dd>
        </template>
        <dt>Game controllers</dt>
        <dd>
          <div v-if="device.controllers.length === 0" class="rr-muted">
            {{
              device.kind === 'controller'
                ? 'Not listed by DirectInput right now'
                : 'None: games do not see this device as a controller'
            }}
          </div>
          <div
            v-for="c in device.controllers"
            :key="c.guid"
            class="device-controller"
            data-testid="device-controller"
          >
            <span>{{ inputCounts(c) }}</span>
            <span class="rr-mono rr-muted">{{ c.guid }}</span>
          </div>
          <div
            v-if="device.controllers.length > 1 && !device.controllersShared"
            class="rr-muted device-note"
          >
            Windows lists this device as {{ device.controllers.length }} game controllers with the
            same name. That is how it is built, not a duplicate.
          </div>
          <div v-if="device.controllersShared" class="rr-muted device-note">
            There are {{ device.twins }} identical devices, so RigReady cannot tell which of these
            controllers is this one. Use <strong>Find a device</strong> and press a button on it.
          </div>
        </dd>
        <dt>Needed by</dt>
        <dd>{{ device.requiredBy.length ? device.requiredBy.join(', ') : 'No setup needs it' }}</dd>
        <template v-if="hidHideInstalled">
          <dt>HidHide</dt>
          <dd :class="{ 'rr-warn': device.hidden }">
            {{
              device.hidden
                ? 'On the hidden list: programs not allowed by HidHide cannot see it'
                : 'Not hidden'
            }}
          </dd>
        </template>
      </dl>

      <div class="device-actions">
        <v-btn
          v-if="device.controllers.length"
          variant="tonal"
          prepend-icon="mdi-gesture-tap-button"
          data-testid="device-test"
          @click="test"
          >Test inputs</v-btn
        >
        <v-btn
          v-if="device.instanceId"
          variant="tonal"
          prepend-icon="mdi-family-tree"
          data-testid="device-show-usb"
          @click="router.push({ path: '/configure/devices/usb', query: { select: device.key } })"
          >Show on USB map</v-btn
        >
      </div>
    </div>
  </div>
</template>

<style scoped>
.device {
  border-top: 1px solid var(--rr-border);
  transition: background 0.2s;
}
.device:first-child {
  border-top: none;
}
.device.open {
  background: color-mix(in srgb, var(--rr-surface-2) 60%, transparent);
}
.device.highlighted {
  box-shadow: inset 3px 0 0 var(--rr-accent);
  background: color-mix(in srgb, var(--rr-accent) 12%, var(--rr-surface));
}
.device-head {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 16px;
  text-align: left;
  color: inherit;
  background: none;
  border: none;
  cursor: pointer;
}
.device-icon {
  color: var(--rr-muted);
}
.device.highlighted .device-icon {
  color: var(--rr-accent);
}
.device-product {
  font-weight: 400;
  font-size: 12.5px;
  margin-left: 6px;
}
.device-path {
  font-size: 10.5px;
  margin-left: 4px;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--rr-surface-2);
}
.device-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11.5px;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--rr-border);
  color: var(--rr-muted);
  white-space: nowrap;
}
.device-chip.warn {
  color: var(--rr-warn);
  border-color: color-mix(in srgb, var(--rr-warn) 45%, transparent);
}
.device-detail {
  padding: 4px 16px 16px 52px;
}
.device-rename {
  display: flex;
  gap: 8px;
  align-items: center;
  max-width: 560px;
  margin-bottom: 4px;
}
.device-hint {
  font-size: 12px;
  margin: 0 0 10px;
}
.device-fields {
  display: grid;
  grid-template-columns: 150px 1fr;
  gap: 6px 16px;
  font-size: 13px;
  margin: 8px 0 14px;
}
.device-fields dt {
  color: var(--rr-muted);
}
.device-fields dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.device-controller {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
}
.device-note {
  font-size: 12px;
  margin-top: 4px;
}
.device-actions {
  display: flex;
  gap: 8px;
}
</style>
