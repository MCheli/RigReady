<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import ConfirmChanges from '../../../renderer/components/ConfirmChanges.vue';
import NotOnThisPc from '../../../renderer/components/NotOnThisPc.vue';
import { errorText, useClient } from '../../../renderer/ipc';
import { notifyMachineChanged, onMachineChanged } from '../../../renderer/machine';
import { racingContract, type AcView, type WritePreviewView } from '../contract';
import BackupsPanel from './BackupsPanel.vue';
import StateChip from './StateChip.vue';
import './racing.css';

const api = useClient(racingContract);
const view = ref<AcView>();
const error = ref<string>();
const message = ref<string>();
/** controller number in controls.ini -> chosen instance GUID, for the ones RigReady is not sure of */
const chosen = reactive<Record<number, string>>({});

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

type Controller = AcView['controllers'][number];
const toFix = computed<Controller[]>(() =>
  (view.value?.controllers ?? []).filter(
    (c) => c.used && (c.state === 'reordered' || c.state === 'moved')
  )
);
/** Used controllers that need the user to say which connected one they are. */
const toChoose = computed(() => toFix.value.filter((c) => !c.now && c.candidates.length > 0));
const missingUsed = computed(() =>
  (view.value?.controllers ?? []).filter((c) => c.used && c.state === 'missing')
);
const choices = computed(() =>
  toChoose.value
    .filter((c) => chosen[c.index])
    .map((c) => ({ index: c.index, guid: chosen[c.index]! }))
);
const ready = computed(() => toChoose.value.every((c) => chosen[c.index]));

const confirming = ref(false);
const repairing = ref(false);
const preview = ref<WritePreviewView>();
const previewError = ref<string>();

async function askRepair(): Promise<void> {
  preview.value = undefined;
  previewError.value = undefined;
  confirming.value = true;
  const result = await api.acRepairPreview({ choices: choices.value });
  if (!confirming.value) return;
  if (result.ok) preview.value = result.value;
  else previewError.value = errorText(result.error);
}

async function repair(): Promise<void> {
  repairing.value = true;
  error.value = undefined;
  const result = await api.acRepair({ choices: choices.value });
  repairing.value = false;
  confirming.value = false;
  if (result.ok) {
    message.value = result.value.message;
    notifyMachineChanged();
  } else error.value = errorText(result.error);
  await load();
}

