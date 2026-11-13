<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { errorText, useClient } from '../../../renderer/ipc';
import { notifyMachineChanged, onMachineChanged } from '../../../renderer/machine';
import { bugs } from '../../../../package.json';
import {
  PRESET_PARAMS,
  racingContract,
  type BackupGame,
  type MyWheel,
  type UnlistedController,
  type WheelPresets,
  type WheelView,
} from '../contract';
import { wheelHead } from '../core/wheelbases/head';
import { UNLISTED_NOT_AVAILABLE, UNLISTED_WORKS } from '../core/wheelbases/unlistedScope';
import BackupsPanel from './BackupsPanel.vue';
import './racing.css';

const api = useClient(racingContract);
const view = ref<WheelView>();
const error = ref<string>();
const presets = ref<WheelPresets>();
const saved = ref<string>();
const saving = ref(false);
const slot = ref(1);
const game = ref('iracing');
const dirty = ref(false);

async function load(): Promise<void> {
  const result = await api.wheel();
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  view.value = result.value;
  if (!dirty.value) {
    presets.value = structuredClone(result.value.presets);
    slot.value = result.value.presets.activeSlot;
  }
}

let off: (() => void) | undefined;
onMounted(() => {
  void load();
  off = onMachineChanged(() => void load());
});
onBeforeUnmount(() => off?.());

const current = computed(() => presets.value?.presets.find((p) => p.slot === slot.value));

function setValue(param: string, value: string): void {
  const preset = current.value;
  if (!preset) return;
  const text = (value ?? '').trim();
  if (text) preset.values[param] = text;
  else delete preset.values[param];
  dirty.value = true;
  saved.value = undefined;
}

async function save(): Promise<void> {
  if (!presets.value) return;
  saving.value = true;
  const result = await api.savePresets(presets.value);
  saving.value = false;
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  dirty.value = false;
  presets.value = structuredClone(result.value);
  saved.value =
    'Saved. RigReady keeps these with its own data, so they survive a reinstall of the Fanatec software.';
  await load();
}

const status = computed(() => view.value?.status);
/** The mode is fine when it is the PC one, or when this brand's USB id cannot tell. */
const modeOk = computed(() => status.value?.mode === 'pc' || status.value?.mode === 'unknown');
/** Which case the top row is in, and its words (core/wheelbases/head.ts). */
const head = computed(() => (status.value ? wheelHead(status.value) : undefined));

// ---- My wheel is not listed -----------------------------------------------------------------

const adding = ref(false);
const picked = ref<string>();
const maker = ref('');
const addError = ref<string>();
const working = ref(false);
const changed = ref<string>();
const idOf = (c: { vendorId: string; productId: string }): string => `${c.vendorId}:${c.productId}`;

/** Opens the picker. Only a controller that looks like a wheel base is chosen beforehand. */
function openAdd(first?: UnlistedController): void {
  const choice = first ?? view.value?.unlisted.find((c) => c.looksLikeWheel);
  picked.value = choice ? idOf(choice) : undefined;
  addError.value = undefined;
  changed.value = undefined;
  adding.value = true;
}

function closeAdd(): void {
  adding.value = false;
  addError.value = undefined;
}

async function addWheel(): Promise<void> {
  const choice = view.value?.unlisted.find((c) => idOf(c) === picked.value);
  if (!choice) {
    addError.value = 'Pick the controller that is your wheel base first.';
    return;
  }
  working.value = true;
  const given = maker.value.trim();
  const result = await api.addWheel({
    vendorId: choice.vendorId,
    productId: choice.productId,
    ...(given ? { maker: given } : {}),
  });
  working.value = false;
  if (!result.ok) {
    addError.value = errorText(result.error);
    return;
  }
  view.value = result.value;
  adding.value = false;
  maker.value = '';
  changed.value = `RigReady now treats ${choice.name} as your wheel base.`;
  notifyMachineChanged();
}

