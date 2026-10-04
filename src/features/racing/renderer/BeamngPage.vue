<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { errorText, useClient } from '../../../renderer/ipc';
import { notifyMachineChanged, onMachineChanged } from '../../../renderer/machine';
import { racingContract, type BeamngMapView, type BeamngView } from '../contract';
import BackupsPanel from './BackupsPanel.vue';
import StateChip from './StateChip.vue';
import './racing.css';

const api = useClient(racingContract);
const view = ref<BeamngView>();
const error = ref<string>();
const message = ref<string>();
const busy = ref(false);
const copyTarget = reactive<Record<string, string>>({});
const confirmOlder = ref<string>();

async function load(): Promise<void> {
  const result = await api.beamng();
  if (result.ok) view.value = result.value;
  else error.value = errorText(result.error);
}

let off: (() => void) | undefined;
onMounted(() => {
  void load();
  off = onMachineChanged(() => void load());
});
onBeforeUnmount(() => off?.());

async function after(
  result:
    { ok: true; value: { message: string } } | { ok: false; error: Parameters<typeof errorText>[0] }
): Promise<void> {
  busy.value = false;
  if (result.ok) {
    message.value = result.value.message;
    error.value = undefined;
    notifyMachineChanged();
  } else error.value = errorText(result.error);
  await load();
}

async function copyOlder(): Promise<void> {
  const version = confirmOlder.value;
  confirmOlder.value = undefined;
  if (!version) return;
  busy.value = true;
  await after(await api.beamngCopyOlder({ version }));
}

/** The copy waiting for a yes: which map, to which controller, what it holds. */
const confirmCopy = ref<{ map: BeamngMapView; to: { vidpid: string; name: string } }>();

function askCopy(map: BeamngMapView): void {
  const to = map.targets.find((t) => t.vidpid === copyTarget[map.file]);
  if (to) confirmCopy.value = { map, to };
}

async function copyToController(): Promise<void> {
  const pending = confirmCopy.value;
  confirmCopy.value = undefined;
  if (!pending) return;
  busy.value = true;
  await after(await api.beamngCopyToController({ file: pending.map.file, to: pending.to.vidpid }));
}
</script>

