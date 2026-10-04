<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import NotOnThisPc from '../../../renderer/components/NotOnThisPc.vue';
import PageSkeleton from '../../../renderer/components/PageSkeleton.vue';
import { errorText, useClient } from '../../../renderer/ipc';
import { notifyMachineChanged, onMachineChanged } from '../../../renderer/machine';
import {
  dcsSetupContract,
  type DesktopChoice,
  type MonitorSetupFileView,
  type ScreensPreview,
  type ScreensState,
} from '../contract';
import {
  contains,
  cropFor,
  cropRect,
  displayLabel,
  generateSetup,
  MAIN_VIEW_ONLY,
  monitorLabels,
  type Crop,
  type Rect,
  type ScreenSetup,
} from '../core/screens';
import DiffView from './DiffView.vue';
import ScreenMap, { type MapBox } from './ScreenMap.vue';

const api = useClient(dcsSetupContract);
const state = ref<ScreensState>();
const setup = ref<ScreenSetup>();
const desktopId = ref('current');
const aircraftIndex = ref(0);
const selected = ref<string>();
const viewing = ref<MonitorSetupFileView>();
const mapWrap = ref<HTMLElement>();
// Showing a file from the list below brings the map into view.
watch(viewing, (file) => {
  if (file) mapWrap.value?.scrollIntoView({ block: 'center' });
});
const setResolution = ref(true);
const preview = ref<ScreensPreview>();
const showLua = ref(false);
const confirmOverwrite = ref(false);
const busy = ref(false);
const error = ref<string>();
const notes = ref<string[]>([]);
const started = ref<string>();
const done = ref<{ message: string; changes: string[] }>();

const choices = computed<DesktopChoice[]>(() => {
  const list = [...(state.value?.desktops ?? [])];
  const saved = state.value?.saved;
  if (saved) {
    list.unshift({
      id: 'saved',
      label: 'The layout saved with this setup',
      displays: saved.desktop,
    });
  }
  return list;
});

async function load(initial = false): Promise<void> {
  const result = await api.screens();
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  state.value = result.value;
  if (!initial) return;
  if (result.value.saved) {
    setup.value = structuredClone(result.value.saved);
    desktopId.value = 'saved';
    started.value = undefined;
    return;
  }
  if (result.value.simAppProPlan && (await importPlan(true))) return;
  const current = result.value.desktops[0];
  if (!current) return;
  const primary = current.displays.find((d) => d.primary) ?? current.displays[0]!;
  setup.value = {
    mainDisplayIds: [primary.id],
    aircraft: [{ unit: 'FA-18C_hornet', label: 'F/A-18C Hornet', placements: [] }],
    desktop: current.displays,
    desktopLabel: current.label,
  };
  desktopId.value = current.id;
}

/** Imports SimAppPro's plan into the first layout that has all its screens (or the current one). */
async function importPlan(automatic = false): Promise<boolean> {
  error.value = undefined;
  const ids = automatic
    ? (state.value?.desktops ?? []).map((d) => d.id)
    : [desktopId.value === 'saved' ? 'current' : desktopId.value];
  let fallback:
    | { setup: ScreenSetup; unmatched: string[]; catalog: ScreensState['catalog']; id: string }
    | undefined;
  for (const id of ids) {
    const result = await api.importSimAppPro({ desktopId: id });
    if (!result.ok) {
      if (!automatic) error.value = errorText(result.error);
      return false;
    }
    fallback ??= { ...result.value, id };
    if (result.value.unmatched.length === 0) {
      fallback = { ...result.value, id };
      break;
    }
  }
  if (!fallback) return false;
  if (state.value) state.value.catalog = fallback.catalog;
  setup.value = fallback.setup.aircraft.length
    ? fallback.setup
    : {
        ...fallback.setup,
        aircraft: [{ unit: 'FA-18C_hornet', label: 'F/A-18C Hornet', placements: [] }],
      };
  desktopId.value = fallback.id;
  aircraftIndex.value = 0;
  notes.value = fallback.unmatched;
  const planes = fallback.setup.aircraft.map((a) => a.label).join(', ');
  started.value = planes
    ? `Started from SimAppPro's screen plan (${planes}). Check it on the map, then use it in DCS.`
    : "SimAppPro's screen plan has no cockpit displays placed on these monitors.";
  return true;
}

