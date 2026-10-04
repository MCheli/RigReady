<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { onMachineChanged } from '../../../renderer/machine';
import { CATEGORIES, CATEGORY_IDS, categoryTrail, type CategoryId } from '../core/categories';
import { controlName } from '../core/layout';
import { kindsOn } from '../core/pages';
import { actionIndex, physicalLabels, type SheetDevice } from '../core/sheet';
import KneeboardDialog from './KneeboardDialog.vue';
import LayoutEditor from './LayoutEditor.vue';
import PrintDialog from './PrintDialog.vue';
import SheetView from './SheetView.vue';
import { useCheatSheets } from './store';

const store = useCheatSheets();
const route = useRoute();
const router = useRouter();

const view = ref<'devices' | 'actions'>('devices');
const search = ref('');
const kind = ref<CategoryId>();
const selected = ref<string>();
const showEmpty = ref(true);
const editing = ref(false);
const printing = ref(false);
const kneeboard = ref(false);
const noteDraft = ref('');
const noteError = ref('');
const noteSaved = ref(false);
const popError = ref('');

const device = computed(() => store.device);
const needle = computed(() => search.value.trim().toLowerCase());

function matches(target: SheetDevice): Set<string> {
  const labels = physicalLabels(target.layout);
  const keep = new Set<string>();
  for (const control of target.controls) {
    const hay = [
      control.name,
      labels.get(control.id) ?? '',
      control.note ?? '',
      ...control.bindings.flatMap((b) => [
        b.action,
        b.plain ?? '',
        b.short,
        ...b.category,
        ...b.modifiers,
      ]),
    ]
      .join(' ')
      .toLowerCase();
    const kindOk = !kind.value || control.bindings.some((b) => b.kind === kind.value);
    if (kindOk && (!needle.value || hay.includes(needle.value))) keep.add(control.id);
  }
  return keep;
}

const filtering = computed(() => needle.value !== '' || kind.value !== undefined);
const keep = computed(() => (filtering.value && device.value ? matches(device.value) : undefined));
const matchCounts = computed(() => {
  const counts = new Map<string, number>();
  if (!filtering.value) return counts;
  for (const d of store.sheet?.devices ?? []) counts.set(d.key, matches(d).size);
  return counts;
});

const pressed = computed(() =>
  device.value?.guid ? (store.pressed.get(device.value.guid) ?? []) : []
);
const axes = computed(() => (device.value?.guid ? (store.axes.get(device.value.guid) ?? {}) : {}));

const selectedControl = computed(() => {
  const d = device.value;
  if (!d || !selected.value) return undefined;
  const entry = d.controls.find((c) => c.id === selected.value);
  return {
    id: selected.value,
    name: controlName(selected.value),
    physical: physicalLabels(d.layout).get(selected.value),
    bindings: entry?.bindings ?? [],
    conflict: entry?.conflict ?? false,
    note: entry?.note ?? '',
  };
});

watch(
  () => [selectedControl.value?.id, selectedControl.value?.note, device.value?.key],
  () => {
    noteDraft.value = selectedControl.value?.note ?? '';
    noteError.value = '';
    noteSaved.value = false;
  }
);
// Another aircraft or car: what was selected, and the kind filtered for, belong to the
// sheet before (a racing sheet has no "Weapons" to filter by).
watch(
  () => store.choice,
  () => {
    selected.value = undefined;
    kind.value = undefined;
  }
);
// Pressing a control on the device selects it, so its details and note are right there.
watch(
  () => store.lastPress,
  (press) => {
    if (press && !editing.value && press.deviceKey === device.value?.key) {
      selected.value = press.control;
    }
  }
);

async function saveNote(): Promise<void> {
  if (!device.value || !selectedControl.value) return;
  noteSaved.value = false;
  const failed = await store.setNote(device.value.key, selectedControl.value.id, noteDraft.value);
  noteError.value = failed ?? '';
  noteSaved.value = !failed;
}

