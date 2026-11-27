<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import EmptyState from '../../../renderer/components/EmptyState.vue';
import NotOnThisPc from '../../../renderer/components/NotOnThisPc.vue';
import PageSkeleton from '../../../renderer/components/PageSkeleton.vue';
import { errorText, useClient } from '../../../renderer/ipc';
import { onMachineChanged } from '../../../renderer/machine';
import { nuclearOptionBindingsContract, type Overview, type OverviewDevice } from '../contract';
import { shownBindings } from './rows';

/**
 * Nuclear Option's bindings as the game saved them, one controller at a time. Read only:
 * the game keeps them in the registry, which RigReady does not write.
 */
const api = useClient(nuclearOptionBindingsContract);
const route = useRoute();

const overview = ref<Overview>();
const error = ref('');
const selected = ref('');
const search = ref('');

const device = computed<OverviewDevice | undefined>(
  () => overview.value?.devices.find((d) => d.id === selected.value) ?? overview.value?.devices[0]
);
const rows = computed(() =>
  device.value ? shownBindings(device.value.bindings, search.value) : []
);

/** The controller a link asked for (`?guid=`), when it is one the game has bindings for. */
function fromLink(view: Overview): string | undefined {
  const guid = typeof route.query.guid === 'string' ? route.query.guid.toUpperCase() : '';
  return guid ? view.devices.find((d) => d.guid?.toUpperCase() === guid)?.id : undefined;
}

async function load(): Promise<void> {
  const result = await api.overview();
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  error.value = '';
  overview.value = result.value;
  const still = result.value.devices.some((d) => d.id === selected.value);
  if (!still) selected.value = fromLink(result.value) ?? result.value.devices[0]?.id ?? '';
}

let off: (() => void) | undefined;
onMounted(() => {
  void load();
  off = onMachineChanged(() => void load());
});
onBeforeUnmount(() => off?.());
watch(
  () => route.query.guid,
  () => {
    const wanted = overview.value ? fromLink(overview.value) : undefined;
    if (wanted) selected.value = wanted;
  }
);

const cheatSheet = computed(() => ({
  path: '/configure/cheat-sheets',
  query: { game: 'nuclear-option', aircraft: 'all' },
}));

const deviceIcon = (d: OverviewDevice): string =>
  d.kind === 'keyboard'
    ? 'mdi-keyboard-outline'
    : d.kind === 'mouse'
      ? 'mdi-mouse'
      : 'mdi-controller';
</script>

