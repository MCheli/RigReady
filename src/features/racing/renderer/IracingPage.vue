<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import NotOnThisPc from '../../../renderer/components/NotOnThisPc.vue';
import { errorText, useClient } from '../../../renderer/ipc';
import { notifyMachineChanged, onMachineChanged } from '../../../renderer/machine';
import { racingContract, type IracingDeviceView, type IracingView } from '../contract';
import BackupsPanel from './BackupsPanel.vue';
import StateChip from './StateChip.vue';
import './racing.css';

const api = useClient(racingContract);
const view = ref<IracingView>();
const error = ref<string>();
const message = ref<string>();
const filter = ref('');
/** old instance GUID -> chosen new one */
const chosen = reactive<Record<string, string>>({});
const confirming = ref<IracingDeviceView>();
const repairing = ref(false);

async function load(): Promise<void> {
  const result = await api.iracing();
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  view.value = result.value;
  for (const d of result.value.devices) {
    if (d.state === 'moved' && d.suggested && !chosen[d.key]) chosen[d.key] = d.suggested;
  }
}

let off: (() => void) | undefined;
onMounted(() => {
  void load();
  off = onMachineChanged(() => void load());
});
onBeforeUnmount(() => off?.());

const GROUPS = ['Driving', 'In-car adjustments', 'Cameras and replay', 'Interface and chat'];
const groups = computed(() => {
  const text = filter.value.trim().toLowerCase();
  const rows = (view.value?.bindings ?? []).filter(
    (b) => !text || `${b.label} ${b.input} ${b.deviceName}`.toLowerCase().includes(text)
  );
  return GROUPS.map((g) => ({ name: g, rows: rows.filter((b) => b.group === g) })).filter(
    (g) => g.rows.length
  );
});

async function repair(): Promise<void> {
  const device = confirming.value;
  if (!device) return;
  const to = chosen[device.key];
  if (!to) return;
  repairing.value = true;
  error.value = undefined;
  const result = await api.iracingRepair({ mapping: [{ from: device.key, to }] });
  repairing.value = false;
  confirming.value = undefined;
  if (result.ok) {
    message.value = result.value.message;
    notifyMachineChanged();
  } else error.value = errorText(result.error);
  await load();
}

const shortId = (guid: string): string => `${guid.slice(0, 8)}…${guid.slice(19, 23)}`;
</script>

