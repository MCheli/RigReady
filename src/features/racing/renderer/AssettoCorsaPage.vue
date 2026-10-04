<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import NotOnThisPc from '../../../renderer/components/NotOnThisPc.vue';
import { errorText, useClient } from '../../../renderer/ipc';
import { onMachineChanged } from '../../../renderer/machine';
import { racingContract, type AcView } from '../contract';
import BackupsPanel from './BackupsPanel.vue';
import StateChip from './StateChip.vue';
import './racing.css';

const api = useClient(racingContract);
const view = ref<AcView>();
const error = ref<string>();

async function load(): Promise<void> {
  const result = await api.assettoCorsa();
  if (result.ok) view.value = result.value;
  else error.value = errorText(result.error);
}

let off: (() => void) | undefined;
onMounted(() => {
  void load();
  off = onMachineChanged(() => void load());
});
onBeforeUnmount(() => off?.());
</script>

<template>
  <div class="rr-page" data-testid="ac-page">
    <router-link to="/configure/racing" class="rc-crumb"
      ><v-icon icon="mdi-chevron-left" size="16" />Racing</router-link
    >
    <div class="rc-head">
      <div>
        <h1 class="rr-page-title">Assetto Corsa</h1>
        <p class="rr-page-sub">
          Bindings and force feedback from <span class="rr-mono">controls.ini</span>
        </p>
      </div>
      <v-spacer />
      <v-btn
        variant="text"
        prepend-icon="mdi-information-outline"
        to="/configure/games/assetto-corsa"
        >Install and files</v-btn
      >
    </div>

    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>

    <template v-if="view">
      <NotOnThisPc
        v-if="!view.installed && !view.controlsFile"
        name="Assetto Corsa"
        :looked="['every Steam library', 'Documents\\Assetto Corsa']"
        game-page="/configure/games/assetto-corsa"
        data-testid="ac-missing"
      />
      <div v-for="p in view.problems" :key="p" class="rc-notice bad">
        <v-icon icon="mdi-alert-circle" class="rr-bad" />
        <div>{{ p }}</div>
      </div>

      <section v-if="view.controllers.length" class="rc-section">
        <div class="rc-section-head">
          <h2 class="rr-section-title">Controllers</h2>
          <span v-if="view.inputMethod" class="rc-hint"
            >Input method: {{ view.inputMethod.toLowerCase() }}</span
          >
        </div>
        <div class="rr-panel">
          <div
            v-for="c in view.controllers"
            :key="c.index"
            class="rr-row"
            data-testid="ac-controller"
          >
            <v-icon icon="mdi-steering" class="rr-muted" />
            <div class="rr-row-main">
              <div class="rr-row-title">{{ c.name }}</div>
              <div class="rr-row-sub">
                Controller {{ c.index }}{{ c.used ? '' : ' · no bindings use it' }} · id
                <span class="rr-mono"
                  >{{ c.instanceGuid.slice(0, 8) }}…{{ c.instanceGuid.slice(19, 23) }}</span
                >
              </div>
            </div>
            <StateChip v-if="c.used" :state="c.state" />
            <span v-else class="rr-row-sub">Not used</span>
          </div>
        </div>
        <div
          v-if="
            view.controllers.some((c) => c.used && (c.state === 'moved' || c.state === 'missing'))
          "
          class="rc-notice warn mt-3"
          data-testid="ac-offline"
        >
          <v-icon icon="mdi-alert" class="rr-warn" />
          <div>
            Assetto Corsa refers to controllers by their Windows id, and a controller it uses is not
            connected under that id. Bind it again in the game or Content Manager, or restore a
            backup taken while it worked.
          </div>
        </div>
        <p class="rc-hint mt-2">
          A wheel base can show up as two controllers with the same name; the one without bindings
          is expected.
        </p>
      </section>

      <section v-if="view.bindings.length" class="rc-section">
        <h2 class="rr-section-title">Bindings</h2>
        <div class="rr-panel">
          <table class="rc-table" data-testid="ac-bindings">
            <tr>
              <th>Action</th>
              <th>Input</th>
              <th>Controller</th>
            </tr>
            <tr
              v-for="b in view.bindings"
              :key="`${b.action}|${b.controller}`"
              data-testid="binding-row"
            >
              <td>{{ b.label }}</td>
              <td class="rc-input">{{ b.input }}</td>
              <td class="rr-muted">{{ b.controller }}</td>
            </tr>
          </table>
        </div>
      </section>

      <section v-if="view.forceFeedback.length" class="rc-section">
        <h2 class="rr-section-title">Force feedback</h2>
        <div class="rr-panel rc-grid">
          <div v-for="p in view.forceFeedback" :key="p.label" class="rc-pair">
            <span class="rc-pair-label">{{ p.label }}</span
            ><span class="rc-pair-value">{{ p.value }}</span>
          </div>
        </div>
      </section>

      <div
        v-if="view.controlsFile && view.bindings.length === 0 && view.controllers.length === 0"
        class="rr-panel rr-empty"
      >
        Assetto Corsa has no controls set up yet.
      </div>

      <BackupsPanel
        v-if="view.controlsFile"
        game="assetto-corsa"
        what="Assetto Corsa controls"
        closed-hint="Close Assetto Corsa and Content Manager first; restoring while they run is refused."
        @restored="load"
      />
    </template>
  </div>
</template>