async function forgetWheel(wheel: MyWheel): Promise<void> {
  working.value = true;
  const result = await api.removeWheel({ vendorId: wheel.vendorId, productId: wheel.productId });
  working.value = false;
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  view.value = result.value;
  changed.value = `RigReady no longer treats ${wheel.name} as your wheel base.`;
  notifyMachineChanged();
}
const brandName = computed(() => status.value?.brandName ?? 'wheel');
const fanatec = computed(() => status.value?.brand === 'fanatec');
const backupGame = computed(() => status.value?.backup as BackupGame | undefined);
/** The hardware report form, from the package's own description (package.json). */
const reportUrl = `${bugs.url}/new?template=hardware.yml`;
const ROLE: Record<string, string> = {
  base: 'Wheel base',
  rim: 'Steering wheel (rim)',
  pedals: 'Pedals',
  shifter: 'Shifter',
  handbrake: 'Handbrake',
  other: 'Accessory',
};

const comparison = computed(() => view.value?.comparisons.find((c) => c.game === game.value));
const paramName = (id: string): string =>
  view.value?.parameters.find((p) => p.id === id)?.name ?? id;
const paramMeaning = (id: string): string =>
  view.value?.parameters.find((p) => p.id === id)?.meaning ?? '';
const filled = (n: number): number =>
  Object.keys(presets.value?.presets.find((p) => p.slot === n)?.values ?? {}).length;

const STATUS = {
  match: { icon: 'mdi-check-circle', cls: 'rr-ok', text: 'As recommended' },
  differs: { icon: 'mdi-alert', cls: 'rr-warn', text: 'Differs' },
  unreadable: { icon: 'mdi-minus-circle-outline', cls: 'rr-muted', text: 'Cannot be read' },
  info: { icon: 'mdi-information-outline', cls: 'rr-muted', text: 'For reference' },
} as const;
</script>