<template>
  <div class="rr-page" data-testid="iracing-page">
    <router-link to="/configure/racing" class="rc-crumb"
      ><v-icon icon="mdi-chevron-left" size="16" />Racing</router-link
    >
    <div class="rc-head">
      <div>
        <h1 class="rr-page-title">iRacing</h1>
        <p class="rr-page-sub">
          Bindings and wheel calibration from
          <span class="rr-mono">{{ view?.userFolder ?? 'Documents\\iRacing' }}</span>
        </p>
      </div>
      <v-spacer />
      <v-btn
        variant="text"
        prepend-icon="mdi-information-outline"
        to="/configure/games/iracing"
        data-testid="iracing-game-link"
        >Install and files</v-btn
      >
    </div>

    <v-alert v-if="error" type="error" variant="tonal" class="mb-4" data-testid="iracing-error">{{
      error
    }}</v-alert>
    <div v-if="message" class="rc-message rr-ok" data-testid="iracing-message">
      <v-icon icon="mdi-check" size="16" /> {{ message }}
    </div>

    <template v-if="view">
      <NotOnThisPc
        v-if="!view.installed && !view.userFolder"
        name="iRacing"
        :looked="['every Steam library', 'the usual install folders', 'Documents\\iRacing']"
        game-page="/configure/games/iracing"
        data-testid="iracing-missing"
      />

      <div v-if="view.simRunning" class="rc-notice warn" data-testid="iracing-running">
        <v-icon icon="mdi-alert" class="rr-warn" />
        <div>
          iRacing is running. Close the simulator before repairing or restoring: it writes its
          settings when it exits.
        </div>
      </div>
      <div v-for="p in view.problems" :key="p" class="rc-notice bad">
        <v-icon icon="mdi-alert-circle" class="rr-bad" />
        <div>{{ p }}</div>
      </div>

      <section v-if="view.userFolder" class="rc-section">
        <div class="rc-section-head">
          <h2 class="rr-section-title">Controllers iRacing knows</h2>
          <span class="rc-hint"
            >From joyCalib.yaml and controls.cfg, matched to what is connected now</span
          >
        </div>
        <div class="rr-panel">
          <div
            v-for="d in view.devices"
            :key="d.key"
            class="dev"
            data-testid="iracing-device"
            :data-state="d.state"
          >
            <div class="rr-row dev-head">
              <v-icon icon="mdi-steering" class="rr-muted" />
              <div class="rr-row-main">
                <div class="rr-row-title" data-testid="iracing-device-name">
                  {{ d.givenName ?? d.name }}
                  <span v-if="d.givenName" class="rr-muted racing-hardware"> {{ d.name }}</span>
                </div>
                <div class="rr-row-sub">
                  {{ d.bindingCount }} binding{{ d.bindingCount === 1 ? '' : 's' }}
                  <template v-if="d.calibrated">
                    · calibrated: {{ d.axes.map((a) => a.name).join(', ') }}</template
                  >
                  <template v-else> · not calibrated</template>
                  · id <span class="rr-mono">{{ shortId(d.instanceGuid) }}</span>
                </div>
              </div>
              <StateChip :state="d.state" />
            </div>
            <div v-if="d.state === 'moved'" class="dev-fix" data-testid="iracing-repair-panel">
              <p class="mb-2">
                Windows now gives this controller a different id, so iRacing will treat it as new
                and ask you to calibrate again. RigReady can point iRacing's files at the new id
                instead.
              </p>
              <div class="dev-fix-row">
                <v-select
                  v-model="chosen[d.key]"
                  :items="d.candidates"
                  item-title="label"
                  item-value="guid"
                  label="The controller it is now"
                  density="compact"
                  hide-details
                  class="dev-select"
                  data-testid="iracing-repair-target"
                />
                <v-btn
                  color="primary"
                  :disabled="!chosen[d.key] || view.simRunning"
                  data-testid="iracing-repair"
                  @click="confirming = d"
                  >Update iRacing…</v-btn
                >
              </div>
              <p v-if="!d.suggested && d.candidates.length > 1" class="rc-hint mt-2">
                More than one connected controller could be this one. Choose the right one; RigReady
                does not guess.
              </p>
            </div>
            <div v-else-if="d.state === 'missing'" class="dev-fix rc-hint">
              Connect this controller to use its {{ d.bindingCount }} bindings in iRacing.
            </div>
          </div>
          <div
            v-if="view.devices.length === 0"
            class="rr-row rr-muted"
            data-testid="iracing-no-devices"
          >
            iRacing has no controllers yet. Run its calibration wizard once and they appear here.
          </div>
        </div>
      </section>

      <section v-if="view.controlsFound" class="rc-section">
        <div class="rc-section-head">
          <h2 class="rr-section-title">Bindings</h2>
          <span class="rc-hint"
            >{{ view.bindings.length }} bound · {{ view.unboundCount }} not bound</span
          >
          <v-spacer />
          <v-text-field
            v-model="filter"
            density="compact"
            hide-details
            clearable
            prepend-inner-icon="mdi-magnify"
            placeholder="Find a binding"
            class="rc-filter"
            data-testid="iracing-filter"
          />
        </div>
        <div class="rr-panel">
          <table class="rc-table" data-testid="iracing-bindings">
            <template v-for="g in groups" :key="g.name">
              <tr>
                <th colspan="3">{{ g.name }}</th>
              </tr>
              <tr v-for="b in g.rows" :key="b.action" data-testid="binding-row">
                <td>{{ b.label }}</td>
                <td class="rc-input">{{ b.input }}</td>
                <td class="rr-muted">{{ b.deviceName }}</td>
              </tr>
            </template>
            <tr v-if="groups.length === 0">
              <td colspan="3" class="rr-muted">Nothing matches.</td>
            </tr>
          </table>
        </div>
      </section>

      <section v-if="view.userFolder" class="rc-section">
        <h2 class="rr-section-title">Custom controls per car</h2>
        <div class="rr-panel">
          <div
            v-for="car in view.customCars"
            :key="car"
            class="rr-row"
            data-testid="iracing-custom-car"
          >
            <v-icon icon="mdi-car-sports" class="rr-muted" />
            <div class="rr-row-main rr-mono">{{ car }}</div>
          </div>
          <div
            v-if="view.customCars.length === 0"
            class="rr-row rr-muted"
            data-testid="iracing-no-custom-cars"
          >
            No car uses "Use custom controls for this car"; every car uses the bindings above.
          </div>
        </div>
      </section>

      <section v-if="view.forceFeedback.length" class="rc-section">
        <v-expansion-panels variant="accordion">
          <v-expansion-panel data-testid="iracing-ffb">
            <v-expansion-panel-title
              >Force feedback options in app.ini ({{
                view.forceFeedback.length
              }})</v-expansion-panel-title
            >
            <v-expansion-panel-text>
              <p class="rc-hint mb-2">
                Read only. Strength and wheel force are kept by iRacing per car and are not in this
                file.
              </p>
              <table class="rc-table">
                <tr v-for="f in view.forceFeedback" :key="f.key">
                  <td class="rc-input">{{ f.key }}</td>
                  <td class="rc-input">{{ f.value }}</td>
                  <td class="rr-muted">{{ f.note }}</td>
                </tr>
              </table>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
      </section>

      <BackupsPanel
        v-if="view.userFolder"
        game="iracing"
        what="iRacing bindings, calibration and options"
        closed-hint="Close the iRacing simulator first; restoring while it runs is refused."
        @restored="load"
      />
    </template>

    <v-dialog :model-value="confirming !== undefined" max-width="580" persistent>
      <v-card v-if="confirming" data-testid="iracing-repair-confirm">
        <v-card-title>Point iRacing at the new id?</v-card-title>
        <v-card-text>
          <p class="mb-3">
            RigReady replaces the old id of <strong>{{ confirming.name }}</strong> with the new one
            in <span class="rr-mono">controls.cfg</span> ({{ confirming.bindingCount }} bindings)
            and <span class="rr-mono">joyCalib.yaml</span> (its calibration), and in any car's
            custom controls. Nothing else in the files changes. Both files are backed up first; Undo
            is on the Safety page.
          </p>
          <div class="rc-notice warn" data-testid="iracing-unverified">
            <v-icon icon="mdi-flask-outline" class="rr-warn" />
            <div>
              Not yet verified on real hardware. The change follows the file layout decoded from
              this PC's own files, but has not been tried with iRacing and a moved wheel yet. If
              iRacing still asks to calibrate, undo it on the Safety page and calibrate in iRacing.
            </div>
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" data-testid="iracing-repair-cancel" @click="confirming = undefined"
            >Cancel</v-btn
          >
          <v-btn
            color="primary"
            :loading="repairing"
            data-testid="iracing-repair-go"
            @click="repair"
            >Update iRacing</v-btn
          >
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.dev {
  border-top: 1px solid var(--rr-border);
}
.dev:first-child {
  border-top: none;
}
.dev-head {
  border-top: none;
}
.dev-fix {
  padding: 0 16px 14px 52px;
  font-size: 13px;
}
.dev-fix-row {
  display: flex;
  gap: 12px;
  align-items: center;
}
.dev-select {
  max-width: 420px;
}
</style>
