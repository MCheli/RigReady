<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import ConfirmChanges from '../../../renderer/components/ConfirmChanges.vue';
import NotOnThisPc from '../../../renderer/components/NotOnThisPc.vue';
import { errorText, useClient } from '../../../renderer/ipc';
import { notifyMachineChanged, onMachineChanged } from '../../../renderer/machine';
import { racingContract, type LmuView, type WritePreviewView } from '../contract';
import BackupsPanel from './BackupsPanel.vue';
import StateChip from './StateChip.vue';
import './racing.css';

const api = useClient(racingContract);
const view = ref<LmuView>();
const error = ref<string>();
const message = ref<string>();
const filter = ref('');

async function load(): Promise<void> {
  const result = await api.lmu();
  if (result.ok) view.value = result.value;
  else error.value = errorText(result.error);
}

let off: (() => void) | undefined;
onMounted(() => {
  void load();
  off = onMachineChanged(() => void load());
});
onBeforeUnmount(() => off?.());

const rows = computed(() => {
  const text = filter.value.trim().toLowerCase();
  return (view.value?.bindings ?? []).filter(
    (b) => !text || `${b.action} ${b.input} ${b.deviceName}`.toLowerCase().includes(text)
  );
});
const offline = computed(
  () => view.value?.devices.filter((d) => d.state === 'missing' || d.state === 'other-mode') ?? []
);

/** Controllers Windows renamed that RigReady can put right; the repair covers all of them. */
const renamed = computed(() => view.value?.devices.filter((d) => d.rename) ?? []);
const confirming = ref(false);
const repairing = ref(false);
/** What the repair would change; loaded when the confirmation opens. */
const repairPreview = ref<WritePreviewView>();
const repairPreviewError = ref<string>();

async function askRepair(): Promise<void> {
  repairPreview.value = undefined;
  repairPreviewError.value = undefined;
  confirming.value = true;
  const result = await api.lmuRepairPreview();
  if (!confirming.value) return;
  if (result.ok) repairPreview.value = result.value;
  else repairPreviewError.value = errorText(result.error);
}

async function repair(): Promise<void> {
  repairing.value = true;
  error.value = undefined;
  message.value = undefined;
  const result = await api.lmuRepair();
  repairing.value = false;
  confirming.value = false;
  if (result.ok) {
    message.value = result.value.message;
    notifyMachineChanged();
  } else error.value = errorText(result.error);
  await load();
}
</script>