<template>
  <div class="rr-page" data-testid="wheel-page">
    <div class="rc-head">
      <div>
        <h1 class="rr-page-title">Wheel</h1>
        <p class="rr-page-sub">
          Your wheel base, rim and pedals as Windows sees them, the maker's software, and what can
          be kept safe.
        </p>
      </div>
    </div>

    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>

    <template v-if="view && status && head">
      <section class="rc-section">
        <h2 class="rr-section-title">Wheel base</h2>
        <div
          class="rr-panel"
          data-testid="wheel-status"
          :data-brand="status.brand ?? 'none'"
          :data-state="head.state"
        >
          <div class="rr-row">
            <v-icon
              :icon="
                head.state === 'connected'
                  ? modeOk
                    ? 'mdi-check-circle'
                    : 'mdi-alert'
                  : head.state === 'seen'
                    ? 'mdi-help-circle'
                    : head.state === 'none'
                      ? 'mdi-minus-circle-outline'
                      : 'mdi-close-circle'
              "
              :class="
                head.state === 'connected'
                  ? modeOk
                    ? 'rr-ok'
                    : 'rr-warn'
                  : head.state === 'seen'
                    ? 'rr-warn'
                    : head.state === 'none'
                      ? 'rr-muted'
                      : 'rr-bad'
              "
              size="28"
            />
            <div class="rr-row-main">
              <div class="rr-row-title" data-testid="wheel-name">
                {{ status.givenName ?? head.title }}
                <span
                  v-if="status.givenName && status.name"
                  class="rr-muted racing-hardware"
                  data-testid="wheel-hardware-name"
                >
                  {{ status.name }}</span
                >
              </div>
              <div class="rr-row-sub" data-testid="wheel-mode">
                <template v-if="status.connected && status.unlisted">
                  {{ status.maker ?? 'Maker not given' }} · A model RigReady does not know ·
                  <span class="rr-mono">{{ status.vendorId }}:{{ status.productId }}</span>
                  <template v-if="status.connection"> · {{ status.connection }}</template>
                </template>
                <template v-else-if="status.connected">
                  {{ status.brandName }} · {{ status.modeLabel }} ·
                  <span class="rr-mono">{{ status.vendorId }}:{{ status.productId }}</span>
                  <template v-if="status.connection"> · {{ status.connection }}</template>
                </template>
                <template v-else-if="head.seen"
                  >{{ head.seen.why }} It is connected, but it is not in the list of wheel bases
                  RigReady knows. If it is your wheel base, say so and this page shows what it
                  can.</template
                >
                <template v-else-if="head.state === 'awaited'"
                  >You added it as your wheel base. Plug it in and switch it on; this page updates
                  by itself.</template
                >
                <template v-else-if="head.state === 'none'"
                  >Nothing to set up unless you have one. Plug a base in (Fanatec, Moza, Logitech,
                  Simagic, Thrustmaster, Simucube, Asetek or Cammus) and this page fills in by
                  itself. If yours is plugged in and not shown, choose My wheel is not
                  listed.</template
                >
                <template v-else
                  >Plug it in and switch it on; this page updates by itself.</template
                >
              </div>
            </div>
            <v-btn
              v-if="head.seen && !adding"
              color="primary"
              size="small"
              data-testid="wheel-is-mine"
              @click="openAdd(head.seen)"
              >This is my wheel base</v-btn
            >
          </div>
          <div v-if="status.unlisted" class="rr-row rr-row-sub" data-testid="wheel-unlisted">
            <v-icon icon="mdi-account-check-outline" size="18" class="rr-muted" />
            <span>
              You told RigReady this is your wheel base. RigReady does not know this model, so this
              page shows only what Windows and games say about it.
            </span>
          </div>
          <div
            v-if="status.brand && !status.verifiedOnHardware"
            class="rr-row rr-row-sub"
            data-testid="wheel-unverified"
          >
            <v-icon icon="mdi-flask-outline" size="18" class="rr-warn" />
            <span>
              Tested on recorded data, not yet on a real {{ status.brandName }} wheel. Whether it
              works on yours or not,
              <a :href="reportUrl" target="_blank" rel="noopener" class="rec-link"
                >tell us with the hardware report form</a
              >.
            </span>
          </div>
          <div v-if="status.connected" class="rr-row rr-row-sub" data-testid="wheel-controllers">
            <v-icon icon="mdi-information-outline" size="18" class="rr-muted" />
            <span v-if="status.controllers === 0"
              >Games do not see this base as a controller yet.</span
            >
            <span v-else>
              Games see this base as
              {{
                status.controllers === 1 ? 'one controller' : `${status.controllers} controllers`
              }}.
              <template v-if="status.controllersNote">{{ status.controllersNote }}</template>
            </span>
          </div>
          <div
            v-for="p in status.parts.filter((x) => x.role !== 'base')"
            :key="`${p.vendorId}:${p.productId}`"
            class="rr-row rr-row-sub"
            data-testid="wheel-part"
            :data-role="p.role"
          >
            <v-icon icon="mdi-usb" size="18" class="rr-muted" />
            <span
              >{{ ROLE[p.role] }}: {{ p.name }}
              <span class="rr-mono rr-muted">{{ p.vendorId }}:{{ p.productId }}</span></span
            >
          </div>
          <div v-if="status.others.length" class="rr-row rr-row-sub" data-testid="wheel-others">
            <v-icon icon="mdi-information-outline" size="18" class="rr-muted" />
            <span>Also connected: {{ status.others.join(', ') }}</span>
          </div>
          <div
            v-if="status.connected && status.unknownBases.length"
            class="rr-row rr-row-sub"
            data-testid="wheel-unknown-also"
          >
            <v-icon icon="mdi-help-circle-outline" size="18" class="rr-muted" />
            <span
              >Also connected, and not a model RigReady knows:
              {{ status.unknownBases.map((b) => b.name).join(', ') }}. If it is your wheel base,
              choose My wheel is not listed.</span
            >
          </div>
        </div>
        <div
          v-if="status.connected && !modeOk"
          class="rc-notice warn mt-3"
          data-testid="wheel-compat"
        >
          <v-icon icon="mdi-alert" class="rr-warn" />
          <div>{{ status.modeHelp }}</div>
        </div>
        <div v-if="changed" class="rc-message rr-ok mt-3" data-testid="wheel-changed">
          <v-icon icon="mdi-check" size="16" /> {{ changed }}
        </div>

        <div v-if="adding" class="rr-panel wheel-add mt-3" data-testid="wheel-add">
          <h3 class="wheel-add-title">My wheel is not listed</h3>
          <p class="rc-hint">
            Pick the connected controller that is your wheel base. RigReady remembers the choice on
            this PC, in its own data folder. It changes no file of a game or of the maker and starts
            no program.
          </p>
          <template v-if="view.unlisted.length">
            <v-radio-group
              v-model="picked"
              density="compact"
              hide-details
              data-testid="wheel-add-list"
            >
              <v-radio
                v-for="c in view.unlisted"
                :key="idOf(c)"
                :value="idOf(c)"
                :data-testid="`wheel-add-pick-${idOf(c)}`"
              >
                <template #label>
                  <div>
                    <div>{{ c.name }}</div>
                    <div class="rr-row-sub">
                      <span class="rr-mono">{{ idOf(c) }}</span> ·
                      {{
                        c.controllers === 0
                          ? 'games do not see it as a controller'
                          : `${c.axes} axes, ${c.buttons} buttons`
                      }}<template v-if="c.why"> · {{ c.why }}</template>
                    </div>
                  </div>
                </template>
              </v-radio>
            </v-radio-group>
            <v-text-field
              v-model="maker"
              label="Maker, if you know it"
              placeholder="VRS, Simucube, Leo Bodnar"
              density="compact"
              hide-details
              maxlength="60"
              class="wheel-add-maker"
              data-testid="wheel-add-maker"
            />
            <div class="wheel-add-lists">
              <div>
                <div class="wheel-add-head">What RigReady does for it</div>
                <ul data-testid="wheel-add-works">
                  <li v-for="line in UNLISTED_WORKS" :key="line">{{ line }}</li>
                </ul>
              </div>
              <div>
                <div class="wheel-add-head">Not available for a model RigReady does not know</div>
                <ul data-testid="wheel-add-not-available">
                  <li v-for="line in UNLISTED_NOT_AVAILABLE" :key="line">{{ line }}</li>
                </ul>
              </div>
            </div>
          </template>
          <p v-else data-testid="wheel-add-empty">
            No controller is connected that RigReady does not already know. Plug your wheel base in
            and switch it on; it then shows up here.
          </p>
          <p v-if="addError" class="rr-bad" data-testid="wheel-add-error">{{ addError }}</p>
          <div class="wheel-add-actions">
            <v-btn
              v-if="view.unlisted.length"
              color="primary"
              size="small"
              :loading="working"
              data-testid="wheel-add-confirm"
              @click="addWheel"
              >This is my wheel base</v-btn
            >
            <v-btn size="small" variant="text" data-testid="wheel-add-cancel" @click="closeAdd"
              >Cancel</v-btn
            >
          </div>
        </div>
        <div v-else class="mt-2">
          <v-btn
            size="small"
            variant="text"
            prepend-icon="mdi-help-circle-outline"
            data-testid="wheel-not-listed"
            @click="openAdd()"
            >My wheel is not listed</v-btn
          >
        </div>

        <div v-if="view.myWheels.length" class="rr-panel mt-3" data-testid="wheel-mine">
          <div
            v-for="w in view.myWheels"
            :key="idOf(w)"
            class="rr-row"
            data-testid="wheel-mine-row"
          >
            <v-icon
              :icon="w.connected ? 'mdi-check-circle' : 'mdi-close-circle'"
              :class="w.connected ? 'rr-ok' : 'rr-bad'"
              size="20"
            />
            <div class="rr-row-main">
              <div class="rr-row-title">{{ w.name }}</div>
              <div class="rr-row-sub">
                Added by you{{ w.maker ? ` · ${w.maker}` : '' }} ·
                <span class="rr-mono">{{ idOf(w) }}</span> ·
                {{ w.connected ? 'Connected' : 'Not connected' }}
              </div>
            </div>
            <v-btn
              size="small"
              variant="text"
              :disabled="working"
              data-testid="wheel-forget"
              @click="forgetWheel(w)"
              >Forget this wheel</v-btn
            >
          </div>
        </div>
      </section>

      <section v-if="status.unlisted" class="rc-section" data-testid="wheel-scope">
        <h2 class="rr-section-title">What RigReady does for this wheel base</h2>
        <div class="rr-panel">
          <div
            v-for="line in status.unlistedWorks"
            :key="line"
            class="rr-row rr-row-sub"
            data-testid="wheel-works"
          >
            <v-icon icon="mdi-check" size="18" class="rr-ok" />
            <span>{{ line }}</span>
          </div>
        </div>
        <h2 class="rr-section-title wheel-scope-next">Not available for this model</h2>
        <div class="rr-panel">
          <div
            v-for="line in status.unlistedNotAvailable"
            :key="line"
            class="rr-row rr-row-sub"
            data-testid="wheel-not-available"
          >
            <v-icon icon="mdi-minus-circle-outline" size="18" class="rr-muted" />
            <span>{{ line }}</span>
          </div>
        </div>
      </section>

      <section v-if="status.connected && status.axes.length" class="rc-section">
        <h2 class="rr-section-title">Axes</h2>
        <div class="rr-panel" data-testid="wheel-axes">
          <div class="rc-grid">
            <div v-for="a in status.axes" :key="a.axis" class="rc-pair" data-testid="wheel-axis">
              <span class="rc-pair-label rr-mono">{{ a.axis }}</span>
              <span class="rc-pair-value">{{ a.name }}</span>
            </div>
          </div>
        </div>
        <p class="rc-hint mt-2" data-testid="wheel-axes-note">
          <template v-if="status.axesSourced"
            >What each axis is on a {{ brandName }} base, as games see it. The maker's software can
            change some of them (separate or combined pedals); the
            <router-link to="/configure/devices/test" class="rec-link">input tester</router-link>
            shows what moves.</template
          >
          <template v-else-if="status.unlisted"
            >RigReady does not know this model, so these are the names Windows gives its axes. Move
            the wheel and pedals in the
            <router-link to="/configure/devices/test" class="rec-link">input tester</router-link> to
            see which is which.</template
          >
          <template v-else
            >No source RigReady trusts says what each axis is on a {{ brandName }} base, so these
            are the names Windows gives them. Move the wheel and pedals in the
            <router-link to="/configure/devices/test" class="rec-link">input tester</router-link> to
            see which is which.</template
          >
        </p>
      </section>

      <!-- An unlisted base has no software rows: "Not available for this model" above says why. -->
      <section v-if="!status.unlisted" class="rc-section">
        <h2 class="rr-section-title">
          {{ status.brand ? `${status.brandName} software` : 'Wheel software' }}
        </h2>
        <div class="rr-panel">
          <div
            v-for="s in status.software"
            :key="s.label"
            class="rr-row"
            data-testid="wheel-software"
          >
            <v-icon
              :icon="s.ok ? 'mdi-check-circle' : 'mdi-minus-circle-outline'"
              :class="s.ok ? 'rr-ok' : 'rr-muted'"
              size="20"
            />
            <div class="rr-row-main">
              <div class="rr-row-title">{{ s.label }}</div>
            </div>
            <span class="text-body-2">{{ s.value }}</span>
          </div>
          <div v-if="!status.software.length" class="rr-row" data-testid="wheel-no-software">
            <v-icon icon="mdi-minus-circle-outline" class="rr-muted" size="20" />
            <div class="rr-row-main">
              <div class="rr-row-title">
                {{
                  status.brand
                    ? `RigReady does not know the ${status.brandName} software yet`
                    : 'No wheel software RigReady knows is installed'
                }}
              </div>
            </div>
          </div>
          <div v-if="status.firmwareShipped" class="rr-row">
            <v-icon icon="mdi-chip" class="rr-muted" size="20" />
            <div class="rr-row-main">
              <div class="rr-row-title">Base firmware in this driver</div>
              <div class="rr-row-sub">
                The firmware on the base itself can only be read on the base or in the Fanatec App.
              </div>
            </div>
            <span class="text-body-2 rr-mono">{{ status.firmwareShipped }}</span>
          </div>
          <div v-for="l in status.lastSeen" :key="`${l.label}${l.value}`" class="rr-row">
            <v-icon icon="mdi-history" class="rr-muted" size="20" />
            <div class="rr-row-main">
              <div class="rr-row-title">{{ l.label }}</div>
              <div class="rr-row-sub">Last seen by the Fanatec driver</div>
            </div>
            <span class="text-body-2">{{ l.value }}</span>
          </div>
        </div>
        <p v-if="status.softwareNote" class="rc-hint mt-2" data-testid="wheel-software-note">
          {{ status.softwareNote }}
        </p>
      </section>

      <section v-if="presets && fanatec" class="rc-section" data-testid="wheel-presets">
        <div class="rc-section-head">
          <h2 class="rr-section-title">Your tuning presets</h2>
          <v-spacer />
          <span v-if="dirty" class="rc-hint">Not saved yet</span>
          <span v-else id="presets-save-hint" class="rc-hint">Nothing to save</span>
          <v-btn
            color="primary"
            size="small"
            :disabled="!dirty"
            :title="dirty ? undefined : 'Change a value below, then save.'"
            :aria-describedby="dirty ? undefined : 'presets-save-hint'"
            :loading="saving"
            data-testid="presets-save"
            @click="save"
            >Save presets</v-btn
          >
        </div>
        <div class="rc-notice">
          <v-icon icon="mdi-information-outline" class="rr-muted" />
          <div>
            The base keeps five tuning presets in its own memory. No file on this PC holds them and
            Fanatec offers no supported way to read them, so RigReady cannot back them up by itself.
            Write your values down here, from the base's display or the Fanatec App, and you have a
            record to set the base back from.
          </div>
        </div>
        <div v-if="saved" class="rc-message rr-ok" data-testid="presets-saved">
          <v-icon icon="mdi-check" size="16" /> {{ saved }}
        </div>
        <div class="rr-panel">
          <v-tabs v-model="slot" density="compact" class="px-2" data-testid="preset-tabs">
            <v-tab v-for="n in 5" :key="n" :value="n" :data-testid="`preset-tab-${n}`">
              Preset {{ n }}<span v-if="filled(n)" class="rr-muted ml-1">· {{ filled(n) }}</span>
            </v-tab>
          </v-tabs>
          <div v-if="current" class="preset-body">
            <div class="preset-top">
              <v-text-field
                v-model="current.name"
                label="Name"
                placeholder="iRacing GT3"
                density="compact"
                hide-details
                data-testid="preset-name"
                @update:model-value="((dirty = true), (saved = undefined))"
              />
              <v-checkbox
                :model-value="presets.activeSlot === current.slot"
                label="The preset I drive with"
                density="compact"
                hide-details
                data-testid="preset-active"
                @update:model-value="
                  (v) => {
                    if (v && presets) {
                      presets.activeSlot = current!.slot;
                      dirty = true;
                      saved = undefined;
                    }
                  }
                "
              />
            </div>
            <div class="preset-grid">
              <v-text-field
                v-for="p in PRESET_PARAMS"
                :key="p"
                :model-value="current.values[p] ?? ''"
                :label="p"
                :hint="`${paramName(p)}: ${paramMeaning(p)}`"
                density="compact"
                maxlength="12"
                :data-testid="`preset-${p}`"
                @update:model-value="(v: string) => setValue(p, v)"
              />
            </div>
            <v-text-field
              v-model="current.note"
              label="Note"
              placeholder="Which rim, which cars"
              density="compact"
              hide-details
              @update:model-value="((dirty = true), (saved = undefined))"
            />
          </div>
        </div>
      </section>

      <section v-if="fanatec" class="rc-section" data-testid="wheel-recommended">
        <h2 class="rr-section-title">Recommended settings</h2>
        <v-btn-toggle
          v-model="game"
          mandatory
          density="compact"
          variant="outlined"
          divided
          class="mb-3"
        >
          <v-btn
            v-for="c in view.comparisons"
            :key="c.game"
            :value="c.game"
            size="small"
            :data-testid="`recommended-${c.game}`"
            >{{ c.name }}</v-btn
          >
        </v-btn-toggle>
        <div v-if="comparison" class="rr-panel">
          <div class="rr-row">
            <div class="rr-row-main">
              <div class="rr-row-title">
                <a :href="comparison.source.url" target="_blank" rel="noopener" class="rec-link">{{
                  comparison.source.title
                }}</a>
                <v-chip size="x-small" variant="tonal" class="ml-2">{{
                  comparison.source.official ? 'Fanatec' : 'Community'
                }}</v-chip>
              </div>
              <div class="rr-row-sub">
                Retrieved {{ comparison.retrieved }}.
                <template v-if="comparison.caveat">{{ comparison.caveat }}</template>
                <template v-for="a in comparison.also" :key="a.url">
                  See also
                  <a :href="a.url" target="_blank" rel="noopener" class="rec-link">{{ a.title }}</a
                  >.
                </template>
              </div>
            </div>
          </div>
          <table class="rc-table" data-testid="recommended-table">
            <tr>
              <th>Setting</th>
              <th>Recommended</th>
              <th>On this PC</th>
              <th></th>
            </tr>
            <tr
              v-for="r in comparison.rows"
              :key="r.label"
              data-testid="recommended-row"
              :data-status="r.status"
            >
              <td>
                {{ r.label
                }}<span class="rr-muted">
                  · {{ r.where === 'base' ? 'on the wheel' : 'in the game' }}</span
                >
                <div v-if="r.note" class="rc-hint">{{ r.note }}</div>
              </td>
              <td>{{ r.recommended }}</td>
              <td>{{ r.current }}</td>
              <td class="text-no-wrap">
                <v-icon :icon="STATUS[r.status].icon" :class="STATUS[r.status].cls" size="16" />
                <span :class="STATUS[r.status].cls" class="ml-1">{{ STATUS[r.status].text }}</span>
              </td>
            </tr>
          </table>
          <p v-if="!comparison.installed" class="rc-hint px-4 py-3">
            The game was not found, so nothing in its files could be compared.
          </p>
        </div>
      </section>

      <section v-if="!fanatec && status.brand" class="rc-section" data-testid="wheel-recommended">
        <h2 class="rr-section-title">Recommended settings</h2>
        <div v-if="status.recommendedLinks.length" class="rr-panel">
          <div
            v-for="r in status.recommendedLinks"
            :key="r.url"
            class="rr-row"
            data-testid="wheel-recommended-link"
          >
            <v-icon icon="mdi-open-in-new" class="rr-muted" size="18" />
            <div class="rr-row-main">
              <div class="rr-row-title">
                <a :href="r.url" target="_blank" rel="noopener" class="rec-link">{{ r.title }}</a>
              </div>
              <div class="rr-row-sub">{{ r.game }}</div>
            </div>
            <v-chip size="x-small" variant="tonal">{{ status.brandName }}</v-chip>
          </div>
        </div>
        <p class="rc-hint mt-2" data-testid="wheel-recommended-note">
          <template v-if="status.recommendedLinks.length"
            >Published by {{ status.brandName }} itself. RigReady links to them and does not compare
            them with your files: the values are set in {{ status.brandName }}'s software and in the
            game.</template
          >
          <template v-else
            >{{ status.brandName }} publishes no recommended settings per game that RigReady could
            find, so none are shown. Community guides are not copied here.</template
          >
        </p>
      </section>

      <section
        v-if="!fanatec && status.profiles.length"
        class="rc-section"
        data-testid="wheel-profiles"
      >
        <h2 class="rr-section-title">{{ status.brandName }} profiles</h2>
        <div class="rr-panel">
          <div
            v-for="p in status.profiles"
            :key="p.path"
            class="rr-row"
            data-testid="wheel-profile"
          >
            <v-icon
              :icon="p.present ? 'mdi-file-check-outline' : 'mdi-file-hidden'"
              :class="p.present ? 'rr-ok' : 'rr-muted'"
              size="20"
            />
            <div class="rr-row-main">
              <div class="rr-row-title">{{ p.label }}</div>
              <div class="rr-row-sub rr-mono">{{ p.path }}</div>
            </div>
            <span class="text-body-2">{{ p.present ? 'On this PC' : 'Not found' }}</span>
          </div>
        </div>
      </section>

      <BackupsPanel
        v-if="fanatec"
        game="fanatec"
        what="Fanatec App settings"
        closed-hint="The Fanatec App's window settings and choices are restored. The Fanatec Service registry settings are kept as a record only: RigReady never writes the registry."
      />
      <BackupsPanel
        v-else-if="backupGame"
        :key="backupGame"
        :game="backupGame"
        :what="`${status.brandName} profiles`"
        :closed-hint="`The ${status.brandName} software must be closed while its profiles are restored; RigReady offers to close it and start it again.`"
      />
    </template>
  </div>
</template>

<style scoped>
.wheel-add {
  padding: 16px;
  display: grid;
  gap: 12px;
}
.wheel-add-title {
  font-size: 15px;
  font-weight: 600;
  margin: 0;
}
.wheel-add-maker {
  max-width: 360px;
}
.wheel-add-lists {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  font-size: 13px;
}
.wheel-add-lists ul {
  margin: 4px 0 0;
  padding-left: 18px;
}
.wheel-add-lists li {
  margin-bottom: 4px;
}
.wheel-add-head {
  font-weight: 600;
}
.rr-section-title.wheel-scope-next {
  margin-top: 26px;
}
.wheel-add-actions {
  display: flex;
  gap: 8px;
}
.preset-body {
  padding: 16px;
  display: grid;
  gap: 14px;
}
.preset-top {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 16px;
  align-items: center;
}
.preset-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 4px 10px;
}
.rec-link {
  color: var(--rr-accent);
  text-decoration: none;
}
.rec-link:hover {
  text-decoration: underline;
}
</style>