function chooseDesktop(id: string): void {
  const choice = choices.value.find((c) => c.id === id);
  if (!choice || !setup.value) return;
  desktopId.value = id;
  setup.value = {
    ...setup.value,
    desktop: choice.displays,
    desktopLabel:
      id === 'saved' ? (state.value?.saved?.desktopLabel ?? choice.label) : choice.label,
  };
}

const generated = computed(() => (setup.value ? generateSetup(setup.value) : undefined));
const labels = computed(() => monitorLabels(setup.value?.desktop ?? []));
const aircraft = computed(() => setup.value?.aircraft[aircraftIndex.value]);
const displaysById = computed(() => new Map((setup.value?.desktop ?? []).map((d) => [d.id, d])));

/** Every display the selected aircraft can export: the known ones plus whatever is placed. */
const rows = computed(() => {
  const a = aircraft.value;
  if (!a) return [];
  const known = state.value?.catalog.find((c) => c.unit === a.unit)?.displays ?? [];
  const names = [...new Set([...known, ...a.placements.map((p) => p.name)])];
  return names.map((name) => ({
    name,
    label: displayLabel(a.unit, name),
    placement: a.placements.find((p) => p.name === name),
  }));
});

const boxes = computed<MapBox[]>(() => {
  if (viewing.value) {
    const displays = setup.value?.desktop ?? [];
    return [...viewing.value.cameras, ...viewing.value.exports]
      .filter((v) => v.rect.width > 0 && v.rect.height > 0)
      .map((v) => ({
        key: v.name,
        label: v.name,
        name: `${v.rect.width}×${v.rect.height}`,
        rect: v.rect,
        editable: false,
        bad:
          !displays.some((d) => contains(d, v.rect)) &&
          !viewing.value!.cameras.some((c) => c.name === v.name),
      }));
  }
  const a = aircraft.value;
  if (!a) return [];
  return a.placements.flatMap((p) => {
    const display = displaysById.value.get(p.displayId);
    if (!display) return [];
    return [
      {
        key: p.name,
        label: displayLabel(a.unit, p.name),
        name: p.name,
        rect: cropRect(display, p.crop),
        displayId: p.displayId,
        editable: true,
        selected: selected.value === p.name,
      },
    ];
  });
});

function setMonitor(name: string, displayId: string | null): void {
  const a = aircraft.value;
  if (!a) return;
  a.placements = a.placements.filter((p) => p.name !== name);
  if (displayId) {
    a.placements.push({ name, displayId, crop: { left: 0, top: 0, right: 0, bottom: 0 } });
    selected.value = name;
  }
}

function place(name: string, displayId: string, rect: Rect): void {
  const placement = aircraft.value?.placements.find((p) => p.name === name);
  const display = displaysById.value.get(displayId);
  if (!placement || !display) return;
  // A box bigger than the monitor it is dropped on fills it.
  const fits = rect.width <= display.width && rect.height <= display.height;
  const shifted = {
    ...rect,
    x: Math.min(Math.max(rect.x, display.x), display.x + display.width - rect.width),
    y: Math.min(Math.max(rect.y, display.y), display.y + display.height - rect.height),
  };
  placement.displayId = displayId;
  placement.crop = fits ? cropFor(display, shifted) : { left: 0, top: 0, right: 0, bottom: 0 };
}

function setCrop(name: string, side: keyof Crop, value: string): void {
  const placement = aircraft.value?.placements.find((p) => p.name === name);
  if (!placement) return;
  const n = Math.max(0, Math.round(Number(value) || 0));
  placement.crop = { ...placement.crop, [side]: n };
}

function toggleMain(id: string): void {
  if (!setup.value) return;
  const ids = setup.value.mainDisplayIds;
  setup.value.mainDisplayIds = ids.includes(id)
    ? ids.length > 1
      ? ids.filter((x) => x !== id)
      : ids
    : [...ids, id];
}

const addable = computed(() =>
  (state.value?.catalog ?? []).filter((c) => !setup.value?.aircraft.some((a) => a.unit === c.unit))
);

function addAircraft(unit: string): void {
  const entry = state.value?.catalog.find((c) => c.unit === unit);
  if (!entry || !setup.value) return;
  setup.value.aircraft.push({ unit: entry.unit, label: entry.label, placements: [] });
  aircraftIndex.value = setup.value.aircraft.length - 1;
  selected.value = undefined;
}

function removeAircraft(index: number): void {
  if (!setup.value) return;
  setup.value.aircraft.splice(index, 1);
  aircraftIndex.value = Math.max(0, Math.min(aircraftIndex.value, setup.value.aircraft.length - 1));
}