const allActions = computed(() => (store.sheet ? actionIndex(store.sheet) : []));
/** The kinds this sheet has, in legend order: a racing sheet offers no "Weapons" to filter by. */
const actionKinds = computed(() => {
  const present = new Set(allActions.value.map((entry) => entry.kind));
  return CATEGORY_IDS.filter((id) => present.has(id));
});
const actions = computed(() => {
  return allActions.value.filter((entry) => {
    if (kind.value && entry.kind !== kind.value) return false;
    if (!needle.value) return true;
    return [
      entry.action,
      entry.plain ?? '',
      ...entry.category,
      ...entry.places.flatMap((p) => [p.device, p.physical ?? '', p.note ?? '']),
    ]
      .join(' ')
      .toLowerCase()
      .includes(needle.value);
  });
});
const actionGroups = computed(() =>
  CATEGORY_IDS.map((id) => ({
    id,
    info: CATEGORIES[id],
    entries: actions.value.filter((entry) => entry.kind === id),
  })).filter((group) => group.entries.length > 0)
);

function goTo(deviceKey: string, control: string): void {
  store.deviceKey = deviceKey;
  view.value = 'devices';
  selected.value = control;
}

function pick(key: string): void {
  store.deviceKey = key;
  selected.value = undefined;
}

const legend = computed(() => (device.value ? kindsOn(device.value) : []));
const totals = computed(() => {
  const devices = store.sheet?.devices ?? [];
  return {
    devices: devices.length,
    bound: devices.reduce((n, d) => n + d.counts.bound, 0),
    conflicts: devices.reduce((n, d) => n + d.counts.conflicts, 0),
  };
});

const SOURCE_TEXT = {
  user: 'Your layout',
  builtin: 'Shipped layout',
  generated: 'Generated layout',
} as const;

async function popOut(): Promise<void> {
  popError.value = '';
  const result = await store.api.popOut({
    game: store.game,
    aircraftId: store.aircraftId,
    ...(device.value ? { deviceKey: device.value.key } : {}),
  });
  if (!result.ok) popError.value = result.error.message;
}

function quickLook(): void {
  void router.push({
    path: '/configure/cheat-sheets/quick',
    query: { game: store.game, aircraft: store.aircraftId, device: device.value?.key ?? '' },
  });
}

async function editorClosed(saved: boolean): Promise<void> {
  editing.value = false;
  store.holdDevice = false;
  if (saved) await store.refresh();
}

function startEditing(): void {
  store.holdDevice = true;
  editing.value = true;
}

let offMachine: (() => void) | undefined;
onMounted(async () => {
  const game = typeof route.query['game'] === 'string' ? route.query['game'] : '';
  const aircraft = typeof route.query['aircraft'] === 'string' ? route.query['aircraft'] : '';
  await store.load(game && aircraft ? `${game}/${aircraft}` : undefined);
  const wanted = route.query['device'];
  if (typeof wanted === 'string' && store.sheet?.devices.some((d) => d.key === wanted)) {
    store.deviceKey = wanted;
  }
  offMachine = onMachineChanged(() => {
    if (!editing.value) void store.refresh();
  });
  await store.acquire();
});
onBeforeUnmount(() => {
  offMachine?.();
  store.holdDevice = false;
  void store.release();
});
</script>