<template>
  <div class="rr-page" data-testid="beamng-page">
    <router-link to="/configure/racing" class="rc-crumb"
      ><v-icon icon="mdi-chevron-left" size="16" />Racing</router-link
    >
    <div class="rc-head">
      <div>
        <h1 class="rr-page-title">BeamNG.drive</h1>
        <p class="rr-page-sub">
          Bindings and force feedback from
          <span class="rr-mono">{{ view?.userFolder ?? 'the BeamNG user folder' }}</span>
        </p>
      </div>
      <v-spacer />
      <v-btn variant="text" prepend-icon="mdi-information-outline" to="/configure/games/beamng"
        >Install and files</v-btn
      >
    </div>

    <v-alert v-if="error" type="error" variant="tonal" class="mb-4" data-testid="beamng-error">{{
      error
    }}</v-alert>
    <div v-if="message" class="rc-message rr-ok" data-testid="beamng-message">
      <v-icon icon="mdi-check" size="16" /> {{ message }}
    </div>

    <template v-if="view">
      <div v-if="!view.installed && !view.userFolder" class="rr-panel rr-empty">
        BeamNG.drive was not found on this PC.
      </div>
      <div v-if="view.running" class="rc-notice warn">
        <v-icon icon="mdi-alert" class="rr-warn" />
        <div>BeamNG.drive is running. Changes and restores wait until it is closed.</div>
      </div>
      <div v-for="p in view.problems" :key="p" class="rc-notice bad">
        <v-icon icon="mdi-alert-circle" class="rr-bad" />
        <div>{{ p }}</div>
      </div>

      <section v-if="view.older.length" class="rc-section" data-testid="beamng-older">
        <h2 class="rr-section-title">Older user folders</h2>
        <div class="rr-panel">
          <div v-for="o in view.older" :key="o.version" class="rr-row">
            <v-icon icon="mdi-folder-clock-outline" class="rr-muted" />
            <div class="rr-row-main">
              <div class="rr-row-title">BeamNG.drive {{ o.version }}</div>
              <div class="rr-row-sub">
                {{ o.bindingFiles }} binding file{{ o.bindingFiles === 1 ? '' : 's' }} ·
                <span class="rr-mono">{{ o.path }}</span>
              </div>
            </div>
            <v-btn
              v-if="o.bindingFiles > 0"
              size="small"
              variant="tonal"
              :disabled="view.running || busy"
              data-testid="beamng-copy-older"
              @click="confirmOlder = o.version"
              >Copy into current…</v-btn
            >
          </div>
        </div>
      </section>

      <section class="rc-section">
        <div class="rc-section-head">
          <h2 class="rr-section-title">Controllers</h2>
          <span class="rc-hint"
            >BeamNG keeps one binding file per controller model, so USB ports do not matter</span
          >
        </div>
        <div v-if="view.maps.length === 0" class="rr-panel rr-empty" data-testid="beamng-no-maps">
          No changed bindings: BeamNG.drive uses its defaults for every controller.
        </div>
        <div
          v-for="m in view.maps"
          :key="m.file"
          class="rr-panel mb-4"
          data-testid="beamng-map"
          :data-file="m.file"
        >
          <div class="rr-row">
            <v-icon
              :icon="m.state === 'keyboard' ? 'mdi-keyboard-outline' : 'mdi-steering'"
              class="rr-muted"
            />
            <div class="rr-row-main">
              <div class="rr-row-title">
                {{ m.givenName ?? m.name
                }}<span v-if="m.givenName" class="rr-muted racing-hardware"> {{ m.name }}</span
                ><span v-if="m.vehicle" class="rr-muted"> · only in {{ m.vehicle }}</span>
              </div>
              <div class="rr-row-sub">
                <span class="rr-mono">{{ m.file }}</span>
                <template v-if="m.state !== 'keyboard'">
                  · {{ m.vendorId }}:{{ m.productId }}</template
                >
              </div>
            </div>
            <StateChip :state="m.state" />
          </div>
          <div v-if="m.state === 'other-mode'" class="rc-notice warn mx-4">
            <v-icon icon="mdi-alert" class="rr-warn" />
            <div>
              The wheel base is in compatibility (yellow) mode, so BeamNG.drive uses the ClubSport
              V2.5 map instead of this one. Switch the base to PC (red) mode.
            </div>
          </div>
          <div
            v-if="m.state === 'missing' && m.targets.length"
            class="beam-copy"
            data-testid="beamng-copy-panel"
          >
            <span class="rc-hint">Replaced this controller? Give its bindings to</span>
            <v-select
              v-model="copyTarget[m.file]"
              :items="m.targets"
              item-title="name"
              item-value="vidpid"
              density="compact"
              hide-details
              class="beam-select"
              data-testid="beamng-copy-target"
            />
            <v-btn
              size="small"
              variant="tonal"
              :disabled="!copyTarget[m.file] || view.running || busy"
              data-testid="beamng-copy"
              @click="askCopy(m)"
              >Copy bindings</v-btn
            >
          </div>
          <table
            v-if="m.bindings.length || m.removed.length"
            class="rc-table"
            data-testid="beamng-bindings"
          >
            <tr>
              <th>Action</th>
              <th>Input</th>
              <th></th>
            </tr>
            <tr v-for="b in m.bindings" :key="`${b.action}|${b.input}`" data-testid="binding-row">
              <td>{{ b.label }}</td>
              <td class="rc-input">{{ b.input }}</td>
              <td class="rr-muted">
                {{
                  [b.detail, b.yours && m.factoryLoaded ? 'changed by you' : '']
                    .filter(Boolean)
                    .join(' · ')
                }}
              </td>
            </tr>
            <tr v-for="r in m.removed" :key="`removed|${r.action}|${r.input}`">
              <td class="rr-muted">
                <s>{{ r.label }}</s>
              </td>
              <td class="rc-input rr-muted">
                <s>{{ r.input }}</s>
              </td>
              <td class="rr-muted">default binding removed</td>
            </tr>
          </table>
          <p v-if="!m.factoryLoaded && m.state !== 'keyboard'" class="rc-hint px-4 py-2">
            Shows your changes to BeamNG's default bindings for this controller; the defaults
            themselves were not found in the game folder.
          </p>
          <template v-if="m.forceFeedback.length">
            <div class="rr-section-title px-4 pt-3">Force feedback (in the steering binding)</div>
            <div class="rc-grid" data-testid="beamng-ffb">
              <div v-for="p in m.forceFeedback" :key="p.label" class="rc-pair">
                <span class="rc-pair-label">{{ p.label }}</span
                ><span class="rc-pair-value">{{ p.value }}</span>
              </div>
            </div>
          </template>
        </div>
      </section>

      <BackupsPanel
        v-if="view.userFolder"
        game="beamng"
        what="BeamNG.drive binding files"
        closed-hint="Close BeamNG.drive first; restoring while it runs is refused."
        @restored="load"
      />
    </template>

    <v-dialog :model-value="confirmCopy !== undefined" max-width="540">
      <v-card v-if="confirmCopy" data-testid="beamng-copy-controller-confirm">
        <v-card-title>Copy these bindings?</v-card-title>
        <v-card-text>
          <p class="mb-3">
            RigReady creates <span class="rr-mono">{{ confirmCopy.to.vidpid }}.diff</span> for
            {{ confirmCopy.to.name }} with the {{ confirmCopy.map.bindings.length }} bindings and
            the force feedback of {{ confirmCopy.map.name }}:
          </p>
          <div
            v-for="b in confirmCopy.map.bindings"
            :key="`${b.action}|${b.input}`"
            class="rc-hint"
          >
            {{ b.label }} · {{ b.input }}
          </div>
          <p class="mt-3">
            Button numbers can differ between controllers, so check them in the game. The new file
            can be removed again with Undo on the Safety page.
          </p>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="confirmCopy = undefined">Cancel</v-btn>
          <v-btn color="primary" data-testid="beamng-copy-controller-go" @click="copyToController"
            >Copy bindings</v-btn
          >
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog :model-value="confirmOlder !== undefined" max-width="480">
      <v-card v-if="confirmOlder" data-testid="beamng-copy-confirm">
        <v-card-title>Copy the {{ confirmOlder }} bindings?</v-card-title>
        <v-card-text>
          The binding files of BeamNG.drive {{ confirmOlder }} are copied into the current user
          folder. Files with the same name are replaced; they are backed up first and Undo is on the
          Safety page.
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="confirmOlder = undefined">Cancel</v-btn>
          <v-btn color="primary" data-testid="beamng-copy-go" @click="copyOlder">Copy</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.beam-copy {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 16px 12px 52px;
}
.beam-select {
  max-width: 320px;
}
</style>
