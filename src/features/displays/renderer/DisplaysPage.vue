<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { Result } from '../../../core/result';
import { errorText, useClient } from '../../../renderer/ipc';
import { onMachineChanged } from '../../../renderer/machine';
import {
  displaysContract,
  type DisplaysView,
  type LayoutView,
  type MonitorView,
} from '../contract';
import { orientationText } from '../core/labels';
import ApplyLayoutDialog from './ApplyLayoutDialog.vue';
import EditLayoutDialog from './EditLayoutDialog.vue';
import MonitorMap from './MonitorMap.vue';

const api = useClient(displaysContract);
const view = ref<DisplaysView>();
const loadError = ref<string>();
const error = ref<string>();
const notice = ref<string>();
const identifying = ref(false);

async function load(): Promise<void> {
  const result = await api.view();
  if (result.ok) {
    view.value = result.value;
    loadError.value = undefined;
  } else {
    loadError.value = errorText(result.error);
  }
}

/** Runs a change; on success shows the new state and an optional message. */
async function act(action: Promise<Result<DisplaysView>>, message?: string): Promise<boolean> {
  error.value = undefined;
  notice.value = undefined;
  const result = await action;
  if (!result.ok) {
    error.value = errorText(result.error);
    return false;
  }
  view.value = result.value;
  if (message) notice.value = message;
  return true;
}

const monitors = computed(() => view.value?.monitors ?? []);

/** Puts back the layout from before RigReady's last change, whether it was kept or not. */
const reverting = ref(false);
async function undoLast(): Promise<void> {
  reverting.value = true;
  error.value = undefined;
  notice.value = undefined;
  const result = await api.revert();
  reverting.value = false;
  if (result.ok) notice.value = 'Put back the layout from before the last change';
  else error.value = errorText(result.error);
  await load();
}
const layouts = computed(() => view.value?.layouts ?? []);

// --- Identify and names -----------------------------------------------------------------

async function identify(): Promise<void> {
  identifying.value = true;
  error.value = undefined;
  notice.value = undefined;
  const result = await api.identify();
  identifying.value = false;
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  const { shown, off } = result.value;
  upright.value = true;
  notice.value =
    `Each monitor that is on shows its number for 5 seconds (${shown} ${shown === 1 ? 'monitor' : 'monitors'}).` +
    (off > 0
      ? ` ${off} turned-off ${off === 1 ? 'monitor cannot' : 'monitors cannot'} show one.`
      : '');
}

// "Which way is up?": offered after Identify, which draws an arrow on every screen.
const upright = ref(false);
const flipping = ref<string>();

async function flip(monitor: MonitorView): Promise<void> {
  flipping.value = monitor.id;
  error.value = undefined;
  notice.value = undefined;
  // Answers once the "Keep this layout?" question is answered.
  const result = await api.flip({ id: monitor.id });
  flipping.value = undefined;
  if (result.ok) notice.value = result.value.message;
  else error.value = errorText(result.error);
  await load();
}

async function confirmUpright(): Promise<void> {
  if (await act(api.confirmUpright(), 'Noted: every screen is the right way up.')) {
    upright.value = false;
  }
}

const naming = ref<{ id: string; name: string; suggestions: string[] }>();
const MFD_SUGGESTIONS = ['MFD left', 'MFD centre', 'MFD right'];

function startNaming(monitor: MonitorView): void {
  const taken = new Set(monitors.value.map((m) => m.friendlyName).filter(Boolean));
  naming.value = {
    id: monitor.id,
    name: monitor.friendlyName ?? '',
    suggestions: monitor.identical ? MFD_SUGGESTIONS.filter((s) => !taken.has(s)) : [],
  };
}

async function saveName(name?: string): Promise<void> {
  if (!naming.value) return;
  const value = (name ?? naming.value.name).trim();
  const id = naming.value.id;
  if (await act(api.setName({ id, name: value }), value ? `Named it "${value}"` : 'Name removed')) {
    naming.value = undefined;
  }
}

const detailLine = (m: MonitorView): string =>
  [
    `${m.width}x${m.height} at ${m.x},${m.y}`,
    `${orientationText(m.rotation)}${m.rotation ? ` (${m.rotation}°)` : ''}`,
    ...(m.refreshHz ? [`${m.refreshHz} Hz`] : []),
  ].join(' · ');