<template>
  <div
    class="rr-page cs-page"
    data-testid="cheat-sheets-page"
    :data-live="store.watching"
    :data-ready="store.loaded && !store.loading"
    :data-followed="store.followed"
  >
    <div class="cs-top">
      <div>
        <h1 class="rr-page-title">Cheat sheets</h1>
        <p class="rr-page-sub">
          Every device with what each control does in the aircraft or car you choose. Press a
          control and its label lights up.
        </p>
      </div>
    </div>

    <v-alert
      v-if="store.error"
      type="warning"
      variant="tonal"
      class="mb-4"
      data-testid="sheet-error"
    >
      {{ store.error }}
    </v-alert>

    <div
      v-if="store.loaded && (store.overview?.games.length ?? 0) === 0 && !store.error"
      class="rr-panel rr-empty"
      data-testid="sheet-none"
    >
      <v-icon icon="mdi-card-text-outline" size="34" class="mb-2" />
      <div>No game whose bindings RigReady can read was found on this PC.</div>
      <div class="cs-small">
        Cheat sheets are drawn from a game's bindings: DCS World, iRacing, Le Mans Ultimate,
        BeamNG.drive and Assetto Corsa. Once one of them is installed and has bindings, its aircraft
        or cars appear here.
      </div>
    </div>

    <template v-else-if="store.overview">
      <div class="cs-bar rr-panel">
        <v-select
          class="cs-aircraft"
          label="Aircraft or car"
          :items="store.aircraftItems"
          :model-value="store.choice"
          density="compact"
          variant="outlined"
          hide-details
          data-testid="sheet-aircraft"
          @update:model-value="store.choose(String($event))"
        />
        <v-btn-toggle v-model="view" mandatory density="compact" variant="outlined" divided>
          <v-btn value="devices" size="small" data-testid="sheet-view-devices">By device</v-btn>
          <v-btn value="actions" size="small" data-testid="sheet-view-actions">By action</v-btn>
        </v-btn-toggle>
        <v-text-field
          v-model="search"
          class="cs-search"
          density="compact"
          variant="outlined"
          hide-details
          clearable
          prepend-inner-icon="mdi-magnify"
          placeholder="Find an action, e.g. flare"
          data-testid="sheet-search"
          @click:clear="search = ''"
        />
        <v-spacer />
        <v-btn
          size="small"
          variant="text"
          prepend-icon="mdi-eye-outline"
          data-testid="sheet-quick"
          :disabled="!device"
          @click="quickLook"
          >Quick look</v-btn
        >
        <v-btn
          size="small"
          variant="text"
          icon="mdi-dock-window"
          title="Quick look in a small window that stays on top"
          aria-label="Pop out the quick look"
          data-testid="sheet-popout"
          :disabled="!device"
          @click="popOut"
        />
        <v-btn
          size="small"
          variant="text"
          prepend-icon="mdi-printer-outline"
          data-testid="sheet-print"
          :disabled="!store.sheet"
          @click="printing = true"
          >Print / PDF</v-btn
        >
        <v-btn
          v-if="store.kneeboard"
          size="small"
          variant="tonal"
          color="primary"
          prepend-icon="mdi-notebook-outline"
          data-testid="sheet-kneeboard"
          :disabled="!store.sheet"
          @click="kneeboard = true"
          >Kneeboard</v-btn
        >
      </div>

      <div v-if="store.sheet" class="cs-totals" data-testid="sheet-totals">
        <span
          ><strong data-testid="sheet-name">{{ store.title }}</strong> · {{ totals.devices }}
          {{ totals.devices === 1 ? 'device' : 'devices' }} · {{ totals.bound }}
          {{ totals.bound === 1 ? 'control' : 'controls' }} bound</span
        >
        <span v-if="totals.conflicts > 0" class="rr-warn" data-testid="sheet-conflicts">
          <v-icon icon="mdi-alert" size="15" /> {{ totals.conflicts }}
          {{ totals.conflicts === 1 ? 'control fires' : 'controls fire' }} several actions at once
        </span>
        <span v-if="!store.sheet.aircraft.hasUserBindings" class="rr-muted">
          Only the game's default bindings so far.
        </span>
        <v-spacer />
        <span v-if="store.lastPress" class="cs-last" data-testid="sheet-last">
          <v-icon icon="mdi-gesture-tap-button" size="15" />
          {{ store.lastPress.device }} · {{ store.lastPress.name }}:
          <strong>{{ store.lastPress.actions.join(' / ') || 'nothing bound' }}</strong>
        </span>
      </div>

      <div v-if="store.sheet && store.sheet.devices.length === 0" class="rr-panel rr-empty">
        No game controller is connected and none has bindings here.
      </div>

      <!-- By device -->
      <div v-else-if="store.sheet && view === 'devices'" class="cs-body">
        <aside class="cs-rail" data-testid="sheet-devices">
          <button
            v-for="d in store.sheet.devices"
            :key="d.key"
            type="button"
            class="cs-device"
            :class="{ on: d.key === device?.key, bare: d.counts.bound === 0 }"
            data-testid="sheet-device"
            :data-key="d.key"
            :data-title="d.title"
            :disabled="editing"
            @click="pick(d.key)"
          >
            <span class="cs-device-title">{{ d.title }}</span>
            <span v-if="d.givenName" class="cs-device-sub">{{ d.name }}</span>
            <span class="cs-device-sub">
              <template v-if="filtering"
                ><strong>{{ matchCounts.get(d.key) ?? 0 }}</strong> match</template
              >
              <template v-else>{{ d.counts.bound }} of {{ d.counts.placed }} bound</template>
              <span v-if="d.counts.conflicts > 0" class="rr-warn">
                · {{ d.counts.conflicts }} !</span
              >
              <span v-if="!d.connected"> · not connected</span>
            </span>
          </button>
        </aside>

        <section v-if="device" class="cs-main">
          <LayoutEditor v-if="editing" :device="device" :pressed="pressed" @close="editorClosed" />
          <template v-else>
            <div class="cs-head">
              <div class="rr-row-main">
                <div class="cs-title" data-testid="sheet-title">{{ device.title }}</div>
                <div class="rr-row-sub">
                  <span v-if="device.givenName">{{ device.name }} · </span>
                  <span data-testid="sheet-layout-source" :data-source="device.layoutSource">{{
                    SOURCE_TEXT[device.layoutSource]
                  }}</span>
                  <span v-if="device.counts.hidden > 0">
                    · {{ device.counts.hidden }} more buttons the device reports are not on this
                    layout (none is bound)</span
                  >
                </div>
              </div>
              <v-switch
                v-model="showEmpty"
                label="Unbound controls"
                density="compact"
                hide-details
                class="flex-grow-0"
                data-testid="sheet-show-empty"
              />
              <v-btn
                size="small"
                variant="text"
                prepend-icon="mdi-vector-square-edit"
                data-testid="sheet-edit-layout"
                :disabled="!device.vendorId || !device.productId"
                @click="startEditing"
                >Edit layout</v-btn
              >
              <v-btn
                size="small"
                variant="text"
                prepend-icon="mdi-open-in-app"
                :to="device.route"
                data-testid="sheet-open-bindings"
                >Bindings</v-btn
              >
            </div>
            <v-alert
              v-if="device.layoutProblem"
              type="warning"
              variant="tonal"
              density="compact"
              class="mb-2"
              data-testid="sheet-layout-problem"
            >
              {{ device.layoutProblem }}
            </v-alert>
            <div v-if="device.layout.notes && device.layoutSource !== 'user'" class="cs-notes">
              <v-icon icon="mdi-information-outline" size="15" /> {{ device.layout.notes }}
            </div>

            <div class="cs-sheet-row">
              <div class="cs-sheet">
                <SheetView
                  :device="device"
                  :show-empty="showEmpty"
                  :pressed="pressed"
                  :axes="axes"
                  :selected="selected"
                  :keep="keep"
                  @control="selected = $event"
                />
                <div class="cs-legend" data-testid="sheet-legend">
                  <button
                    v-for="id in legend"
                    :key="id"
                    type="button"
                    class="cs-chip"
                    :class="{ on: kind === id }"
                    data-testid="legend-chip"
                    :data-kind="id"
                    @click="kind = kind === id ? undefined : id"
                  >
                    <i :style="{ background: CATEGORIES[id].color }"></i>{{ CATEGORIES[id].label }}
                  </button>
                  <span class="cs-legend-key"
                    ><b class="rr-warn">!</b> fires several actions · ×2 same action elsewhere ·
                    dashed = nothing bound · click a control, or press it on the device, for details
                    and your own note</span
                  >
                </div>
                <div v-if="device.other.length > 0" class="cs-other" data-testid="sheet-other">
                  Also bound on inputs that are not on a controller picture:
                  <span v-for="o in device.other" :key="o.input + o.action"
                    >{{ o.label }}: {{ o.action }}</span
                  >
                </div>
              </div>

              <aside v-if="selectedControl" class="cs-detail rr-panel" data-testid="sheet-detail">
                <template v-if="selectedControl">
                  <div class="cs-detail-head">
                    <div>
                      <div class="cs-detail-title" data-testid="detail-title">
                        {{ selectedControl.name }}
                      </div>
                      <div v-if="selectedControl.physical" class="rr-row-sub">
                        {{ selectedControl.physical }}
                      </div>
                    </div>
                    <v-btn
                      icon="mdi-close"
                      size="x-small"
                      variant="text"
                      aria-label="Close"
                      @click="selected = undefined"
                    />
                  </div>
                  <div
                    v-if="selectedControl.bindings.length === 0"
                    class="rr-muted cs-detail-block"
                    data-testid="detail-empty"
                  >
                    Nothing is bound to this control in {{ store.title }}.
                  </div>
                  <div
                    v-for="(b, i) in selectedControl.bindings"
                    :key="i"
                    class="cs-detail-block"
                    data-testid="detail-binding"
                  >
                    <div class="cs-detail-action">
                      <i :style="{ background: CATEGORIES[b.kind].color }"></i
                      >{{ b.plain ?? b.action }}
                    </div>
                    <div v-if="b.plain" class="rr-row-sub" data-testid="detail-game-name">
                      {{ store.sheet.gameName }} calls it: {{ b.action }}
                    </div>
                    <div v-if="b.modifiers.length" class="cs-mod">
                      while holding {{ b.modifiers.join(' + ') }}
                    </div>
                    <div class="rr-row-sub">
                      {{ CATEGORIES[b.kind].label
                      }}<span v-if="categoryTrail(b.category)">
                        · {{ categoryTrail(b.category) }}</span
                      >
                      ·
                      {{ b.source === 'user' ? 'your binding' : 'game default' }}
                    </div>
                    <div v-if="b.alsoOn.length" class="rr-row-sub" data-testid="detail-also">
                      Also on {{ b.alsoOn.join(', ') }}
                    </div>
                  </div>
                  <div
                    v-if="selectedControl.conflict"
                    class="rr-warn cs-detail-block"
                    data-testid="detail-conflict"
                  >
                    <v-icon icon="mdi-alert" size="15" /> These fire together on one press. Clear
                    one of them on the bindings page if that is not what you want.
                  </div>
                  <div class="cs-detail-block">
                    <v-text-field
                      v-model="noteDraft"
                      label="Your note"
                      placeholder="e.g. hold for weapon release"
                      density="compact"
                      variant="outlined"
                      hide-details
                      maxlength="120"
                      data-testid="note-input"
                      @keyup.enter="saveNote"
                    />
                    <div class="cs-note-actions">
                      <v-btn
                        size="small"
                        variant="tonal"
                        color="primary"
                        data-testid="note-save"
                        :disabled="noteDraft.trim() === selectedControl.note"
                        @click="saveNote"
                        >Save note</v-btn
                      >
                      <span v-if="noteSaved" class="rr-muted" data-testid="note-saved">Saved</span>
                      <span v-if="noteError" class="rr-warn" data-testid="note-error">{{
                        noteError
                      }}</span>
                    </div>
                  </div>
                </template>
              </aside>
            </div>
          </template>
        </section>
      </div>

      <!-- By action -->
      <div v-else-if="store.sheet" class="cs-actions" data-testid="sheet-actions">
        <div class="cs-legend">
          <button
            v-for="id in actionKinds"
            :key="id"
            type="button"
            class="cs-chip"
            :class="{ on: kind === id }"
            :data-kind="id"
            @click="kind = kind === id ? undefined : id"
          >
            <i :style="{ background: CATEGORIES[id].color }"></i>{{ CATEGORIES[id].label }}
          </button>
        </div>
        <div v-if="actionGroups.length === 0" class="rr-panel rr-empty" data-testid="actions-none">
          No bound action matches.
        </div>
        <div v-for="group in actionGroups" :key="group.id" class="rr-panel cs-action-group">
          <div class="cs-action-kind">
            <i :style="{ background: group.info.color }"></i>{{ group.info.label }}
            <span class="rr-muted">{{ group.entries.length }}</span>
          </div>
          <div
            v-for="entry in group.entries"
            :key="entry.actionId"
            class="rr-row cs-action-row"
            data-testid="action-row"
            :data-action="entry.action"
          >
            <div class="rr-row-main">
              <div class="rr-row-title">{{ entry.plain ?? entry.action }}</div>
              <div v-if="entry.plain" class="rr-row-sub" data-testid="action-game-name">
                {{ store.sheet.gameName }} calls it: {{ entry.action }}
              </div>
              <div v-if="categoryTrail(entry.category)" class="rr-row-sub">
                {{ categoryTrail(entry.category) }}
              </div>
            </div>
            <div class="cs-places">
              <button
                v-for="(place, i) in entry.places"
                :key="i"
                type="button"
                class="cs-place"
                data-testid="action-place"
                @click="goTo(place.deviceKey, place.control)"
              >
                <span class="cs-place-device">{{ place.device }}</span>
                <span v-if="place.modifiers.length" class="cs-mod"
                  >{{ place.modifiers.join('+') }} +
                </span>
                <strong>{{ place.physical ?? place.controlName }}</strong>
                <span v-if="place.physical" class="rr-muted"> ({{ place.controlName }})</span>
                <em v-if="place.note"> {{ place.note }}</em>
              </button>
            </div>
          </div>
        </div>
      </div>
    </template>

    <PrintDialog v-if="printing && store.sheet" @close="printing = false" />
    <KneeboardDialog v-if="kneeboard && store.sheet" @close="kneeboard = false" />
    <v-snackbar :model-value="popError !== ''" color="warning" @update:model-value="popError = ''">
      {{ popError }}
    </v-snackbar>
  </div>