const shortId = (guid: string): string =>
  guid ? `${guid.slice(0, 8)}…${guid.slice(19, 23)}` : 'none stored';
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

    <v-alert v-if="error" type="error" variant="tonal" class="mb-4" data-testid="ac-error">{{
      error
    }}</v-alert>
    <div v-if="message" class="rc-message rr-ok" data-testid="ac-message">
      <v-icon icon="mdi-check" size="16" /> {{ message }}
    </div>

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
          <span class="rc-hint"
            >From [CONTROLLERS] in controls.ini, matched to what is connected now<template
              v-if="view.inputMethod"
            >
              · input method: {{ view.inputMethod.toLowerCase() }}</template
            ></span
          >
        </div>
        <div class="rr-panel">
          <div
            v-for="c in view.controllers"
            :key="c.index"
            class="rr-row"
            data-testid="ac-controller"
            :data-state="c.state"
          >
            <v-icon icon="mdi-steering" class="rr-muted" />
            <div class="rr-row-main">
              <div class="rr-row-title">
                {{ c.givenName ?? c.name }}
                <span v-if="c.givenName" class="rr-muted racing-hardware"> {{ c.name }}</span>
              </div>
              <div class="rr-row-sub" data-testid="ac-controller-sub">
                Controller {{ c.index }} in controls.ini · {{ c.bindingCount }} binding{{
                  c.bindingCount === 1 ? '' : 's'
                }}
                · id
                <span class="rr-mono">{{ shortId(c.instanceGuid) }}</span>
                <template v-if="c.now && c.now.number !== undefined && c.now.number !== c.index">
                  · now number {{ c.now.number }} in Windows' list</template
                >
                <template v-if="c.state === 'moved' && c.now">
                  · new id <span class="rr-mono">{{ shortId(c.now.guid) }}</span></template
                >
              </div>
            </div>
            <StateChip v-if="c.used" :state="c.state" />
            <span v-else class="rr-row-sub">Not used</span>
          </div>
        </div>

        <div v-if="view.repairNeeded" class="rr-panel rc-repair mt-3" data-testid="ac-repair-panel">
          <p class="mb-2">
            Assetto Corsa finds a controller by its number in the order Windows lists them, and that
            order has changed since controls.ini was saved (a USB port, or a controller added or
            removed). Its bindings now act on the wrong controller, or on none. RigReady can
            renumber them so each binding is on the same physical controller again.
          </p>
          <ul class="rc-repair-list">
            <li v-for="c in toFix" :key="c.index" data-testid="ac-repair-item">
              <strong>{{ c.givenName ?? c.name }}</strong
              >: controller {{ c.index }} in controls.ini<template
                v-if="c.now && c.now.number !== undefined"
              >
                becomes {{ c.now.number }}</template
              ><template v-if="c.state === 'moved' && c.now"> with its new Windows id</template> ({{
                c.bindingCount
              }}
              binding{{ c.bindingCount === 1 ? '' : 's' }})
              <v-select
                v-if="!c.now && c.candidates.length"
                v-model="chosen[c.index]"
                :items="c.candidates"
                item-title="label"
                item-value="guid"
                :label="`Which connected controller is controller ${c.index} now?`"
                density="compact"
                hide-details
                class="rc-repair-select mt-1"
                data-testid="ac-repair-target"
              />
            </li>
          </ul>
          <p v-if="toChoose.length" class="rc-hint mt-2" data-testid="ac-repair-choose">
            More than one connected controller could be
            {{ toChoose.length === 1 ? 'this one' : 'these' }}. Press a button on it on the Devices
            page to tell them apart, then choose; RigReady does not guess.
          </p>
          <p v-if="missingUsed.length" class="rc-hint mt-2">
            Not connected: {{ missingUsed.map((c) => c.name).join(', ') }}. Its bindings are given a
            number no connected controller has, so they stop acting on another controller.
          </p>
          <div class="rc-repair-row mt-2">
            <v-btn
              color="primary"
              :disabled="!ready || view.running"
              data-testid="ac-repair"
              @click="askRepair"
              >Update controls.ini…</v-btn
            >
            <span v-if="view.running" class="rc-hint" data-testid="ac-repair-running"
              >Close Assetto Corsa and Content Manager first: they write controls.ini.</span
            >
            <span v-else-if="!ready" class="rc-hint"
              >Choose which controller each one is first.</span
            >
          </div>
        </div>
        <div v-else-if="missingUsed.length" class="rc-notice warn mt-3" data-testid="ac-offline">
          <v-icon icon="mdi-alert" class="rr-warn" />
          <div>
            {{ missingUsed.map((c) => c.name).join(', ') }}
            {{ missingUsed.length === 1 ? 'is' : 'are' }} not connected. Connect
            {{ missingUsed.length === 1 ? 'it' : 'them' }} to use
            {{ missingUsed.length === 1 ? 'its' : 'their' }} bindings, or restore a backup taken
            while it worked.
          </div>
        </div>
        <p v-if="!view.orderKnown" class="rc-hint mt-2" data-testid="ac-order-unknown">
          RigReady cannot see the order in which Windows lists the controllers right now, so it
          cannot tell whether a controller moved to another number.
        </p>
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
              <th v-if="view.repairNeeded">Acts on now</th>
            </tr>
            <tr
              v-for="b in view.bindings"
              :key="`${b.action}|${b.controller}`"
              data-testid="binding-row"
            >
              <td>{{ b.label }}</td>
              <td class="rc-input">{{ b.input }}</td>
              <td class="rr-muted">{{ b.controller }}</td>
              <td
                v-if="view.repairNeeded"
                :class="b.actsOn && b.actsOn !== b.controller ? 'rr-warn' : 'rr-muted'"
                data-testid="ac-acts-on"
              >
                {{ b.controller === 'Keyboard' ? '' : b.actsOn }}
              </td>
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

    <ConfirmChanges
      :open="confirming"
      title="Renumber Assetto Corsa's controllers?"
      confirm-text="Update controls.ini"
      :preview="preview"
      :error="previewError"
      :busy="repairing"
      testid="ac-repair"
      @cancel="confirming = false"
      @confirm="repair"
    >
      RigReady changes the controller numbers (JOY=) of the bindings and the [CONTROLLERS] list in
      controls.ini to where Windows lists each controller now, and puts in a new Windows id where
      one changed. Nothing else in the file changes. Saved control presets are not touched.
      <template #after>
        <div class="rc-notice warn mt-3" data-testid="ac-unverified">
          <v-icon icon="mdi-flask-outline" class="rr-warn" />
          <div>
            Not yet verified on real hardware. The change follows the file format as Content Manager
            reads and writes it, but has not been tried in Assetto Corsa with a moved controller
            yet. If a binding is still wrong in the game, undo it on the Safety page and bind it
            again in the game or Content Manager.
          </div>
        </div>
      </template>
    </ConfirmChanges>
  </div>
</template>

<style scoped>
.rc-repair {
  padding: 14px 16px;
  font-size: 13px;
}
.rc-repair-list {
  margin: 0 0 0 18px;
}
.rc-repair-list li {
  margin: 4px 0;
}
.rc-repair-select {
  max-width: 460px;
}
.rc-repair-row {
  display: flex;
  gap: 12px;
  align-items: center;
}
</style>