// The server preview says what writing would change on disk; it follows every edit.
let timer: ReturnType<typeof setTimeout> | undefined;
/** True from an edit until the preview for it has arrived: the button must not act on an old one. */
const previewPending = ref(true);
watch(
  [setup, setResolution],
  () => {
    previewPending.value = true;
    clearTimeout(timer);
    timer = setTimeout(() => void refreshPreview(), 200);
  },
  { deep: true }
);

/** Only the answer to the latest request is shown; an older one arriving late is dropped. */
let previewRequest = 0;
async function refreshPreview(): Promise<void> {
  if (!setup.value) return;
  const request = ++previewRequest;
  const result = await api.previewScreens({
    setup: setup.value,
    setResolution: setResolution.value,
  });
  if (request !== previewRequest) return;
  previewPending.value = false;
  if (result.ok) preview.value = result.value;
  else error.value = errorText(result.error);
}

async function apply(overwriteEdited = false): Promise<void> {
  if (!setup.value) return;
  if (preview.value?.file.status === 'editedOutside' && !overwriteEdited) {
    confirmOverwrite.value = true;
    return;
  }
  confirmOverwrite.value = false;
  busy.value = true;
  error.value = undefined;
  done.value = undefined;
  const result = await api.applyScreens({
    setup: setup.value,
    setResolution: setResolution.value,
    overwriteEdited,
  });
  busy.value = false;
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  done.value = result.value;
  started.value = undefined;
  notifyMachineChanged();
  await load();
  desktopId.value = 'saved';
  await refreshPreview();
}

const blocked = computed(() => {
  if (!preview.value || previewPending.value) return 'Checking…';
  if (preview.value.dcsRunning) return 'Close DCS first: it rewrites options.lua when it exits.';
  if (preview.value.errors.length) return 'Fix the problems above first.';
  return undefined;
});

const nothingToDo = computed(
  () => preview.value?.file.status === 'same' && preview.value.optionChanges.length === 0
);

const FILE_STATUS = {
  new: 'Create',
  update: 'Update',
  same: 'Keep (no change)',
  editedOutside: 'Replace (it was edited outside RigReady)',
} as const;
const FOLDER = { user: 'Saved Games', install: 'DCS install' } as const;
const AUTHOR = {
  rigready: 'RigReady',
  simapppro: 'SimAppPro',
  dcs: 'DCS',
  other: 'hand-made',
} as const;

// Files and monitors change underneath the page (another program, a layout applied): follow,
// keeping the edits on screen.
let off: (() => void) | undefined;
onMounted(() => {
  off = onMachineChanged(() => {
    void load().then(refreshPreview);
  });
  return load(true);
});
onBeforeUnmount(() => {
  clearTimeout(timer);
  off?.();
});
</script>