const identityLine = (m: MonitorView): string => {
  const port = m.id.split('#')[2];
  return [
    m.connector,
    m.edid,
    m.serial ? `serial ${m.serial}` : 'no serial',
    m.usbSerial ? `USB device ${m.usbSerial}` : undefined,
    // The port only matters for a monitor that nothing else identifies.
    m.toldApartBy === 'port' && port ? `port ${port}` : undefined,
    m.gdiName,
  ]
    .filter(Boolean)
    .join(' · ');
};

// --- Saved layouts ------------------------------------------------------------------------

const saveOpen = ref(false);
const saveName_ = ref('');
const renaming = ref<{ id: string; name: string }>();
const deleting = ref<LayoutView>();
const editing = ref<LayoutView>();
const applying = ref<string>();
const expanded = ref(new Set<string>());

async function saveCurrent(): Promise<void> {
  const name = saveName_.value.trim();
  if (!name) return;
  if (await act(api.saveLayout({ name }), `Saved the monitors as they are now as "${name}"`)) {
    saveOpen.value = false;
    saveName_.value = '';
  }
}

async function confirmRename(): Promise<void> {
  if (!renaming.value) return;
  const { id, name } = renaming.value;
  if (await act(api.renameLayout({ id, name }), `Renamed to "${name.trim()}"`)) {
    renaming.value = undefined;
  }
}

async function confirmDelete(): Promise<void> {
  if (!deleting.value) return;
  const { id, name } = deleting.value;
  if (await act(api.removeLayout({ id }), `Deleted "${name}"`)) deleting.value = undefined;
}

function toggleDesk(layout: LayoutView): void {
  void act(
    api.setDeskLayout({ id: layout.isDesk ? null : layout.id }),
    layout.isDesk
      ? 'Stand down no longer changes the monitors'
      : `Stand down now puts the monitors back to "${layout.name}"`
  );
}

function replaceWithCurrent(layout: LayoutView): void {
  void act(
    api.updateLayout({ id: layout.id }),
    `"${layout.name}" now holds the monitors as they are`
  );
}

