<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import PageSkeleton from '../../../renderer/components/PageSkeleton.vue';
import { errorText, useClient } from '../../../renderer/ipc';
import { onMachineChanged } from '../../../renderer/machine';
import { racingContract, type RacingOverview } from '../contract';
import './racing.css';

const api = useClient(racingContract);
const view = ref<RacingOverview>();
const error = ref<string>();

async function load(): Promise<void> {
  const result = await api.overview();
  if (result.ok) {
    view.value = result.value;
    error.value = undefined;
  } else error.value = errorText(result.error);
}

let off: (() => void) | undefined;
onMounted(() => {
  void load();
  off = onMachineChanged(() => void load());
});
onBeforeUnmount(() => off?.());

/** A PC that never had a Fanatec base: none connected, no Fanatec software, no trace of one. */
const neverHere = computed(
  () =>
    view.value !== undefined &&
    !view.value.wheel.connected &&
    view.value.wheel.lastSeen.length === 0 &&
    view.value.wheel.software.every((s) => !s.ok)
);

const ICONS: Record<string, string> = {
  iracing: 'mdi-flag-checkered',
  lmu: 'mdi-trophy-outline',
  beamng: 'mdi-car-side',
  'assetto-corsa': 'mdi-road-variant',
};
</script>

<template>
  <div class="rr-page" data-testid="racing-page">
    <div class="rc-head">
      <div>
        <h1 class="rr-page-title">Racing</h1>
        <p class="rr-page-sub">
          Your wheel and the racing games on this PC: bindings, controller ids and backups, game by
          game.
        </p>
      </div>
    </div>

    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>
    <PageSkeleton v-if="!view && !error" label="Looking at the rig…" />

    <template v-if="view">
      <section class="rc-section">
        <h2 class="rr-section-title">Wheel</h2>
        <router-link
          to="/configure/racing/wheel"
          class="rr-panel rc-card"
          data-testid="racing-wheel-card"
        >
          <div class="rc-card-title">
            <v-icon
              :icon="
                view.wheel.connected
                  ? view.wheel.mode === 'pc'
                    ? 'mdi-check-circle'
                    : 'mdi-alert'
                  : neverHere
                    ? 'mdi-minus-circle-outline'
                    : 'mdi-close-circle'
              "
              :class="
                view.wheel.connected
                  ? view.wheel.mode === 'pc'
                    ? 'rr-ok'
                    : 'rr-warn'
                  : neverHere
                    ? 'rr-muted'
                    : 'rr-bad'
              "
            />
            {{
              view.wheel.name ??
              (neverHere ? 'No Fanatec wheel base on this PC' : 'No Fanatec wheel base connected')
            }}
            <v-spacer />
            <v-icon icon="mdi-chevron-right" class="rr-muted" />
          </div>
          <div class="rr-row-sub" data-testid="racing-wheel-summary">
            <template v-if="view.wheel.connected">
              {{
                view.wheel.mode === 'pc'
                  ? 'PC mode'
                  : 'Compatibility (yellow) mode: bindings made in PC mode do not match'
              }}
              · {{ view.wheel.controllers }} game controller{{
                view.wheel.controllers === 1 ? '' : 's'
              }}
              <template v-if="view.wheel.connection"> · {{ view.wheel.connection }}</template>
            </template>
            <template v-else-if="neverHere"
              >Nothing to set up unless you have one. Plug a base in and its page fills in by
              itself.</template
            >
            <template v-else
              >Plug the base in and switch it on. Its settings page has the presets you
              recorded.</template
            >
          </div>
        </router-link>
      </section>

      <section class="rc-section">
        <h2 class="rr-section-title">Games</h2>
        <div class="rc-cards">
          <component
            :is="game.installed ? 'router-link' : 'div'"
            v-for="game in view.games"
            :key="game.id"
            :to="`/configure/racing/${game.id}`"
            class="rr-panel rc-card"
            data-testid="racing-game-card"
            :data-game="game.id"
          >
            <div class="rc-card-title">
              <v-icon :icon="ICONS[game.id]" class="rr-muted" />
              {{ game.name }}
              <v-spacer />
              <v-chip v-if="game.running" size="x-small" variant="tonal" color="primary"
                >Running</v-chip
              >
              <v-icon v-if="game.installed" icon="mdi-chevron-right" class="rr-muted" />
            </div>
            <template v-if="game.installed">
              <div class="rr-row-sub">
                {{ game.version ?? 'Version unknown' }}
                <span v-if="game.updatePending" class="rr-warn"> · update waiting in Steam</span>
              </div>
              <div
                class="rr-row-sub"
                :class="game.attention ? 'rr-warn' : ''"
                data-testid="racing-game-bindings"
              >
                <v-icon v-if="game.attention" icon="mdi-alert" size="14" /> {{ game.bindings }}
              </div>
            </template>
            <div v-else class="rr-row-sub">Not found on this PC</div>
          </component>
        </div>
      </section>

      <section v-if="view.apps.length" class="rc-section">
        <h2 class="rr-section-title">Helper apps</h2>
        <div class="rr-panel">
          <div v-for="app in view.apps" :key="app.id" class="rr-row" data-testid="racing-app">
            <v-icon icon="mdi-cog-outline" class="rr-muted" />
            <div class="rr-row-main">
              <div class="rr-row-title">{{ app.name }}</div>
              <div class="rr-row-sub">For {{ app.purpose }}</div>
            </div>
            <span :class="app.running ? 'rr-ok' : 'rr-muted'" class="text-body-2">{{
              app.running ? 'Running' : 'Not running'
            }}</span>
          </div>
        </div>
        <p class="rc-hint mt-2">
          To have RigReady check or start them before a session, keep them when you create a setup
          from this rig.
        </p>
      </section>
    </template>
  </div>
</template>
