<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref } from 'vue';
import { manifests } from '../../../renderer/features';
import ManualLink from '../../../renderer/components/ManualLink.vue';
import { errorText, useClient } from '../../../renderer/ipc';
import type { Result } from '../../../core/result';
import { settingsContract, type SettingsView } from '../contract';
import { InOrder } from './inOrder';

/** Sections other features add for settings of their own (manifest `settings`). */
const featureSections = manifests
  .flatMap((m) => (m.settings ?? []).map((section) => ({ feature: m.id, ...section })))
  .sort((a, b) => (a.order ?? 500) - (b.order ?? 500) || a.title.localeCompare(b.title))
  .map((section) => ({
    feature: section.feature,
    title: section.title,
    view: defineAsyncComponent(section.component),
  }));

const api = useClient(settingsContract);
const view = ref<SettingsView>();
const error = ref<string>();
const saved = ref<string>();
const newLayoutName = ref('');
const renaming = ref<{ id: string; name: string }>();
/** Bumped after a refused change so the fields show the stored values again. */
const revision = ref(0);

const settings = computed(() => view.value?.settings);
const layoutChoices = computed(() => [
  { title: 'None (Stand down leaves the monitors alone)', value: '' },
  ...(view.value?.layouts ?? []).map((l) => ({ title: l.name, value: l.id })),
]);

async function run(action: Promise<Result<SettingsView>>, message: string): Promise<boolean> {
  error.value = undefined;
  saved.value = undefined;
  const result = await action;
  if (!result.ok) {
    error.value = errorText(result.error);
    revision.value++;
    return false;
  }
  view.value = result.value;
  saved.value = message;
  return true;
}

const switches = new InOrder();

/**
 * A switch moves when it is clicked, and the change follows, in the order the clicks were
 * made. The next click is then the opposite of this one also when this one has not been
 * answered yet (it used to be sent as the same value again), and the last click holds.
 */
function setSwitch(key: 'startWithWindows' | 'minimizeToTray', on: boolean): void {
  const current = view.value;
  if (!current) return;
  view.value = { ...current, settings: { ...current.settings, [key]: on } };
  error.value = undefined;
  saved.value = undefined;
  void switches
    .send(() => api.update({ [key]: on }))
    .then(async ({ result, last }) => {
      if (result.ok) {
        // With a later click on its way, what that one answers is the state to show.
        if (last) view.value = result.value;
        saved.value = 'Saved';
        return;
      }
      error.value = errorText(result.error);
      if (!last) return;
      // Refused: the switch goes back to what is stored.
      const stored = await api.get();
      if (stored.ok) view.value = stored.value;
      revision.value++;
    });
}

onMounted(async () => {
  const result = await api.get();
  if (result.ok) view.value = result.value;
  else error.value = errorText(result.error);
});

function setNumber(
  key: 'displayRevertSeconds' | 'checkTimeoutSeconds' | 'importMaxMegabytes',
  value: string
): void {
  const n = Number.parseInt(value, 10);
  if (Number.isFinite(n)) void run(api.update({ [key]: n }), 'Saved');
}

function setRetention(key: 'autoBackupDays' | 'autoBackupGroups', value: string): void {
  const n = Number.parseInt(value, 10);
  if (Number.isFinite(n)) void run(api.update({ retention: { [key]: n } }), 'Saved');
}

async function saveLayout(): Promise<void> {
  const name = newLayoutName.value.trim();
  if (!name) return;
  if (await run(api.saveCurrentLayout({ name }), `Saved the current monitors as "${name}"`)) {
    newLayoutName.value = '';
  }
}

async function confirmRename(): Promise<void> {
  if (!renaming.value) return;
  if (await run(api.renameLayout(renaming.value), 'Renamed')) renaming.value = undefined;
}

function deleteLayout(layout: { id: string; name: string }): void {
  void run(api.removeLayout({ id: layout.id }), `Deleted the layout ${layout.name}`);
}

const layoutSummary = (layout: SettingsView['layouts'][number]): string => {
  const on = layout.displays.filter((d) => d.enabled).length;
  const off = layout.displays.length - on;
  return `${on} on${off ? `, ${off} off` : ''}`;
};
</script>