</template>

<style scoped>
.cs-page {
  max-width: 1560px;
}
.cs-small {
  font-size: 13px;
  margin-top: 6px;
}
.cs-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}
.cs-aircraft {
  max-width: 300px;
  min-width: 240px;
}
.cs-search {
  max-width: 300px;
  min-width: 200px;
}
.cs-totals {
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 13px;
  margin: 0 2px 12px;
  min-height: 22px;
}
.cs-last {
  color: var(--rr-accent);
  max-width: 55%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cs-body {
  display: flex;
  gap: 14px;
  align-items: flex-start;
}
.cs-rail {
  width: 216px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  position: sticky;
  top: 68px;
  max-height: calc(100vh - 84px);
  overflow-y: auto;
}
.cs-device {
  text-align: left;
  background: var(--rr-surface);
  border: 1px solid var(--rr-border);
  border-radius: 9px;
  padding: 8px 10px;
  color: var(--rr-text);
  display: flex;
  flex-direction: column;
  gap: 1px;
  cursor: pointer;
}
.cs-device:hover {
  border-color: var(--rr-muted);
}
.cs-device.on {
  border-color: var(--rr-accent);
  background: var(--rr-surface-2);
}
.cs-device.bare .cs-device-title {
  color: var(--rr-muted);
}
.cs-device-title {
  font-size: 13.5px;
  font-weight: 600;
  line-height: 1.25;
}
.cs-device-sub {
  font-size: 11.5px;
  color: var(--rr-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cs-main {
  flex: 1;
  min-width: 0;
}
.cs-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.cs-title {
  font-size: 18px;
  font-weight: 650;
}
.cs-notes {
  font-size: 12.5px;
  color: var(--rr-muted);
  margin-bottom: 8px;
}
.cs-sheet-row {
  display: flex;
  gap: 14px;
  align-items: flex-start;
}
.cs-sheet {
  flex: 1;
  min-width: 0;
}
.cs-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 8px;
  align-items: center;
  margin-top: 10px;
}
.cs-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--rr-text);
  background: var(--rr-surface);
  border: 1px solid var(--rr-border);
  border-radius: 999px;
  padding: 3px 10px 3px 8px;
  cursor: pointer;
}
.cs-chip.on {
  border-color: var(--rr-accent);
  background: var(--rr-surface-2);
}
.cs-chip i,
.cs-action-kind i,
.cs-detail-action i {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  display: inline-block;
  flex-shrink: 0;
}
.cs-legend-key {
  font-size: 11.5px;
  color: var(--rr-muted);
  margin-left: 6px;
}
.cs-other {
  margin-top: 10px;
  font-size: 12.5px;
  color: var(--rr-muted);
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
}
.cs-detail {
  width: 272px;
  flex-shrink: 0;
  padding: 12px 14px;
  position: sticky;
  top: 68px;
  font-size: 13px;
}
.cs-detail-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}
.cs-detail-title {
  font-size: 16px;
  font-weight: 650;
}
.cs-detail-block {
  margin-top: 12px;
}
.cs-detail-action {
  font-weight: 600;
  display: flex;
  gap: 7px;
  align-items: baseline;
}
.cs-detail-hint {
  text-align: center;
  padding: 26px 6px;
  font-size: 13px;
}
.cs-mod {
  color: var(--rr-accent);
  font-weight: 600;
}
.cs-note-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
}
.cs-actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.cs-action-kind {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  padding: 10px 16px 8px;
}
.cs-action-row {
  align-items: flex-start;
  padding: 8px 16px;
}
.cs-places {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  max-width: 60%;
}
.cs-place {
  font-size: 12.5px;
  color: var(--rr-text);
  background: var(--rr-surface-2);
  border: 1px solid var(--rr-border);
  border-radius: 7px;
  padding: 3px 9px;
  cursor: pointer;
  text-align: right;
}
.cs-place:hover {
  border-color: var(--rr-accent);
}
.cs-place-device {
  color: var(--rr-muted);
  margin-right: 6px;
}
.cs-place em {
  color: var(--rr-accent);
  margin-left: 6px;
}
</style>
