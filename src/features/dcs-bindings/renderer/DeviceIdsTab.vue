<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { errorText } from '../../../renderer/ipc';
import type { Mapping, MigrationScan, Orphan } from '../core/model';
import { useBindingsStore } from './store';

/**
 * Device ID migration: binding files that sit under an ID no attached device has, and
 * where they should go. One possible device: proposed. Several: the user says which,
 * by pressing a button on it. Nothing is renamed before the preview is confirmed.
 */
const store = useBindingsStore();
const scan = ref<MigrationScan>();
const error = ref<string>();
/** Per orphan id: the chosen target GUID ('' = leave alone) and what to do on a collision. */
const choice = ref<Record<string, { toGuid: string; onConflict: Mapping['onConflict'] }>>({});
const identifying = ref<string>();
const identifyNote = ref<string>();
let off: (() => void) | undefined;

async function load(): Promise<void> {
  const result = await store.api.migrationScan();
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  error.value = undefined;
  scan.value = result.value;
  const next: typeof choice.value = {};
  for (const orphan of result.value.orphans) {
    const before = choice.value[orphan.id];
    const stillValid = before && orphan.candidates.some((c) => c.guid === before.toGuid);
    next[orphan.id] = {
      toGuid: stillValid ? before.toGuid : (orphan.proposed ?? ''),
      onConflict: before?.onConflict ?? 'keep',
    };
  }
  choice.value = next;
}

const movable = computed(() => scan.value?.orphans.filter((o) => o.status !== 'unplugged') ?? []);
const unplugged = computed(() => scan.value?.orphans.filter((o) => o.status === 'unplugged') ?? []);
const mappings = computed<Mapping[]>(() =>
  movable.value
    .filter((o) => choice.value[o.id]?.toGuid)
    .map((o) => ({
      from: o.id,
      toGuid: choice.value[o.id]!.toGuid,
      onConflict: choice.value[o.id]!.onConflict,
    }))
);

const candidateItems = (orphan: Orphan) => [
  { title: 'Leave these bindings where they are', value: '' },
  ...orphan.candidates.map((c) => ({
    // The owner's name first: it is what tells devices with one name apart.
    title: c.givenName ? `${c.givenName} · ${c.name} · ${c.guid}` : `${c.name} · ${c.guid}`,
    value: c.guid,
  })),
];

/** The owner's name of the device the bindings would move to. */
const chosenName = (orphan: Orphan): string | undefined =>
  orphan.candidates.find((c) => c.guid === choice.value[orphan.id]?.toGuid)?.givenName;

const CONFLICT_ITEMS = [
  { title: 'Keep the file that is there', value: 'keep' },
  { title: 'Add the old bindings to it where they do not clash', value: 'merge' },
  { title: 'Replace it with the old bindings', value: 'replace' },
];

function collides(orphan: Orphan): boolean {
  const guid = choice.value[orphan.id]?.toGuid;
  return orphan.candidates.some((c) => c.guid === guid && c.ownFiles > 0);
}

function folders(orphan: Orphan): string {
  const names = [...new Set(orphan.files.map((f) => f.folder))];
  const files = `${orphan.files.length} ${orphan.files.length === 1 ? 'file' : 'files'}`;
  const where =
    names.length <= 3
      ? names.join(', ')
      : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
  const refs =
    orphan.references.length > 0
      ? ` · also named in ${orphan.references.length} modifier or settings ${orphan.references.length === 1 ? 'file' : 'files'}`
      : '';
  return orphan.files.length > 0
    ? `${files} in ${where}${refs}`
    : refs.replace(/^ · also /, 'Only ');
}

async function stopIdentify(): Promise<void> {
  off?.();
  off = undefined;
  if (identifying.value !== undefined) {
    identifying.value = undefined;
    await store.api.listenStop();
  }
}