<template>
  <div class="rr-page" data-testid="settings-page">
    <h1 class="rr-page-title">Settings</h1>
    <p class="rr-page-sub">
      How RigReady itself behaves. Stored in its own data folder. The
      <ManualLink page="app/settings">Manual</ManualLink> explains every setting.
    </p>

    <v-alert v-if="error" type="error" variant="tonal" class="mb-4" data-testid="settings-error">
      {{ error }}
      <ManualLink
        v-if="/startup app|start with windows/i.test(error)"
        topic="startWithWindowsOff"
      />
    </v-alert>
    <div v-if="saved" class="settings-saved rr-ok" data-testid="settings-saved">
      <v-icon icon="mdi-check" size="16" /> {{ saved }}
    </div>

    <div v-if="settings && view" :key="revision">
      <div class="rr-section-title">Startup</div>
      <div class="rr-panel settings-panel">
        <div class="rr-row">
          <div class="rr-row-main">
            <div class="rr-row-title">Start with Windows</div>
            <div class="rr-row-sub">
              Starts in the tray when you sign in.
              <span v-if="view.startWithWindowsProblem" data-testid="login-problem">
                {{ view.startWithWindowsProblem }}
                <ManualLink topic="startWithWindowsOff" />
              </span>
            </div>
          </div>
          <v-switch
            :model-value="settings.startWithWindows"
            data-testid="setting-start-with-windows"
            aria-label="Start with Windows"
            @update:model-value="setSwitch('startWithWindows', $event === true)"
          />
        </div>
        <div class="rr-row">
          <div class="rr-row-main">
            <div class="rr-row-title">Keep RigReady in the tray when you close the window</div>
            <div class="rr-row-sub" data-testid="setting-minimize-to-tray-effect">
              <template v-if="settings.minimizeToTray">
                Closing the window hides it. RigReady keeps running, with its icon in the tray next
                to the clock. Windows may keep that icon under the ^ arrow. To quit, right-click the
                icon and choose Quit.
              </template>
              <template v-else>
                Closing the window quits RigReady. Its tray icon goes away too.
              </template>
            </div>
          </div>
          <v-switch
            :model-value="settings.minimizeToTray"
            data-testid="setting-minimize-to-tray"
            aria-label="Keep RigReady in the tray when you close the window"
            @update:model-value="setSwitch('minimizeToTray', $event === true)"
          />
        </div>
      </div>

      <div class="rr-section-title">Monitor layouts</div>
      <div class="rr-panel settings-panel">
        <div class="rr-row">
          <div class="rr-row-main">
            <div class="rr-row-title">Desk layout</div>
            <div class="rr-row-sub">Stand down puts the monitors back into this layout.</div>
          </div>
          <v-select
            class="settings-select"
            :items="layoutChoices"
            :model-value="settings.deskLayoutId ?? ''"
            data-testid="setting-desk-layout"
            aria-label="Desk layout"
            @update:model-value="
              run(api.update({ deskLayoutId: $event ? String($event) : null }), 'Saved')
            "
          />
        </div>
        <div
          v-for="layout in view.layouts"
          :key="layout.id"
          class="rr-row"
          data-testid="layout-row"
          :data-layout="layout.name"
        >
          <v-icon icon="mdi-monitor-multiple" class="rr-muted" />
          <div v-if="renaming?.id === layout.id" class="rr-row-main settings-inline">
            <v-text-field
              v-model="renaming.name"
              density="compact"
              aria-label="Layout name"
              data-testid="layout-rename-input"
              @keyup.enter="confirmRename"
            />
            <v-btn
              size="small"
              color="primary"
              data-testid="layout-rename-save"
              @click="confirmRename"
            >
              Save
            </v-btn>
            <v-btn size="small" variant="text" @click="renaming = undefined">Cancel</v-btn>
          </div>
          <div v-else class="rr-row-main">
            <div class="rr-row-title">
              {{ layout.name }}
              <span v-if="settings.deskLayoutId === layout.id" class="rr-row-sub">
                · desk layout</span
              >
            </div>
            <div class="rr-row-sub">{{ layoutSummary(layout) }}</div>
          </div>
          <template v-if="renaming?.id !== layout.id">
            <v-btn
              size="small"
              variant="text"
              data-testid="layout-rename"
              @click="renaming = { id: layout.id, name: layout.name }"
            >
              Rename
            </v-btn>
            <v-btn
              size="small"
              variant="text"
              data-testid="layout-delete"
              @click="deleteLayout(layout)"
            >
              Delete
            </v-btn>
          </template>
        </div>
        <div class="rr-row">
          <div class="rr-row-main settings-inline">
            <v-text-field
              v-model="newLayoutName"
              density="compact"
              placeholder="Name, e.g. Desk"
              aria-label="Name for the current monitor layout"
              data-testid="layout-new-name"
              @keyup.enter="saveLayout"
            />
            <v-btn
              color="primary"
              :disabled="!newLayoutName.trim()"
              data-testid="layout-save-current"
              @click="saveLayout"
            >
              Save current monitors as a layout
            </v-btn>
          </div>
        </div>
      </div>

      <div class="rr-section-title">Safety and limits</div>
      <div class="rr-panel settings-panel">
        <div class="rr-row">
          <div class="rr-row-main">
            <div class="rr-row-title">Keep automatic backups for</div>
            <div class="rr-row-sub">
              Older ones are removed at startup, but the newest
              {{ settings.retention.autoBackupGroups }} changes are always kept.
            </div>
          </div>
          <v-text-field
            class="settings-number"
            type="number"
            suffix="days"
            :model-value="settings.retention.autoBackupDays"
            data-testid="setting-backup-days"
            aria-label="Days to keep automatic backups"
            @change="setRetention('autoBackupDays', ($event.target as HTMLInputElement).value)"
          />
          <v-text-field
            class="settings-number"
            type="number"
            suffix="changes"
            :model-value="settings.retention.autoBackupGroups"
            data-testid="setting-backup-groups"
            aria-label="Newest changes always kept"
            @change="setRetention('autoBackupGroups', ($event.target as HTMLInputElement).value)"
          />
        </div>
        <div class="rr-row">
          <div class="rr-row-main">
            <div class="rr-row-title">Monitor layout revert timer</div>
            <div class="rr-row-sub">
              A new layout goes back by itself unless you keep it in time.
            </div>
          </div>
          <v-text-field
            class="settings-number"
            type="number"
            suffix="s"
            :model-value="settings.displayRevertSeconds"
            data-testid="setting-revert-seconds"
            aria-label="Seconds before a monitor layout reverts"
            @change="setNumber('displayRevertSeconds', ($event.target as HTMLInputElement).value)"
          />
        </div>
        <div class="rr-row">
          <div class="rr-row-main">
            <div class="rr-row-title">Check timeout</div>
            <div class="rr-row-sub">A check that takes longer is reported as timed out.</div>
          </div>
          <v-text-field
            class="settings-number"
            type="number"
            suffix="s"
            :model-value="settings.checkTimeoutSeconds"
            data-testid="setting-check-timeout"
            aria-label="Seconds before a check times out"
            @change="setNumber('checkTimeoutSeconds', ($event.target as HTMLInputElement).value)"
          />
        </div>
        <div class="rr-row">
          <div class="rr-row-main">
            <div class="rr-row-title">Largest import</div>
            <div class="rr-row-sub">Shared setups and backups bigger than this are refused.</div>
          </div>
          <v-text-field
            class="settings-number"
            type="number"
            suffix="MB"
            :model-value="settings.importMaxMegabytes"
            data-testid="setting-import-cap"
            aria-label="Largest import in megabytes"
            @change="setNumber('importMaxMegabytes', ($event.target as HTMLInputElement).value)"
          />
        </div>
      </div>
    </div>

    <template v-for="section in featureSections" :key="`${section.feature}/${section.title}`">
      <div class="rr-section-title">{{ section.title }}</div>
      <div
        class="rr-panel settings-panel"
        data-testid="settings-feature-section"
        :data-feature="section.feature"
      >
        <component :is="section.view" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.settings-panel {
  margin-bottom: 24px;
}
.settings-saved {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  margin: -12px 0 12px;
}
.settings-select {
  max-width: 360px;
}
.settings-number {
  max-width: 150px;
  flex: 0 0 150px;
}
.settings-inline {
  display: flex;
  align-items: center;
  gap: 10px;
}
</style>
