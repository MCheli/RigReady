<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { errorText, useClient } from '../../../renderer/ipc';
import { forgettable, processesContract, type OwnAppsView } from '../contract';

/**
 * Settings > Apps offered in new setups: the programs the user asked RigReady to offer in
 * every new setup ("Always offer this app" on the New setup page), with the name each is
 * shown by, whether Stand down closes it, and a way to take it off the list. Every answer
 * is the list as main read it back from the file.
 */
const api = useClient(processesContract);
const view = ref<OwnAppsView>();
const error = ref<string>();
const busy = ref<string>();
/** The name being typed, per app, until it is saved. */
const names = reactive<Record<string, string>>({});

function show(next: OwnAppsView): void {
  view.value = next;
  for (const app of next.apps) names[app.name] = app.title;
}

async function load(): Promise<void> {
  const result = await api.ownApps();
  if (result.ok) {
    show(result.value);
    error.value = undefined;
  } else error.value = errorText(result.error);
}

async function run(name: string, call: () => ReturnType<typeof api.ownApps>): Promise<void> {
  busy.value = name;
  const result = await call();
  busy.value = undefined;
  if (result.ok) {
    show(result.value);
    error.value = undefined;
  } else error.value = errorText(result.error);
}

async function rename(name: string, title: string): Promise<void> {
  const typed = (names[name] ?? '').trim();
  if (!typed || typed === title) {
    names[name] = title;
    return;
  }
  await run(name, () => api.changeOwnApp({ name, title: typed }));
}

const setClose = (name: string, value: boolean | null): Promise<void> =>
  run(name, () => api.changeOwnApp({ name, closeAtStandDown: value === true }));
const forget = (name: string): Promise<void> => run(name, () => api.forgetOwnApp({ name }));

onMounted(load);
</script>

<template>
  <div class="own" data-testid="own-apps">
    <p class="own-lead">
      Programs you asked RigReady to offer in every new setup, with "Always offer this app" on New
      setup from this rig. Each is listed with the helpers RigReady knows and ticked while it is
      running. Setups you made already keep their checks.
    </p>
    <p v-if="error" class="rr-bad" data-testid="own-apps-error">{{ error }}</p>
    <p v-if="!view && !error" class="rr-muted">Reading the list…</p>
    <template v-if="view">
      <div v-if="view.apps.length === 0" class="own-empty" data-testid="own-apps-empty">
        <span class="rr-muted"
          >None yet. On New setup from this rig, open the other running apps and choose "Always
          offer this app" on a program's row.</span
        >
        <v-btn
          size="small"
          variant="text"
          to="/configure/profiles/capture"
          data-testid="own-apps-capture"
          >New setup from this rig</v-btn
        >
      </div>
      <div
        v-for="app in view.apps"
        :key="app.name"
        class="own-row"
        data-testid="own-app"
        :data-name="app.name"
      >
        <v-icon icon="mdi-pin-outline" size="18" class="rr-muted" />
        <div class="own-main">
          <v-text-field
            v-model="names[app.name]"
            label="Shown as"
            density="compact"
            hide-details
            :disabled="busy === app.name"
            data-testid="own-app-title"
            @blur="rename(app.name, app.title)"
            @keydown.enter="rename(app.name, app.title)"
          />
          <div class="rr-row-sub rr-mono">{{ app.path }}</div>
        </div>
        <v-switch
          :model-value="app.closeAtStandDown"
          label="Close at Stand down"
          density="compact"
          hide-details
          color="primary"
          :disabled="busy === app.name"
          data-testid="own-app-close"
          @update:model-value="setClose(app.name, $event)"
        />
        <v-btn
          size="small"
          variant="text"
          prepend-icon="mdi-pin-off-outline"
          :loading="busy === app.name"
          data-testid="own-app-forget"
          @click="forget(app.name)"
          >Stop offering</v-btn
        >
      </div>
      <template v-if="view.refused.length > 0">
        <p class="own-refused-lead" data-testid="own-apps-refused-lead">
          Not used. The list is a file you can edit by hand ({{ view.file }}), and RigReady leaves
          these entries out:
        </p>
        <div
          v-for="entry in view.refused"
          :key="entry.name"
          class="own-row"
          data-testid="own-app-refused"
          :data-name="entry.name"
        >
          <v-icon icon="mdi-cancel" size="18" class="rr-muted" />
          <div class="own-main">
            <div>{{ entry.name }}</div>
            <div class="rr-row-sub">{{ entry.why }}</div>
          </div>
          <v-btn
            v-if="forgettable(entry.name)"
            size="small"
            variant="text"
            :loading="busy === entry.name"
            data-testid="own-app-refused-remove"
            @click="forget(entry.name)"
            >Remove from the list</v-btn
          >
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.own {
  padding: 14px 16px;
  font-size: 13.5px;
}
.own p {
  margin: 0 0 10px;
}
.own-lead {
  max-width: 72ch;
  color: var(--rr-text-2);
}
.own-empty {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.own-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  border-top: 1px solid var(--rr-border);
}
.own-main {
  flex: 1;
  min-width: 0;
}
.own-main .rr-row-sub {
  overflow-wrap: anywhere;
  margin-top: 2px;
}
.own-refused-lead {
  margin-top: 14px !important;
  color: var(--rr-text-2);
}
</style>