/** "Press a button on the device these bindings belong to." */
async function identify(orphan: Orphan): Promise<void> {
  await stopIdentify();
  identifyNote.value = undefined;
  const started = await store.api.listenStart();
  if (!started.ok) {
    error.value = errorText(started.error);
    return;
  }
  identifying.value = orphan.id;
  off = store.api.on('pressed', (pressed) => {
    const candidate = orphan.candidates.find(
      (c) => c.guid.toUpperCase() === pressed.guid.toUpperCase()
    );
    if (!candidate) {
      identifyNote.value = `That was ${pressed.deviceName}, which is not a "${orphan.name}". Press a button on the right device.`;
      return;
    }
    // Identical devices: one device cannot take the bindings of two old IDs by a slip of the hand.
    const taken = movable.value.find(
      (o) =>
        o.id !== orphan.id &&
        choice.value[o.id]?.toGuid.toUpperCase() === candidate.guid.toUpperCase()
    );
    if (taken && orphan.candidates.length > 1) {
      identifyNote.value = `That device is already chosen for the bindings under ${taken.oldGuid}. Press a button on another one.`;
      return;
    }
    choice.value = {
      ...choice.value,
      [orphan.id]: {
        toGuid: candidate.guid,
        onConflict: choice.value[orphan.id]?.onConflict ?? 'keep',
      },
    };
    identifyNote.value = undefined;
    void stopIdentify();
  });
}

onMounted(load);
watch(() => store.revision, load);
onBeforeUnmount(() => void stopIdentify());
</script>