<template>
  <div class="rr-page" data-testid="lmu-page">
    <router-link to="/configure/racing" class="rc-crumb"
      ><v-icon icon="mdi-chevron-left" size="16" />Racing</router-link
    >
    <div class="rc-head">
      <div>
        <h1 class="rr-page-title">Le Mans Ultimate</h1>
        <p class="rr-page-sub">
          Bindings and force feedback from
          <span class="rr-mono">{{ view?.userFolder ?? 'UserData\\player' }}</span>
        </p>
      </div>
      <v-spacer />
      <v-btn variant="text" prepend-icon="mdi-information-outline" to="/configure/games/lmu"
        >Install and files</v-btn
      >
    </div>

    <v-alert v-if="error" type="error" variant="tonal" class="mb-4" data-testid="lmu-error">{{
      error
    }}</v-alert>
    <div v-if="message" class="rc-message rr-ok" data-testid="lmu-message">
      <v-icon icon="mdi-check" size="16" /> {{ message }}
    </div>

    <template v-if="view">
      <NotOnThisPc
        v-if="!view.installed"
        name="Le Mans Ultimate"
        :looked="['every Steam library']"
        game-page="/configure/games/lmu"
        data-testid="lmu-missing"
      />
      <div v-if="view.updatePending" class="rc-notice warn" data-testid="lmu-update">
        <v-icon icon="mdi-update" class="rr-warn" />
        <div>
          Steam has an update waiting for Le Mans Ultimate. Let it finish before you race, or the
          game may not start.
        </div>
      </div>
      <div v-if="view.running" class="rc-notice warn" data-testid="lmu-running">
        <v-icon icon="mdi-alert" class="rr-warn" />
        <div>
          Le Mans Ultimate is running. It rewrites these files when it starts and exits, so
          restoring waits until it is closed.
        </div>
      </div>
      <div v-for="p in view.problems" :key="p" class="rc-notice bad">
        <v-icon icon="mdi-alert-circle" class="rr-bad" />
        <div>{{ p }}</div>
      </div>

      <div v-if="offline.length" class="rc-notice warn" data-testid="lmu-offline">
        <v-icon icon="mdi-alert" class="rr-warn" />
        <div>
          Le Mans Ultimate refers to {{ offline.map((d) => d.name).join(', ') }}, which is not
          connected as it was. The game names controllers with an id RigReady cannot recreate, so
          RigReady does not rewrite it. Restore a backup taken while the controller worked, or bind
          it again in the game.
        </div>
      </div>

      <section v-if="view.userFolder" class="rc-section">
        <h2 class="rr-section-title">Controllers</h2>
        <div class="rr-panel">
          <div
            v-for="d in view.devices"
            :key="d.key"
            class="lmu-dev"
            data-testid="lmu-device"
            :data-state="d.state"
          >
            <div class="rr-row lmu-dev-head">
              <v-icon
                :icon="d.type === 'Wheel' ? 'mdi-steering' : 'mdi-controller-classic-outline'"
                class="rr-muted"
              />
              <div class="rr-row-main">
                <div class="rr-row-title">
                  {{ d.givenName ?? d.name }}
                  <span v-if="d.givenName" class="rr-muted racing-hardware"> {{ d.name }}</span>
                </div>
                <div class="rr-row-sub">
                  {{ d.type || 'Controller' }} · {{ d.bindingCount }} binding{{
                    d.bindingCount === 1 ? '' : 's'
                  }}
                  <template v-if="d.vendorId">
                    · <span class="rr-mono">{{ d.vendorId }}:{{ d.productId }}</span></template
                  >
                </div>
              </div>
              <StateChip :state="d.state" />
            </div>
            <div v-if="d.rename" class="lmu-fix" data-testid="lmu-repair-panel">
              <p class="mb-2">
                Windows now calls this controller <strong>{{ d.rename.name }}</strong
                >. Le Mans Ultimate finds its controllers by name, so
                {{
                  d.rename.bindings === 1 ? 'the 1 binding' : `the ${d.rename.bindings} bindings`
                }}
                made under the old name no longer reach it. RigReady can put the new name into the
                game's bindings file instead.
              </p>
              <v-btn
                color="primary"
                :disabled="view.running"
                data-testid="lmu-repair"
                @click="askRepair"
                >Update Le Mans Ultimate…</v-btn
              >
            </div>
            <div v-if="d.forceFeedback.length" class="rc-grid lmu-pairs" data-testid="lmu-ffb">
              <div v-for="p in d.forceFeedback" :key="p.label" class="rc-pair">
                <span class="rc-pair-label">{{ p.label }}</span
                ><span class="rc-pair-value">{{ p.value }}</span>
              </div>
            </div>
          </div>
          <div v-if="view.devices.length === 0" class="rr-row rr-muted">
            No controllers are set up in the game yet.
          </div>
        </div>
        <div v-if="view.steering.length" class="rr-panel mt-3 rc-grid" data-testid="lmu-steering">
          <div v-for="p in view.steering" :key="p.label" class="rc-pair">
            <span class="rc-pair-label">{{ p.label }}</span
            ><span class="rc-pair-value">{{ p.value }}</span>
          </div>
        </div>
      </section>

      <section v-if="view.bindings.length" class="rc-section">
        <div class="rc-section-head">
          <h2 class="rr-section-title">Bindings</h2>
          <span class="rc-hint">{{ view.bindings.length }} bound</span>
          <v-spacer />
          <v-text-field
            v-model="filter"
            density="compact"
            hide-details
            clearable
            prepend-inner-icon="mdi-magnify"
            placeholder="Find a binding"
            class="rc-filter"
          />
        </div>
        <div class="rr-panel">
          <table class="rc-table" data-testid="lmu-bindings">
            <tr>
              <th>Action</th>
              <th>Input</th>
              <th>Controller</th>
            </tr>
            <tr v-for="b in rows" :key="`${b.action}|${b.slot}`" data-testid="binding-row">
              <td>
                {{ b.action
                }}<span v-if="b.slot === 'alternative'" class="rr-muted"> (second binding)</span>
              </td>
              <td class="rc-input">{{ b.input }}</td>
              <td class="rr-muted">{{ b.deviceName }}</td>
            </tr>
            <tr v-if="rows.length === 0">
              <td colspan="3" class="rr-muted">Nothing matches.</td>
            </tr>
          </table>
        </div>
      </section>

      <BackupsPanel
        v-if="view.userFolder"
        game="lmu"
        what="Le Mans Ultimate bindings and settings"
        closed-hint="Close Le Mans Ultimate first; it rewrites these files when it starts and exits. Start it once afterwards and check the bindings are still there."
        @restored="load"
      />
    </template>

    <ConfirmChanges
      :open="confirming"
      title="Put the new controller name into Le Mans Ultimate?"
      confirm-text="Update Le Mans Ultimate"
      :preview="repairPreview"
      :error="repairPreviewError"
      :busy="repairing"
      testid="lmu-repair"
      @cancel="confirming = false"
      @confirm="repair"
    >
      <div v-for="d in renamed" :key="d.key" data-testid="lmu-repair-what">
        <template v-if="d.rename?.exact">
          The game already lists <strong>{{ d.rename.name }}</strong
          >. RigReady points the {{ d.rename.bindings }} bindings made for
          <strong>{{ d.name }}</strong> at it. Nothing else in the file changes.
        </template>
        <template v-else-if="d.rename">
          RigReady replaces <strong>{{ d.name }}</strong> with
          <strong>{{ d.rename.name }}</strong> in the controller's entry and in its
          {{ d.rename.bindings }} bindings. Nothing else in the file changes.
        </template>
      </div>
      <template #after>
        <div
          v-if="renamed.some((d) => d.rename && !d.rename.exact)"
          class="rc-notice warn mt-3"
          data-testid="lmu-unverified"
        >
          <v-icon icon="mdi-flask-outline" class="rr-warn" />
          <div>
            Not yet verified in the game. The id Le Mans Ultimate gives a controller ends in a code
            whose origin is not known; RigReady keeps that code as it is and changes only the name
            in front of it. If the game still shows the controls as not bound, undo this on the
            Safety page and bind them in the game.
          </div>
        </div>
      </template>
    </ConfirmChanges>
  </div>
</template>

<style scoped>
.lmu-dev {
  border-top: 1px solid var(--rr-border);
}
.lmu-dev:first-child {
  border-top: none;
}
.lmu-dev-head {
  border-top: none;
}
.lmu-pairs {
  margin: 0 0 6px 36px;
}
.lmu-fix {
  padding: 0 16px 14px 52px;
  font-size: 13px;
}
</style>
