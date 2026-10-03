<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { errorText, useClient } from '../../../renderer/ipc';
import { onMachineChanged } from '../../../renderer/machine';
import { PRESET_PARAMS, racingContract, type WheelPresets, type WheelView } from '../contract';
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
          Your Fanatec wheel base, its software, and the tuning it keeps on the wheel itself.
        </p>
      </div>
    </div>

    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>

    <template v-if="view">
      <section class="rc-section">
        <h2 class="rr-section-title">Wheel base</h2>
        <div class="rr-panel" data-testid="wheel-status">
          <div class="rr-row">
            <v-icon
              :icon="
                view.status.connected
                  ? view.status.mode === 'pc'
                    ? 'mdi-check-circle'
                    : 'mdi-alert'
                  : 'mdi-close-circle'
              "
              :class="
                view.status.connected ? (view.status.mode === 'pc' ? 'rr-ok' : 'rr-warn') : 'rr-bad'
              "
              size="28"
            />
            <div class="rr-row-main">
              <div class="rr-row-title" data-testid="wheel-name">
                {{ view.status.name ?? 'No Fanatec wheel base connected' }}
              </div>
              <div class="rr-row-sub" data-testid="wheel-mode">
                <template v-if="view.status.connected">
                  {{ view.status.mode === 'pc' ? 'PC (red) mode' : 'Compatibility (yellow) mode' }}
                  ·
                  <span class="rr-mono"
                    >{{ view.status.vendorId }}:{{ view.status.productId }}</span
                  >
                  <template v-if="view.status.connection"> · {{ view.status.connection }}</template>
                </template>
                <template v-else
                  >Plug it in and switch it on; this page updates by itself.</template
                >
              </div>
            </div>
          </div>
          <div
            v-if="view.status.connected"
            class="rr-row rr-row-sub"
            data-testid="wheel-controllers"
          >
            <v-icon icon="mdi-information-outline" size="18" class="rr-muted" />
            <span>
              Games see this base as
              {{
                view.status.controllers === 1
                  ? 'one controller'
                  : `${view.status.controllers} controllers`
              }}. A Podium base normally shows up as two controllers with the same name; both are
              the base, not a duplicate, and games use the first.
            </span>
          </div>
          <div v-if="view.status.accessories.length" class="rr-row rr-row-sub">
            <v-icon icon="mdi-usb" size="18" class="rr-muted" /> Also connected:
            {{ view.status.accessories.join(', ') }}
          </div>
        </div>
        <div
          v-if="view.status.mode === 'compatibility'"
          class="rc-notice warn mt-3"
          data-testid="wheel-compat"
        >
          <v-icon icon="mdi-alert" class="rr-warn" />
          <div>
            The base is in compatibility (yellow) mode and reports itself as a ClubSport Wheel Base
            V2.5. Bindings saved in PC mode do not match it in iRacing, Le Mans Ultimate or
            BeamNG.drive. Switch it to PC (red) mode in the base's menu or the Fanatec App.
          </div>
        </div>
      </section>

      <section class="rc-section">
        <h2 class="rr-section-title">Fanatec software</h2>
        <div class="rr-panel">
          <div
            v-for="s in view.status.software"
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
          <div v-if="view.status.firmwareShipped" class="rr-row">
            <v-icon icon="mdi-chip" class="rr-muted" size="20" />
            <div class="rr-row-main">
              <div class="rr-row-title">Base firmware in this driver</div>
              <div class="rr-row-sub">
                The firmware on the base itself can only be read on the base or in the Fanatec App.
              </div>
            </div>
            <span class="text-body-2 rr-mono">{{ view.status.firmwareShipped }}</span>
          </div>
          <div v-for="l in view.status.lastSeen" :key="`${l.label}${l.value}`" class="rr-row">
            <v-icon icon="mdi-history" class="rr-muted" size="20" />
            <div class="rr-row-main">
              <div class="rr-row-title">{{ l.label }}</div>
              <div class="rr-row-sub">Last seen by the Fanatec driver</div>
            </div>
            <span class="text-body-2">{{ l.value }}</span>
          </div>
        </div>
      </section>

      <section v-if="presets" class="rc-section" data-testid="wheel-presets">
        <div class="rc-section-head">
          <h2 class="rr-section-title">Your tuning presets</h2>
          <v-spacer />
          <span v-if="dirty" class="rc-hint">Not saved yet</span>
          <v-btn
            color="primary"
            size="small"
            :disabled="!dirty"
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

      <section class="rc-section" data-testid="wheel-recommended">
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

      <BackupsPanel
        game="fanatec"
        what="Fanatec App settings"
        closed-hint="The Fanatec App's window settings and choices are restored. The Fanatec Service registry settings are kept as a record only: RigReady never writes the registry."
      />
    </template>
  </div>
</template>

<style scoped>
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