<template>
  <div class="rr-page" data-testid="nuclear-option-bindings-page">
    <div class="nb-head">
      <div>
        <h1 class="rr-page-title">Nuclear Option bindings</h1>
        <p class="rr-page-sub">
          What each button, axis and key does in Nuclear Option, as the game saved it. One set of
          bindings serves every aircraft.
        </p>
      </div>
      <v-spacer />
      <v-btn
        v-if="overview?.saved"
        variant="text"
        prepend-icon="mdi-card-text-outline"
        :to="cheatSheet"
        data-testid="nuclear-option-bindings-cheat-sheet"
        >Cheat sheet</v-btn
      >
      <v-btn
        variant="text"
        prepend-icon="mdi-information-outline"
        to="/configure/games/nuclear-option"
        data-testid="nuclear-option-bindings-game-link"
        >Install and files</v-btn
      >
    </div>

    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      class="mb-4"
      data-testid="nuclear-option-bindings-error"
      >{{ error }}</v-alert
    >
    <PageSkeleton v-if="!overview && !error" label="Reading Nuclear Option’s bindings…" />

    <template v-if="overview">
      <NotOnThisPc
        v-if="!overview.installed && !overview.saved"
        name="Nuclear Option"
        :looked="['every Steam library', 'the settings the game saves in the Windows registry']"
        game-page="/configure/games/nuclear-option"
      />
      <EmptyState
        v-else-if="!overview.saved"
        art="file"
        title="Nuclear Option has saved no bindings yet"
        data-testid="nuclear-option-bindings-empty"
      >
        The game saves its bindings the first time it runs. Start it once, then come back.
        <template #action>
          <v-btn variant="tonal" to="/configure/games/nuclear-option">Open Nuclear Option</v-btn>
        </template>
      </EmptyState>

      <template v-else>
        <v-alert
          v-for="problem in overview.problems"
          :key="problem"
          type="warning"
          variant="tonal"
          class="mb-4"
          data-testid="nuclear-option-bindings-problem"
          >{{ problem }}</v-alert
        >

        <div class="rr-panel nb-note" data-testid="nuclear-option-bindings-note">
          <v-icon icon="mdi-eye-outline" class="rr-muted" />
          <div>
            RigReady shows these bindings and does not change them: change one in the game, under
            Settings, then Controls. They are read from
            <span class="rr-mono">{{ overview.registryKey }}</span>.
          </div>
        </div>

        <div class="nb-devices" role="tablist" aria-label="Devices">
          <v-btn
            v-for="d in overview.devices"
            :key="d.id"
            role="tab"
            :aria-selected="d.id === device?.id"
            :variant="d.id === device?.id ? 'tonal' : 'text'"
            :prepend-icon="deviceIcon(d)"
            class="nb-device"
            data-testid="nuclear-option-bindings-device"
            :data-device="d.name"
            @click="selected = d.id"
          >
            {{ d.name }}
            <span class="nb-count rr-muted">{{ d.bindings.length }}</span>
          </v-btn>
        </div>

        <template v-if="device">
          <div class="nb-device-head">
            <h2 class="rr-section-title" data-testid="nuclear-option-bindings-device-title">
              {{ device.name }}
            </h2>
            <span
              v-if="device.kind === 'controller'"
              class="nb-state"
              :class="device.connected ? 'rr-ok' : 'rr-muted'"
              data-testid="nuclear-option-bindings-device-state"
            >
              <v-icon
                :icon="device.connected ? 'mdi-check-circle-outline' : 'mdi-power-plug-off-outline'"
                size="small"
              />
              {{ device.connected ? 'Plugged in' : 'Not plugged in' }}
            </span>
            <v-spacer />
            <v-text-field
              v-model="search"
              density="compact"
              variant="outlined"
              hide-details
              clearable
              prepend-inner-icon="mdi-magnify"
              label="Find an action or input"
              class="nb-search"
              data-testid="nuclear-option-bindings-search"
            />
          </div>

          <div
            v-if="device.kind === 'controller' && !device.connected"
            class="rr-muted nb-hint"
            data-testid="nuclear-option-bindings-unplugged"
          >
            This controller is not plugged in, so its axes are named in the usual order (X, Y, Z,
            then the rotations).
          </div>

          <div class="rr-panel">
            <table class="nb-table" data-testid="nuclear-option-bindings-table">
              <thead>
                <tr>
                  <th scope="col">Action</th>
                  <th scope="col">Group</th>
                  <th scope="col">Input</th>
                  <th scope="col">In the game</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(b, i) in rows"
                  :key="`${b.actionId}-${b.input}-${b.mapCategory}-${i}`"
                  data-testid="nuclear-option-bindings-row"
                >
                  <td class="nb-action">{{ b.action }}</td>
                  <td class="rr-muted">
                    {{ b.category
                    }}<span v-if="b.mapCategory !== 'Game'"> · {{ b.mapCategory }}</span>
                  </td>
                  <td>
                    <span v-if="b.modifiers.length" class="rr-muted"
                      >{{ b.modifiers.join(' + ') }} + </span
                    >{{ b.inputLabel }}<span v-if="b.inverted" class="rr-muted"> · reversed</span>
                  </td>
                  <td class="rr-mono rr-muted">{{ b.input }}</td>
                </tr>
                <tr v-if="rows.length === 0">
                  <td colspan="4" class="rr-muted" data-testid="nuclear-option-bindings-none">
                    {{
                      device.bindings.length === 0
                        ? 'Nothing is bound on this device.'
                        : 'Nothing bound on this device matches.'
                    }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="device.kind === 'controller'" class="rr-muted nb-hint">
            The game counts a controller’s buttons from 0, so its “Button 4” is the fifth button,
            Button 5 here and on the cheat sheets.
          </p>
        </template>
      </template>
    </template>
  </div>
</template>

<style scoped>
.nb-head {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 16px;
}
.nb-note {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 12px 16px;
  margin-bottom: 16px;
}
.nb-devices {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 16px;
}
.nb-device {
  text-transform: none;
}
.nb-count {
  margin-left: 8px;
  font-size: var(--rr-text-xs);
}
.nb-device-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}
.nb-state {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--rr-text-sm);
}
.nb-search {
  max-width: 320px;
}
.nb-hint {
  margin: 8px 0;
  font-size: var(--rr-text-sm);
}
.nb-table {
  width: 100%;
  border-collapse: collapse;
}
.nb-table th,
.nb-table td {
  text-align: left;
  padding: 8px 16px;
  border-bottom: 1px solid var(--rr-border);
}
.nb-table tbody tr:last-child td {
  border-bottom: 0;
}
.nb-table th {
  font-size: var(--rr-text-xs);
  color: var(--rr-text-2);
  font-weight: 600;
}
.nb-action {
  font-weight: 500;
}
</style>
