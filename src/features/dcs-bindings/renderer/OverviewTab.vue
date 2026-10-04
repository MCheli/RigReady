<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { DEVICE_ROLES, ROLE_LABELS, type DeviceView } from '../core/model';
import { useBindingsStore } from './store';

const emit = defineEmits<{ open: [tab: string] }>();
const store = useBindingsStore();
const router = useRouter();
const view = computed(() => store.view!);

const roleItems = DEVICE_ROLES.map((role) => ({ title: ROLE_LABELS[role], value: role }));

const keyboard = computed(() => view.value.devices.find((d) => d.type === 'keyboard'));
const others = computed(() =>
  view.value.devices.filter((d) => d.type !== 'joystick' && d.type !== 'keyboard')
);
const attached = computed(() => store.controllers.filter((d) => d.connected));
const filesOnly = computed(() => store.controllers.filter((d) => !d.connected));

/** Problems that involve one device, for its row. */
function problemsOf(device: DeviceView): number {
  const p = view.value.problems;
  return (
    p.inputConflicts.filter((c) => c.deviceId === device.id).length +
    p.unwantedDefaults.filter((u) => u.deviceId === device.id).length
  );
}

const tiles = computed(() => {
  const p = view.value.problems;
  return [
    {
      id: 'conflicts',
      count: p.inputConflicts.length,
      title: 'inputs bound to several actions',
      one: 'input bound to several actions',
    },
    {
      id: 'duplicates',
      count: p.actionDuplicates.filter((d) => !d.expected).length,
      title: 'actions bound more than once',
      one: 'action bound more than once',
    },
    {
      id: 'defaults',
      count: p.unwantedDefaults.length,
      title: 'default bindings on devices that should not have them',
      one: 'default binding on a device that should not have it',
    },
    {
      id: 'important',
      count: p.importantUnbound.length,
      title: 'important actions not on any controller',
      one: 'important action not on any controller',
    },
  ];
});

const userModifiers = computed(() => view.value.modifiers.filter((m) => m.device !== 'Keyboard'));

function openDevice(device: DeviceView): void {
  void router.push({ path: '/configure/dcs-bindings/devices', query: { device: device.id } });
}

function summary(device: DeviceView): string {
  const parts: string[] = [];
  if (device.file.source === 'user') parts.push(`${device.counts.fromUser} of yours`);
  else if (device.file.source === 'template') {
    parts.push(`${device.counts.fromUser} from DCS's template for this device`);
  }
  if (device.counts.fromDefaults > 0) {
    parts.push(
      `${device.counts.fromDefaults} DCS ${device.counts.fromDefaults === 1 ? 'default' : 'defaults'}`
    );
  }
  return parts.length > 0 ? parts.join(' · ') : 'Nothing bound';
}
</script>