<template>
  <div data-testid="bind-device-ids">
    <v-alert v-if="error" type="error" variant="tonal" class="mb-3" data-testid="ids-error">
      {{ error }}
    </v-alert>
    <p class="rr-row-sub ids-why">
      DCS names each binding file after the device and the ID Windows gave it, for example
      <span class="rr-mono">WINWING ICP {806DB7F0-…}.diff.lua</span>. After a Windows reinstall, a
      move to a new PC or a driver reset the device gets a new ID, DCS looks for a file that is not
      there, and your bindings appear lost. Moving them renames the files in every aircraft folder
      and updates the IDs inside the modifier and settings files, as one change you can undo.
    </p>

    <div v-if="!scan" class="rr-panel rr-empty">Looking through the binding files…</div>
    <template v-else>
      <div v-if="movable.length === 0" class="rr-panel rr-empty ids-ok" data-testid="ids-none">
        <v-icon icon="mdi-check-circle-outline" size="36" class="rr-ok mb-3" />
        <div class="rr-row-title">Every binding file belongs to an attached device</div>
        <div class="rr-row-sub">Nothing needs to be moved.</div>
      </div>

      <template v-else>
        <div class="rr-section-title">Bindings under an old device ID</div>
        <div class="rr-panel ids-panel">
          <div
            v-for="orphan in movable"
            :key="orphan.id"
            class="ids-row"
            data-testid="ids-orphan"
            :data-device="orphan.name"
            :data-status="orphan.status"
          >
            <div class="ids-main">
              <div class="rr-row-title">{{ orphan.name }}</div>
              <div class="rr-row-sub">{{ folders(orphan) }}</div>
              <div class="ids-guids rr-mono">
                <span class="rr-muted" data-testid="ids-old">{{ orphan.oldGuid }}</span>
                <v-icon icon="mdi-arrow-right" size="14" class="rr-muted" />
                <span v-if="choice[orphan.id]?.toGuid" data-testid="ids-new">
                  {{ choice[orphan.id]!.toGuid }}
                </span>
                <span v-else class="rr-warn" data-testid="ids-new">not chosen yet</span>
                <span v-if="chosenName(orphan)" class="ids-given" data-testid="ids-new-name">{{
                  chosenName(orphan)
                }}</span>
              </div>
              <div v-if="orphan.reason" class="rr-row-sub rr-warn" data-testid="ids-reason">
                {{ orphan.reason }}
              </div>
              <div
                v-if="identifying === orphan.id"
                class="ids-identify"
                data-testid="ids-identifying"
              >
                <v-progress-circular indeterminate size="16" width="2" />
                Press any button on the device now…
                <span v-if="identifyNote" class="rr-warn">{{ identifyNote }}</span>
              </div>
            </div>
            <div class="ids-controls">
              <v-select
                v-if="orphan.candidates.length > 1 || orphan.status === 'choose'"
                density="compact"
                :items="candidateItems(orphan)"
                :model-value="choice[orphan.id]?.toGuid ?? ''"
                :aria-label="`Device for ${orphan.name}`"
                data-testid="ids-target"
                @update:model-value="
                  choice = {
                    ...choice,
                    [orphan.id]: {
                      toGuid: String($event),
                      onConflict: choice[orphan.id]?.onConflict ?? 'keep',
                    },
                  }
                "
              />
              <v-checkbox
                v-else
                label="Move"
                :model-value="choice[orphan.id]?.toGuid !== ''"
                data-testid="ids-move"
                @update:model-value="
                  choice = {
                    ...choice,
                    [orphan.id]: {
                      toGuid: $event ? (orphan.proposed ?? '') : '',
                      onConflict: choice[orphan.id]?.onConflict ?? 'keep',
                    },
                  }
                "
              />
              <v-btn
                v-if="identifying !== orphan.id"
                size="small"
                variant="tonal"
                prepend-icon="mdi-gesture-tap-button"
                data-testid="ids-identify"
                @click="identify(orphan)"
              >
                Press a button on it
              </v-btn>
              <v-btn
                v-else
                size="small"
                variant="text"
                data-testid="ids-identify-stop"
                @click="stopIdentify"
              >
                Stop
              </v-btn>
              <v-select
                v-if="collides(orphan)"
                density="compact"
                label="The device already has a file"
                :items="CONFLICT_ITEMS"
                :model-value="choice[orphan.id]?.onConflict"
                data-testid="ids-conflict"
                @update:model-value="
                  choice = {
                    ...choice,
                    [orphan.id]: { toGuid: choice[orphan.id]!.toGuid, onConflict: $event },
                  }
                "
              />
            </div>
          </div>
        </div>
        <div class="ids-actions">
          <v-btn
            color="primary"
            :disabled="mappings.length === 0"
            data-testid="ids-preview"
            @click="store.plan({ type: 'migration', mappings })"
          >
            Preview moving {{ mappings.length }} {{ mappings.length === 1 ? 'device' : 'devices' }}
          </v-btn>
          <span v-if="mappings.length < movable.length" class="rr-row-sub">
            {{ movable.length - mappings.length }} not chosen yet
          </span>
        </div>
      </template>

      <template v-if="unplugged.length > 0">
        <div class="rr-section-title ids-unplugged">
          Binding files for devices that are not attached
        </div>
        <div class="rr-panel" data-testid="ids-unplugged">
          <div v-for="orphan in unplugged" :key="orphan.id" class="rr-row">
            <v-icon icon="mdi-power-plug-off-outline" class="rr-muted" />
            <div class="rr-row-main">
              <div class="rr-row-title">{{ orphan.name }}</div>
              <div class="rr-row-sub">
                {{ folders(orphan) }} · <span class="rr-mono">{{ orphan.oldGuid }}</span>
              </div>
            </div>
            <span class="rr-row-sub">Nothing to do: plug it in and DCS finds its bindings.</span>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.ids-why {
  max-width: 860px;
  margin: 0 0 18px;
}
.ids-ok {
  margin-bottom: 24px;
}
.ids-panel {
  margin-bottom: 12px;
}
.ids-row {
  display: flex;
  gap: 16px;
  padding: 12px 16px;
  border-top: 1px solid var(--rr-border);
}
.ids-row:first-child {
  border-top: none;
}
.ids-main {
  flex: 1;
  min-width: 0;
}
.ids-given {
  font-family: inherit;
  font-weight: 600;
}
.ids-guids {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  flex-wrap: wrap;
}
.ids-identify {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 6px;
  font-size: 13px;
  color: var(--rr-accent);
}
.ids-controls {
  flex: 0 0 330px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}
.ids-controls :deep(.v-select) {
  width: 100%;
}
.ids-actions {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 28px;
}
.ids-unplugged {
  margin-top: 8px;
}
</style>