<template>
  <div data-testid="dcs-screens">
    <v-alert v-if="error" type="error" variant="tonal" class="mb-4" data-testid="screens-error">{{
      error
    }}</v-alert>
    <PageSkeleton v-if="!state && !error" label="Reading the monitor setups…" />
    <NotOnThisPc
      v-else-if="state?.dcsFound === false"
      name="DCS World"
      :looked="['every Steam library', 'the standalone install folders', 'Saved Games\\DCS']"
      game-page="/configure/games/dcs"
      data-testid="dcs-not-found"
    />
    <div v-else-if="state?.problem" class="rr-panel rr-empty">{{ state.problem }}</div>

    <template v-else-if="state && setup">
      <div class="scr-status rr-panel" data-testid="screens-status">
        <v-icon
          :icon="state.rigReady.selected ? 'mdi-check-circle' : 'mdi-information-outline'"
          :class="state.rigReady.selected ? 'rr-ok' : 'rr-muted'"
        />
        <div class="rr-row-main">
          <div class="rr-row-title">
            <template v-if="state.rigReady.selected">DCS uses RigReady's screen setup</template>
            <template v-else-if="state.options?.multiMonitorSetup">
              DCS uses "{{ state.options.multiMonitorSetup }}"
            </template>
            <template v-else>DCS uses its default single screen</template>
          </div>
          <div class="rr-row-sub">
            RigReady writes its own file, <span class="rr-mono">{{ state.rigReady.path }}</span
            >, and never changes SimAppPro's or anyone else's.
          </div>
        </div>
        <v-btn
          v-if="state.simAppProPlan"
          variant="tonal"
          size="small"
          prepend-icon="mdi-import"
          data-testid="screens-import"
          @click="importPlan()"
        >
          Import from SimAppPro
        </v-btn>
      </div>

      <v-alert
        v-if="started"
        type="info"
        variant="tonal"
        class="mb-3"
        data-testid="screens-started"
      >
        {{ started }}
      </v-alert>
      <v-alert
        v-if="notes.length"
        type="warning"
        variant="tonal"
        class="mb-3"
        data-testid="screens-unmatched"
      >
        Some of SimAppPro's screens are not in this monitor layout. Choose the layout you fly with.
        <ul class="scr-list">
          <li v-for="n in notes" :key="n">{{ n }}</li>
        </ul>
      </v-alert>
      <v-alert v-if="state.rigReady.editedOutside" type="warning" variant="tonal" class="mb-3">
        RigReady.lua was changed outside RigReady. Writing will show you the differences first.
      </v-alert>

      <div class="scr-toolbar">
        <v-select
          :model-value="desktopId"
          :items="choices"
          item-title="label"
          item-value="id"
          label="Monitor layout the coordinates are for"
          density="compact"
          hide-details
          class="scr-layout"
          data-testid="screens-layout"
          @update:model-value="chooseDesktop"
        />
        <div class="scr-main">
          <span class="rr-row-sub">Main view on</span>
          <v-chip
            v-for="d in setup.desktop"
            :key="d.id"
            size="small"
            :variant="setup.mainDisplayIds.includes(d.id) ? 'flat' : 'outlined'"
            :color="setup.mainDisplayIds.includes(d.id) ? 'primary' : undefined"
            data-testid="screens-main-chip"
            @click="toggleMain(d.id)"
          >
            {{ labels.get(d.id) }}
          </v-chip>
        </div>
      </div>

      <div ref="mapWrap" class="rr-panel scr-map-wrap">
        <div v-if="viewing" class="scr-viewing" data-testid="screens-viewing">
          <v-icon icon="mdi-eye-outline" size="16" />
          Showing {{ viewing.stem }}.lua on these monitors
          <v-spacer />
          <v-btn
            size="small"
            variant="text"
            data-testid="screens-stop-viewing"
            @click="viewing = undefined"
          >
            Back to editing
          </v-btn>
        </div>
        <ScreenMap
          :displays="setup.desktop"
          :main-ids="viewing ? [] : setup.mainDisplayIds"
          :boxes="boxes"
          :window="viewing ? undefined : generated?.window"
          @select="selected = $event"
          @place="place"
        />
        <div v-if="!viewing" class="scr-legend rr-row-sub">
          Drag a display onto a screen; drag its edges to crop the bezel. The dashed outline is the
          DCS window ({{ generated?.window.width }} × {{ generated?.window.height }}).
        </div>
      </div>

      <div class="scr-columns">
        <section class="rr-panel scr-aircraft" data-testid="screens-aircraft">
          <div class="scr-tabs">
            <v-chip
              v-for="(a, index) in setup.aircraft"
              :key="a.unit"
              :variant="index === aircraftIndex ? 'flat' : 'outlined'"
              :color="index === aircraftIndex ? 'primary' : undefined"
              closable
              size="small"
              :data-testid="`screens-aircraft-${a.unit}`"
              @click="
                aircraftIndex = index;
                selected = undefined;
              "
              @click:close="removeAircraft(index)"
            >
              {{ a.label }}
            </v-chip>
            <v-menu v-if="addable.length">
              <template #activator="{ props: menu }">
                <v-btn
                  v-bind="menu"
                  size="small"
                  variant="text"
                  prepend-icon="mdi-plus"
                  data-testid="screens-add-aircraft"
                >
                  Aircraft
                </v-btn>
              </template>
              <v-list density="compact" max-height="320">
                <v-list-item
                  v-for="c in addable"
                  :key="c.unit"
                  :title="c.label"
                  :subtitle="c.displays.join(', ')"
                  @click="addAircraft(c.unit)"
                />
              </v-list>
            </v-menu>
          </div>

          <div v-if="!aircraft" class="rr-row rr-muted">
            Add an aircraft to place its cockpit displays. Without one, DCS draws only the main
            view.
          </div>
          <template v-else>
            <div
              v-for="row in rows"
              :key="row.name"
              class="scr-row"
              :class="{ selected: selected === row.name }"
              data-testid="screens-display-row"
              :data-name="row.name"
              @click="selected = row.placement ? row.name : selected"
            >
              <div class="scr-row-head">
                <div class="rr-row-main">
                  <div class="rr-row-title">{{ row.label }}</div>
                  <div class="rr-row-sub rr-mono">{{ row.name }}</div>
                </div>
                <v-select
                  :model-value="row.placement?.displayId ?? null"
                  :items="[
                    { title: 'Not shown', value: null },
                    ...setup.desktop.map((d) => ({ title: labels.get(d.id), value: d.id })),
                  ]"
                  density="compact"
                  hide-details
                  class="scr-monitor"
                  :aria-label="`Monitor for ${row.label}`"
                  :data-testid="`screens-monitor-${row.name}`"
                  @update:model-value="setMonitor(row.name, $event)"
                />
              </div>
              <div v-if="row.placement" class="scr-crop">
                <span class="rr-row-sub">Crop</span>
                <v-text-field
                  v-for="side in ['left', 'top', 'right', 'bottom'] as const"
                  :key="side"
                  :model-value="row.placement.crop[side]"
                  :label="side"
                  type="number"
                  min="0"
                  density="compact"
                  hide-details
                  class="scr-crop-field"
                  :data-testid="`screens-crop-${row.name}-${side}`"
                  @update:model-value="setCrop(row.name, side, $event)"
                />
              </div>
            </div>
            <div v-if="rows.length === 0" class="rr-row rr-muted">
              RigReady does not know which displays this aircraft can export.
            </div>
          </template>
          <div class="rr-row-sub scr-footnote">
            {{ Object.values(MAIN_VIEW_ONLY).join(', ') }} and other aircraft without exportable
            displays use the main view only. When two aircraft put the same display in different
            places, RigReady writes a per-aircraft section DCS applies when that cockpit loads.
          </div>
        </section>

        <section class="rr-panel scr-write" data-testid="screens-write">
          <h2 class="rr-section-title">What "Use in DCS" will do</h2>
          <ul v-if="generated?.errors.length" class="scr-list rr-bad" data-testid="screens-errors">
            <li v-for="e in generated.errors" :key="e">{{ e }}</li>
          </ul>
          <ul
            v-if="generated?.warnings.length"
            class="scr-list rr-warn"
            data-testid="screens-warnings"
          >
            <li v-for="w in generated.warnings" :key="w">{{ w }}</li>
          </ul>
          <ul v-if="preview" class="scr-changes" data-testid="screens-changes">
            <li>
              <strong>{{ FILE_STATUS[preview.file.status] }}</strong>
              <span class="rr-mono"> Saved Games\…\MonitorSetup\RigReady.lua</span>
            </li>
            <li v-for="c in preview.optionChanges" :key="c">
              <strong>options.lua</strong> {{ c }}
            </li>
            <li v-if="preview.optionChanges.length === 0" class="rr-muted">
              options.lua already selects it
            </li>
          </ul>
          <v-checkbox
            v-model="setResolution"
            density="compact"
            hide-details
            data-testid="screens-set-resolution"
            :label="`Also size the DCS window to ${generated?.window.width} × ${generated?.window.height}, windowed`"
          />
          <p class="rr-row-sub">
            Every change is backed up first and can be undone on the Safety page. DCS picks it up
            the next time it starts.
          </p>
          <div class="scr-actions">
            <v-btn
              variant="text"
              size="small"
              data-testid="screens-show-lua"
              @click="showLua = !showLua"
            >
              {{ showLua ? 'Hide' : 'Show' }} the file
            </v-btn>
            <v-spacer />
            <span v-if="blocked && preview" class="rr-row-sub" data-testid="screens-blocked">{{
              blocked
            }}</span>
            <v-btn
              color="primary"
              :disabled="!!blocked || nothingToDo"
              :loading="busy"
              data-testid="screens-apply"
              @click="apply()"
            >
              {{ nothingToDo ? 'In use' : 'Use in DCS' }}
            </v-btn>
          </div>
          <div v-if="done" class="scr-done" data-testid="screens-done">
            <div class="rr-ok"><v-icon icon="mdi-check" size="16" /> {{ done.message }}</div>
            <ul class="scr-list rr-muted">
              <li v-for="c in done.changes" :key="c">{{ c }}</li>
            </ul>
          </div>
          <pre v-if="showLua && preview" class="scr-lua rr-mono" data-testid="screens-lua">{{
            preview.lua
          }}</pre>
        </section>
      </div>

      <h2 class="rr-section-title scr-files-title">Monitor setups DCS can choose</h2>
      <div class="rr-panel" data-testid="screens-files">
        <div
          v-for="file in state.files"
          :key="file.path"
          class="rr-row"
          data-testid="screens-file"
          :data-stem="file.stem"
        >
          <v-icon
            :icon="file.error ? 'mdi-alert' : 'mdi-file-code-outline'"
            :class="file.error ? 'rr-warn' : 'rr-muted'"
            size="20"
          />
          <div class="rr-row-main">
            <div class="rr-row-title">
              {{ file.name }}
              <span
                v-if="state.options?.multiMonitorSetup?.toLowerCase() === file.stem.toLowerCase()"
                class="scr-in-use"
                >in use</span
              >
            </div>
            <div class="rr-row-sub">
              {{ file.stem }}.lua · {{ FOLDER[file.folder] }} · by {{ AUTHOR[file.author] }}
              <template v-if="file.exports.length">
                · {{ file.exports.map((e) => e.name).join(', ') }}</template
              >
            </div>
            <div v-if="file.description" class="rr-row-sub scr-description">
              {{ file.description }}
            </div>
            <div v-if="file.error" class="rr-row-sub rr-warn">{{ file.error }}</div>
          </div>
          <v-btn
            v-if="!file.error"
            size="small"
            variant="text"
            :data-testid="`screens-view-${file.stem}`"
            @click="viewing = viewing?.path === file.path ? undefined : file"
          >
            {{ viewing?.path === file.path ? 'Hide' : 'Show on map' }}
          </v-btn>
        </div>
        <div v-if="state.files.length === 0" class="rr-row rr-muted">
          No MonitorSetup files found.
        </div>
      </div>
    </template>

    <v-dialog v-model="confirmOverwrite" max-width="680">
      <v-card v-if="preview" data-testid="screens-overwrite">
        <v-card-title>Replace the edited RigReady.lua?</v-card-title>
        <v-card-text>
          <p class="mb-3">
            RigReady.lua was changed after RigReady last wrote it, by hand or by another program.
            This is what writing now does to it: lines marked − are in the file now and go away. The
            current file is backed up first and can be put back from the Safety page.
          </p>
          <DiffView :lines="preview.file.diff" />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            data-testid="screens-overwrite-cancel"
            @click="confirmOverwrite = false"
            >Keep their version</v-btn
          >
          <v-btn color="primary" data-testid="screens-overwrite-confirm" @click="apply(true)"
            >Replace it</v-btn
          >
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.scr-status {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  margin-bottom: 14px;
}
.scr-toolbar {
  display: flex;
  align-items: center;
  gap: 18px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.scr-layout {
  max-width: 380px;
}
.scr-main {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.scr-map-wrap {
  padding: 16px;
  margin-bottom: 16px;
}
.scr-viewing {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  margin: -6px 0 8px;
}
.scr-legend {
  margin-top: 10px;
}
.scr-columns {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
.scr-aircraft {
  padding: 10px 0 12px;
}
.scr-tabs {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  align-items: center;
  padding: 0 14px 8px;
  border-bottom: 1px solid var(--rr-border);
}
.scr-row {
  padding: 8px 14px;
  border-bottom: 1px solid var(--rr-border);
  cursor: default;
}
.scr-row.selected {
  background: var(--rr-surface-2);
}
.scr-row-head {
  display: flex;
  align-items: center;
  gap: 12px;
}
.scr-monitor {
  max-width: 220px;
}
.scr-crop {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}
.scr-crop-field {
  max-width: 84px;
}
.scr-footnote {
  padding: 10px 14px 0;
}
.scr-write {
  padding: 14px 16px;
}
.scr-list {
  margin: 0 0 8px;
  padding-left: 18px;
  font-size: 12.5px;
}
.scr-changes {
  margin: 0 0 6px;
  padding-left: 18px;
  font-size: 13px;
  display: grid;
  gap: 3px;
}
.scr-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
}
.scr-done {
  margin-top: 12px;
  font-size: 13px;
}
.scr-write :deep(.v-label) {
  font-size: 13.5px;
}
.scr-lua {
  margin-top: 12px;
  padding: 10px 12px;
  background: var(--rr-bg);
  border: 1px solid var(--rr-border);
  border-radius: 8px;
  max-height: 340px;
  overflow: auto;
  white-space: pre;
}
.scr-description {
  font-style: italic;
}
.scr-files-title {
  margin-top: 28px;
}
.scr-in-use {
  margin-left: 6px;
  font-size: 11px;
  color: var(--rr-accent);
  border: 1px solid currentColor;
  border-radius: 4px;
  padding: 0 5px;
}
</style>