<template>
  <div data-testid="bind-overview">
    <v-alert
      v-for="(warning, index) in view.warnings"
      :key="index"
      type="warning"
      variant="tonal"
      class="mb-3"
      data-testid="bind-warning"
    >
      {{ warning }}
    </v-alert>

    <div class="ov-tiles">
      <button
        v-for="tile in tiles"
        :key="tile.id"
        class="rr-panel ov-tile"
        :data-testid="`ov-tile-${tile.id}`"
        :data-count="tile.count"
        @click="emit('open', 'problems')"
      >
        <div class="ov-tile-count" :class="tile.count > 0 ? 'rr-warn' : 'rr-ok'">
          {{ tile.count }}
        </div>
        <div class="ov-tile-title">{{ tile.count === 1 ? tile.one : tile.title }}</div>
      </button>
    </div>

    <div class="rr-section-title">Controllers attached now</div>
    <div class="rr-panel ov-panel">
      <div
        v-if="view.controllersUnavailable"
        class="rr-empty rr-warn"
        data-testid="ov-controllers-unavailable"
      >
        Game controllers could not be read: {{ view.controllersUnavailable }} The devices below are
        listed from their binding files only.
      </div>
      <div v-else-if="attached.length === 0" class="rr-empty" data-testid="ov-no-devices">
        No game controllers are attached.
      </div>
      <div
        v-for="device in attached"
        :key="device.id"
        class="rr-row"
        data-testid="ov-device"
        :data-device="device.name"
      >
        <div class="rr-row-main">
          <div class="rr-row-title">
            {{ device.givenName ?? device.name }}
            <span v-if="device.givenName" class="rr-muted ov-hardware">{{ device.name }}</span>
          </div>
          <div class="rr-row-sub" data-testid="ov-device-summary">
            {{ summary(device) }}
            <span v-if="problemsOf(device) > 0" class="rr-warn" data-testid="ov-device-problems">
              · {{ problemsOf(device) }} {{ problemsOf(device) === 1 ? 'problem' : 'problems' }}
            </span>
            <span v-if="device.file.error" class="rr-bad">
              · the binding file could not be read</span
            >
          </div>
        </div>
        <v-select
          class="ov-role"
          density="compact"
          :items="roleItems"
          :model-value="device.role"
          :hint="device.roleSuggested ? 'Guessed from the name' : ''"
          :aria-label="`What ${device.name} is used for`"
          data-testid="ov-role"
          @update:model-value="store.setRole(device, $event)"
        />
        <v-btn
          size="small"
          variant="tonal"
          data-testid="ov-open-device"
          @click="openDevice(device)"
        >
          Open
        </v-btn>
      </div>
    </div>

    <template v-if="filesOnly.length > 0">
      <div class="rr-section-title">Binding files for devices that are not attached</div>
      <div class="rr-panel ov-panel" data-testid="ov-files-only">
        <div
          v-for="device in filesOnly"
          :key="device.id"
          class="rr-row"
          data-testid="ov-file-device"
          :data-device="device.name"
        >
          <v-icon icon="mdi-file-outline" class="rr-muted" />
          <div class="rr-row-main">
            <div class="rr-row-title">{{ device.name }}</div>
            <div class="rr-row-sub">
              {{ device.counts.fromUser }} bindings · device ID
              <span class="rr-mono">{{ device.guid }}</span>
            </div>
          </div>
          <v-btn size="small" variant="text" @click="openDevice(device)">Open</v-btn>
        </div>
        <div class="rr-row ov-hint">
          <div class="rr-row-sub">
            If one of these devices is attached but shows up under another ID above, its bindings
            are stuck on the old ID.
          </div>
          <v-btn
            size="small"
            variant="tonal"
            data-testid="ov-to-device-ids"
            @click="emit('open', 'device-ids')"
          >
            Device IDs
          </v-btn>
        </div>
      </div>
    </template>

    <div class="rr-section-title">Keyboard and other inputs</div>
    <div class="rr-panel ov-panel">
      <div v-if="keyboard" class="rr-row" data-testid="ov-keyboard">
        <v-icon icon="mdi-keyboard-outline" class="rr-muted" />
        <div class="rr-row-main">
          <div class="rr-row-title">Keyboard</div>
          <div class="rr-row-sub">{{ summary(keyboard) }}</div>
        </div>
        <v-btn size="small" variant="text" @click="openDevice(keyboard)">Open</v-btn>
      </div>
      <div v-for="device in others" :key="device.id" class="rr-row">
        <v-icon icon="mdi-cursor-default-outline" class="rr-muted" />
        <div class="rr-row-main">
          <div class="rr-row-title">{{ device.name }}</div>
          <div class="rr-row-sub">{{ device.counts.fromUser }} of yours ({{ device.type }})</div>
        </div>
        <v-btn size="small" variant="text" @click="openDevice(device)">Open</v-btn>
      </div>
    </div>

    <template v-if="userModifiers.length > 0">
      <div class="rr-section-title">Modifiers on devices</div>
      <div class="rr-panel ov-panel" data-testid="ov-modifiers">
        <div v-for="modifier in userModifiers" :key="modifier.name" class="rr-row">
          <div class="rr-row-main">
            <div class="rr-row-title">{{ modifier.label }}</div>
            <div class="rr-row-sub">
              {{ modifier.isSwitch ? 'Switch' : 'Modifier' }} "{{ modifier.name }}"
              <span
                v-if="!modifier.deviceConnected"
                class="rr-warn"
                data-testid="ov-modifier-stale"
              >
                · points at a device ID that is not attached; the Device IDs tab fixes it
              </span>
            </div>
          </div>
        </div>
      </div>
    </template>

    <p v-if="view.uneditableCommands > 0" class="rr-row-sub ov-note" data-testid="ov-uneditable">
      {{ view.uneditableCommands }} actions of this aircraft are DCS engine commands whose internal
      number RigReady has not seen yet (mostly general and view commands used from the keyboard).
      They are listed with their names, but cannot be bound from here until one of your binding
      files, or one of DCS's templates, uses them: bind one once in DCS and RigReady learns it.
    </p>
  </div>
</template>

<style scoped>
.ov-hardware {
  font-weight: 400;
  font-size: 12.5px;
  margin-left: 6px;
}
.ov-tiles {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 24px;
}
.ov-tile {
  text-align: left;
  padding: 14px 16px;
  cursor: pointer;
  color: inherit;
  font: inherit;
}
.ov-tile:hover {
  background: var(--rr-surface-2);
}
.ov-tile-count {
  font-size: 26px;
  font-weight: 600;
  line-height: 1.1;
}
.ov-tile-title {
  font-size: 12.5px;
  color: var(--rr-muted);
  margin-top: 4px;
}
.ov-panel {
  margin-bottom: 24px;
}
.ov-role {
  flex: 0 0 210px;
}
.ov-hint {
  justify-content: space-between;
}
.ov-note {
  max-width: 820px;
}
</style>