function toggleExpanded(id: string): void {
  const next = new Set(expanded.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expanded.value = next;
}

function onApplied(message: string): void {
  applying.value = undefined;
  notice.value = message;
  void load();
}

function onEdited(next: DisplaysView): void {
  const name = editing.value?.name;
  editing.value = undefined;
  view.value = next;
  notice.value = `Saved "${name}"`;
}

const statusText = (l: LayoutView): string => {
  if (l.status === 'current') return 'In use now';
  if (l.status === 'incomplete') {
    return `${l.missing.join(', ')} not connected`;
  }
  return `${l.differences.length} ${l.differences.length === 1 ? 'difference' : 'differences'}`;
};

let stop: (() => void) | undefined;
onMounted(() => {
  stop = onMachineChanged(() => void load());
  return load();
});
onBeforeUnmount(() => stop?.());
</script>

<template>
  <div class="rr-page" data-testid="displays-page">
    <div class="d-flex align-start ga-2">
      <div>
        <h1 class="rr-page-title">Monitors</h1>
        <p class="rr-page-sub">
          How Windows has the monitors arranged right now, and the layouts you saved for flying,
          racing and the desk. A setup checks its layout and puts it back with Make ready.
        </p>
      </div>
      <v-spacer />
      <v-btn
        v-if="view?.canRevert"
        variant="text"
        prepend-icon="mdi-undo"
        :loading="reverting"
        data-testid="displays-undo"
        @click="undoLast"
      >
        Undo last change
      </v-btn>
      <v-btn
        variant="tonal"
        prepend-icon="mdi-numeric"
        :loading="identifying"
        :disabled="!monitors.some((m) => m.enabled)"
        data-testid="identify"
        @click="identify"
      >
        Identify
      </v-btn>
      <v-btn variant="text" prepend-icon="mdi-refresh" data-testid="displays-refresh" @click="load">
        Refresh
      </v-btn>
    </div>

    <v-alert
      v-if="loadError"
      type="error"
      variant="tonal"
      class="mb-4"
      data-testid="displays-load-error"
    >
      {{ loadError }}
      <template #append>
        <v-btn variant="text" size="small" @click="load">Try again</v-btn>
      </template>
    </v-alert>
    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      class="mb-4"
      closable
      data-testid="displays-error"
      @click:close="error = undefined"
    >
      {{ error }}
    </v-alert>
    <v-alert
      v-if="notice"
      type="info"
      variant="tonal"
      class="mb-4"
      closable
      data-testid="displays-notice"
      @click:close="notice = undefined"
    >
      {{ notice }}
    </v-alert>

    <div v-if="upright && view" class="rr-panel displays-upright" data-testid="upright-panel">
      <div class="rr-row">
        <v-icon icon="mdi-arrow-up-bold-outline" size="22" />
        <div class="rr-row-main">
          <div class="rr-row-title">Which way is up?</div>
          <div class="rr-row-sub">
            Each screen shows its number and an arrow, which must point up. A screen mounted on its
            side can be upright in two ways, and only you can see which. If the arrow points down on
            a screen, turn that screen here; you get the usual time to keep it or go back.
          </div>
        </div>
        <v-btn
          color="primary"
          variant="tonal"
          data-testid="upright-confirm"
          @click="confirmUpright"
        >
          All arrows point up
        </v-btn>
        <v-btn variant="text" size="small" data-testid="upright-close" @click="upright = false">
          Not now
        </v-btn>
      </div>
      <div
        v-for="m in monitors.filter((o) => o.enabled)"
        :key="m.id"
        class="rr-row"
        data-testid="upright-row"
        :data-label="m.label"
      >
        <div class="displays-num">{{ m.number }}</div>
        <div class="rr-row-main">
          <div class="rr-row-title">{{ m.label }}</div>
          <div class="rr-row-sub">
            {{ orientationText(m.rotation) }}{{ m.rotation ? ` (${m.rotation}°)` : '' }}
            <span v-if="m.uprightConfirmed" data-testid="upright-confirmed">
              · you have seen it the right way up</span
            >
          </div>
        </div>
        <v-btn
          size="small"
          variant="text"
          prepend-icon="mdi-rotate-3d-variant"
          :loading="flipping === m.id"
          :disabled="flipping !== undefined"
          data-testid="upright-flip"
          @click="flip(m)"
        >
          Arrow points down: turn it
        </v-btn>
      </div>
    </div>

    <template v-if="view">
      <div class="rr-section-title">Right now</div>
      <div class="rr-panel displays-map-wrap" data-testid="displays-map">
        <MonitorMap :monitors="monitors" :max-height="300" />
      </div>

      <div class="rr-panel displays-list">
        <div
          v-for="m in monitors"
          :key="m.id"
          class="rr-row"
          data-testid="display-row"
          :data-label="m.label"
        >
          <div class="displays-num" :class="{ off: !m.enabled }">
            <template v-if="m.number !== undefined">{{ m.number }}</template>
            <v-icon v-else icon="mdi-monitor-off" size="16" />
          </div>
          <div v-if="naming?.id === m.id" class="rr-row-main">
            <div class="displays-inline">
              <v-text-field
                v-model="naming.name"
                density="compact"
                hide-details
                autofocus
                :placeholder="m.name || 'Name'"
                aria-label="Monitor name"
                data-testid="display-name-input"
                @keyup.enter="saveName()"
                @keyup.escape="naming = undefined"
              />
              <v-btn
                color="primary"
                size="small"
                data-testid="display-name-save"
                @click="saveName()"
              >
                Save
              </v-btn>
              <v-btn size="small" variant="text" @click="naming = undefined">Cancel</v-btn>
            </div>
            <div v-if="naming.suggestions.length" class="displays-suggest">
              <span class="rr-muted">Suggestions:</span>
              <v-chip
                v-for="s in naming.suggestions"
                :key="s"
                size="small"
                variant="outlined"
                data-testid="display-name-suggestion"
                @click="saveName(s)"
              >
                {{ s }}
              </v-chip>
            </div>
          </div>
          <div v-else class="rr-row-main">
            <div class="rr-row-title">
              {{ m.label }}
              <span v-if="m.friendlyName" class="rr-muted"> · {{ m.name }}</span>
              <span v-if="m.primary" class="displays-main"> · main display</span>
            </div>
            <div v-if="m.enabled" class="rr-row-sub">{{ detailLine(m) }}</div>
            <div v-else class="rr-row-sub">Connected, turned off</div>
            <div class="rr-row-sub rr-mono">{{ identityLine(m) }}</div>
            <div
              v-if="m.identical && !m.friendlyName"
              class="rr-row-sub displays-hint"
              data-testid="display-identical-hint"
            >
              Identical to other connected monitors. Use Identify to see which screen this is, then
              name it.
            </div>
            <div
              v-if="m.identical"
              class="rr-row-sub"
              data-testid="display-told-apart"
              :data-by="m.toldApartBy"
            >
              <template v-if="m.toldApartBy === 'serial'">
                Told apart by the USB device it hangs off: it keeps its name and place in a layout
                on any USB port.
              </template>
              <template v-else>
                Told apart only by the port it is plugged into: keep it on this port.
              </template>
            </div>
          </div>
          <v-btn
            v-if="naming?.id !== m.id"
            size="small"
            variant="text"
            prepend-icon="mdi-pencil-outline"
            data-testid="display-name"
            @click="startNaming(m)"
          >
            {{ m.friendlyName ? 'Rename' : 'Name' }}
          </v-btn>
        </div>
        <div v-if="monitors.length === 0" class="rr-empty" data-testid="displays-none">
          Windows reports no monitors.
        </div>
      </div>

      <div class="d-flex align-center displays-layouts-head">
        <div class="rr-section-title mb-0">Saved layouts</div>
        <v-spacer />
        <v-btn
          color="primary"
          variant="tonal"
          prepend-icon="mdi-content-save-outline"
          data-testid="layout-save-open"
          @click="saveOpen = true"
        >
          Save current as layout
        </v-btn>
      </div>

      <v-alert
        v-if="view.layoutsError"
        type="error"
        variant="tonal"
        class="mb-4"
        data-testid="layouts-error"
      >
        {{ view.layoutsError }}
      </v-alert>

      <div
        v-if="!layouts.length && !view.layoutsError"
        class="rr-panel rr-empty"
        data-testid="layouts-empty"
      >
        <v-icon icon="mdi-monitor-multiple" size="32" class="mb-2" />
        <div>No saved layouts yet.</div>
        <div class="rr-row-sub">
          Arrange the monitors the way you fly, race or work in Windows, then save them here.
        </div>
      </div>

      <div class="displays-layouts">
        <div
          v-for="l in layouts"
          :key="l.id"
          class="rr-panel displays-layout"
          data-testid="layout-card"
          :data-layout="l.name"
          :data-status="l.status"
        >
          <div class="displays-layout-head">
            <div class="displays-layout-title">
              <span class="rr-row-title">{{ l.name }}</span>
              <span v-if="l.isDesk" class="displays-badge" data-testid="layout-desk-badge">
                Desk layout
              </span>
            </div>
            <v-menu location="bottom end">
              <template #activator="{ props: menu }">
                <v-btn
                  v-bind="menu"
                  icon="mdi-dots-vertical"
                  size="small"
                  variant="text"
                  :aria-label="`More for ${l.name}`"
                  data-testid="layout-menu"
                />
              </template>
              <v-list density="compact">
                <v-list-item
                  prepend-icon="mdi-form-textbox"
                  title="Rename"
                  data-testid="layout-rename"
                  @click="renaming = { id: l.id, name: l.name }"
                />
                <v-list-item
                  prepend-icon="mdi-pencil-ruler"
                  title="Edit arrangement"
                  data-testid="layout-edit"
                  @click="editing = l"
                />
                <v-list-item
                  prepend-icon="mdi-monitor-arrow-down"
                  title="Replace with the monitors as they are now"
                  data-testid="layout-replace"
                  @click="replaceWithCurrent(l)"
                />
                <v-list-item
                  :prepend-icon="l.isDesk ? 'mdi-desk' : 'mdi-desk'"
                  :title="l.isDesk ? 'Stop using as desk layout' : 'Use as desk layout'"
                  data-testid="layout-desk"
                  @click="toggleDesk(l)"
                />
                <v-list-item
                  prepend-icon="mdi-delete-outline"
                  title="Delete"
                  data-testid="layout-delete"
                  @click="deleting = l"
                />
              </v-list>
            </v-menu>
          </div>
          <div class="displays-layout-map">
            <MonitorMap :monitors="l.monitors" :max-height="120" compact />
          </div>
          <div class="displays-layout-foot">
            <button
              v-if="l.status !== 'current'"
              type="button"
              class="displays-status"
              :class="l.status === 'incomplete' ? 'rr-warn' : 'rr-muted'"
              data-testid="layout-status"
              @click="toggleExpanded(l.id)"
            >
              <v-icon
                :icon="expanded.has(l.id) ? 'mdi-chevron-down' : 'mdi-chevron-right'"
                size="16"
              />
              {{ statusText(l) }}
            </button>
            <span v-else class="displays-status rr-ok" data-testid="layout-status">
              <v-icon icon="mdi-check" size="16" /> {{ statusText(l) }}
            </span>
            <v-spacer />
            <v-btn
              v-if="l.status !== 'current'"
              size="small"
              color="primary"
              variant="tonal"
              data-testid="layout-apply"
              @click="applying = l.id"
            >
              Apply…
            </v-btn>
          </div>
          <ul v-if="expanded.has(l.id)" class="displays-diff" data-testid="layout-differences">
            <li v-for="line in l.differences" :key="line">{{ line }}</li>
          </ul>
        </div>
      </div>
    </template>
    <div v-else-if="!loadError" class="rr-empty">Reading the monitors…</div>

    <!-- Save current -->
    <v-dialog v-model="saveOpen" max-width="440">
      <v-card data-testid="layout-save-dialog">
        <v-card-title>Save the current monitors</v-card-title>
        <v-card-text>
          <p class="rr-muted mb-3">
            Saves which monitors are on, where they are, how they are turned and which one is the
            main display.
          </p>
          <v-text-field
            v-model="saveName_"
            label="Layout name"
            placeholder="e.g. Flying"
            autofocus
            data-testid="layout-save-name"
            @keyup.enter="saveCurrent"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="saveOpen = false">Cancel</v-btn>
          <v-btn
            color="primary"
            variant="flat"
            :disabled="!saveName_.trim()"
            data-testid="layout-save"
            @click="saveCurrent"
          >
            Save
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Rename -->
    <v-dialog
      :model-value="renaming !== undefined"
      max-width="440"
      @update:model-value="renaming = undefined"
    >
      <v-card v-if="renaming" data-testid="layout-rename-dialog">
        <v-card-title>Rename layout</v-card-title>
        <v-card-text>
          <v-text-field
            v-model="renaming.name"
            label="Layout name"
            autofocus
            data-testid="layout-rename-input"
            @keyup.enter="confirmRename"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="renaming = undefined">Cancel</v-btn>
          <v-btn
            color="primary"
            variant="flat"
            :disabled="!renaming.name.trim()"
            data-testid="layout-rename-save"
            @click="confirmRename"
          >
            Rename
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Delete -->
    <v-dialog
      :model-value="deleting !== undefined"
      max-width="460"
      @update:model-value="deleting = undefined"
    >
      <v-card v-if="deleting" data-testid="layout-delete-dialog">
        <v-card-title>Delete "{{ deleting.name }}"?</v-card-title>
        <v-card-text>
          The monitors are not changed.
          <template v-if="deleting.isDesk">
            It is the desk layout, so Stand down will no longer change the monitors.
          </template>
          Setups that use this layout keep checking against their own copy of it.
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="deleting = undefined">Cancel</v-btn>
          <v-btn
            color="error"
            variant="flat"
            data-testid="layout-delete-confirm"
            @click="confirmDelete"
          >
            Delete
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <ApplyLayoutDialog :layout-id="applying" @close="applying = undefined" @applied="onApplied" />
    <EditLayoutDialog :layout="editing" @close="editing = undefined" @saved="onEdited" />
  </div>
</template>

<style scoped>
.displays-map-wrap {
  padding: 16px;
  margin-bottom: 12px;
}
.displays-list {
  margin-bottom: 28px;
}
.displays-num {
  flex: 0 0 26px;
  height: 26px;
  border-radius: 13px;
  background: var(--rr-accent);
  color: #0f1317;
  font-weight: 700;
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.displays-upright {
  margin-bottom: 16px;
}
.displays-num.off {
  background: var(--rr-surface-2);
  color: var(--rr-muted);
}
.displays-main {
  color: var(--rr-accent);
  font-weight: 400;
}
.displays-hint {
  color: var(--rr-text);
  opacity: 0.8;
}
.displays-inline {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 460px;
}
.displays-suggest {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  font-size: 12.5px;
}
.displays-layouts-head {
  margin-bottom: 10px;
}
.displays-layouts {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 14px;
}
.displays-layout {
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
}
.displays-layout-head {
  display: flex;
  align-items: center;
}
.displays-layout-title {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.displays-badge {
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 9px;
  border: 1px solid var(--rr-accent);
  color: var(--rr-accent);
}
.displays-layout-map {
  padding: 10px 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.displays-layout-foot {
  display: flex;
  align-items: center;
  min-height: 32px;
}
.displays-status {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 13px;
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
}
span.displays-status {
  cursor: default;
}
.displays-diff {
  margin: 8px 0 0;
  padding-left: 20px;
  font-size: 12.5px;
  color: var(--rr-muted);
}
</style>
