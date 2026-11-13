<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import EmptyState from '../../../renderer/components/EmptyState.vue';
import PageSkeleton from '../../../renderer/components/PageSkeleton.vue';
import SaveBar from '../../../renderer/components/SaveBar.vue';
import { errorText, useClient } from '../../../renderer/ipc';
import type { PadReport } from '../../../shared/models';
import { virtualControllerContract } from '../contract';
import { gameNoteCount, gameNoteText, withoutGameNotes } from '../core/gameNotes';
import { wheelRange } from '../core/mapping';
import { nameKey, nameTakenText } from '../core/names';
import {
  BUTTON_BITS,
  BUTTON_NAMES,
  DS4_LABELS,
  inputLabel,
  PART_LABELS,
  STICK_NAMES,
  type ButtonName,
  type PadProfile,
  type Source,
  type StickName,
} from '../core/profile';
import PadPicture from './PadPicture.vue';
import PartText from './PartText.vue';

/**
 * One virtual controller profile: for every stick, trigger and button, the real control
 * that drives it (picked by pressing or moving it) and how (invert, deadzone, curve,
 * range). The picture and the bars show what a game would get, live. Save and Back stay
 * in view at the bottom, with a word on whether there are unsaved changes.
 */
const PAGE = '/configure/virtual-controller';
/** How long a part waits for a press. */
const SECONDS = 10;

const api = useClient(virtualControllerContract);
const route = useRoute();
const router = useRouter();
const profile = ref<PadProfile>();
/** Why the profile could not be read. */
const error = ref<string>();
const saveError = ref<string>();
const savedText = ref<string>();
const saving = ref(false);
const listening = ref<string>();
const secondsLeft = ref(SECONDS);
/** How the last try to pick a control ended when it picked none, on the part's own row. */
const rowNote = ref<{ part: string; text: string; bad: boolean }>();
const live = ref<PadReport>();
const wheel = ref({ rotation: 900, lock: 270 });
/** The other profiles' names: a new name cannot be one of them. */
const others = ref<{ id: string; name: string }[]>([]);

const id = computed(() => String(route.query['id'] ?? ''));
/** No profile, or one that is not there (deleted, or a link from elsewhere). */
const missing = ref(false);

/** One text for one content, whatever order the parts were touched in. */
const stable = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v
  );
/** The profile as it was read or last saved. */
const savedCopy = ref<string>();
const savedName = ref('');
function taken(saved: PadProfile): void {
  profile.value = saved;
  savedCopy.value = stable(saved);
  savedName.value = saved.name;
}

async function load(): Promise<void> {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id.value)) {
    missing.value = true;
    return;
  }
  const [result, state] = await Promise.all([api.profile({ id: id.value }), api.state()]);
  if (state.ok) {
    others.value = [...state.value.profiles.builtin, ...state.value.profiles.mine]
      .filter((p) => p.id !== id.value)
      .map((p) => ({ id: p.id, name: p.name }));
  }
  if (result.ok) {
    taken(result.value);
    error.value = undefined;
  } else if (result.error.code === 'vc.unknownProfile') {
    missing.value = true;
  } else {
    error.value = errorText(result.error);
  }
}

let offLive: (() => void) | undefined;
let liveTimer: ReturnType<typeof setTimeout> | undefined;
let tick: ReturnType<typeof setInterval> | undefined;
onMounted(async () => {
  offLive = api.on('live', (event) => {
    live.value = event.report;
  });
  await load();
});
onBeforeUnmount(() => {
  offLive?.();
  clearTimeout(liveTimer);
  clearInterval(tick);
  void api.live({ on: false });
});

// The live view follows the profile as it is edited, a moment after the last change.
watch(
  profile,
  (value) => {
    if (!value) return;
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => {
      void api.live({ on: true, profile: JSON.parse(JSON.stringify(value)) as PadProfile });
    }, 150);
  },
  { deep: true }
);

const builtin = computed(() => profile.value?.id.startsWith('starting-') === true);
const dirty = computed(
  () => profile.value !== undefined && !builtin.value && stable(profile.value) !== savedCopy.value
);
// "Saved ..." stands until the next change.
watch(dirty, (now) => {
  if (now) savedText.value = undefined;
});

/** Another profile with the name in the field. */
const sameName = computed(() => {
  const name = profile.value?.name;
  return name === undefined
    ? undefined
    : others.value.find((o) => nameKey(o.name) === nameKey(name));
});
const nameChanged = computed(
  () => profile.value !== undefined && nameKey(profile.value.name) !== nameKey(savedName.value)
);
/** A new name another profile has: it cannot be saved. */
const nameTaken = computed(() =>
  sameName.value && nameChanged.value ? nameTakenText(sameName.value) : undefined
);
/** Why Save is off, in words. */
const blocked = computed(() => {
  if (builtin.value) return 'A starting point is copied, not saved. Go back and make a copy.';
  if (profile.value?.name.trim() === '') return 'Give the profile a name to save it.';
  if (nameTaken.value) return 'Give the profile a name no other profile has to save it.';
  return undefined;
});

const split = computed({
  get: () => profile.value?.throttle !== undefined,
  set: (on: boolean) => {
    if (!profile.value) return;
    if (on) profile.value.throttle = { invert: false, split: 0.5, deadzone: 0.05, curve: 1 };
    else delete profile.value.throttle;
  },
});

const label = (part: string): string => {
  const ds4 = profile.value?.kind === 'ds4' ? DS4_LABELS[part] : undefined;
  return ds4 ? `${PART_LABELS[part]} / ${ds4}` : (PART_LABELS[part] ?? part);
};
/** A slider's spoken name: which part it shapes, and how ("Left stick X: deadzone"). */
const sliderName = (part: string, what: string): string => `${label(part)}: ${what}`;
const sourceText = (source: Source | undefined): string =>
  source ? `${source.device.name}: ${inputLabel(source.input, source.when)}` : 'Not mapped';
/** A part's note for the profile's game, said to be for that game. */
const gameNote = (note: string | undefined): string | undefined =>
  note && profile.value ? gameNoteText(profile.value, note) : undefined;
const noteFor = (part: string): { text: string; bad: boolean } | undefined =>
  rowNote.value?.part === part ? rowNote.value : undefined;
const notes = computed(() => (profile.value ? gameNoteCount(profile.value) : 0));

/** Takes the notes for one game off the profile; the mapping and the plain hints stay. */
function dropNotes(): void {
  if (profile.value) profile.value = withoutGameNotes(profile.value);
}

/** Waits for the next control the user touches and puts it on this part. */
async function pick(part: string): Promise<void> {
  if (!profile.value || listening.value !== undefined) return;
  listening.value = part;
  rowNote.value = undefined;
  secondsLeft.value = SECONDS;
  tick = setInterval(() => {
    secondsLeft.value = Math.max(0, secondsLeft.value - 1);
  }, 1000);
  const result = await api.detect({ seconds: SECONDS });
  clearInterval(tick);
  listening.value = undefined;
  if (!result.ok) {
    rowNote.value = { part, text: errorText(result.error), bad: true };
    return;
  }
  const press = result.value.press;
  if (!press) {
    rowNote.value = {
      part,
      text: `Nothing was pressed or moved in ${SECONDS} seconds. Press "Press or move" to try again.`,
      bad: false,
    };
    return;
  }
  const source: Source = { device: press.device, input: press.input };
  const p = profile.value;
  if ((STICK_NAMES as readonly string[]).includes(part))
    p.sticks[part as StickName].source = source;
  else if (part === 'lt' || part === 'rt') p.triggers[part].source = source;
  else if (part === 'throttle' && p.throttle) p.throttle.source = source;
  else {
    const name = part as ButtonName;
    // An axis on a button: pressed when it is pushed past half of its travel.
    p.buttons[name] = {
      ...(p.buttons[name] ?? {}),
      source: press.kind === 'axis' ? { ...source, when: 'above' } : source,
    };
  }
}

function clear(part: string): void {
  const p = profile.value;
  if (!p) return;
  if ((STICK_NAMES as readonly string[]).includes(part)) delete p.sticks[part as StickName].source;
  else if (part === 'lt' || part === 'rt') delete p.triggers[part].source;
  else if (part === 'throttle' && p.throttle) delete p.throttle.source;
  else if (p.buttons[part as ButtonName]) delete p.buttons[part as ButtonName]!.source;
}

function flipSide(name: ButtonName): void {
  const source = profile.value?.buttons[name]?.source;
  if (source?.when) source.when = source.when === 'above' ? 'below' : 'above';
}

function applyWheel(): void {
  if (!profile.value) return;
  profile.value.sticks.lx.range =
    Math.round(wheelRange(wheel.value.rotation, wheel.value.lock) * 100) / 100;
}

async function save(): Promise<void> {
  if (!profile.value || saving.value) return;
  saving.value = true;
  saveError.value = undefined;
  const result = await api.save({
    profile: JSON.parse(JSON.stringify(profile.value)) as PadProfile,
  });
  saving.value = false;
  if (result.ok) {
    taken(result.value);
    savedText.value = `Saved ${result.value.name}`;
  } else {
    saveError.value = errorText(result.error);
  }
}

const pct = (v: number): string => `${Math.round(v * 100)}%`;
const stickValue = (name: StickName): number => live.value?.[name] ?? 0;
const pressed = (name: ButtonName): boolean =>
  ((live.value?.buttons ?? 0) & BUTTON_BITS[name]) !== 0;
</script>

<template>
  <div class="rr-page" data-testid="vc-editor">
    <h1 class="rr-page-title">{{ profile?.name ?? 'Virtual controller profile' }}</h1>
    <p class="rr-page-sub">
      For each part of the virtual controller, press or move the control that should drive it. The
      picture and the bars show what a game would get.
    </p>

    <v-alert v-if="error" type="error" variant="tonal" class="mb-4" data-testid="vc-editor-error">{{
      error
    }}</v-alert>

    <template v-if="profile">
      <div v-if="builtin" class="rr-panel vc-note rr-warn" data-testid="vc-editor-builtin">
        <v-icon icon="mdi-alert" size="16" /> A starting point: it cannot be changed or started. Go
        back and make a copy.
      </div>

      <div class="rr-panel vc-head">
        <v-text-field
          v-model="profile.name"
          label="Name"
          density="compact"
          hide-details="auto"
          maxlength="80"
          :error-messages="nameTaken ? [nameTaken] : []"
          :disabled="builtin"
          data-testid="vc-editor-name"
        />
        <v-select
          v-model="profile.kind"
          :items="[
            { title: 'Xbox 360 controller (XInput)', value: 'xbox360' },
            { title: 'DualShock 4', value: 'ds4' },
          ]"
          label="Games see"
          density="compact"
          hide-details
          :disabled="builtin"
          data-testid="vc-editor-kind"
        />
        <div v-if="builtin" class="rr-row-sub">Starting points cannot be changed.</div>
        <div v-else class="rr-row-sub" data-testid="vc-editor-id">
          Id: <span class="rr-mono">{{ profile.id }}</span>
        </div>
        <div
          v-if="sameName && !nameChanged && !builtin"
          class="rr-row-sub rr-warn vc-head-wide"
          data-testid="vc-editor-same-name"
        >
          <v-icon icon="mdi-alert" size="13" /> Another profile ({{ sameName.id }}) has this name
          too. Give this one a different name, so the two can be told apart.
        </div>
      </div>

      <div v-if="profile.game" class="rr-panel vc-game" data-testid="vc-game">
        <div class="rr-row-main">
          <div class="rr-row-title">Notes for {{ profile.game }}</div>
          <div class="rr-row-sub">
            {{ notes }} {{ notes === 1 ? 'part says' : 'parts say' }} what
            {{ notes === 1 ? 'it does' : 'they do' }} in {{ profile.game }}. They are notes only:
            the profile works with any game that reads a gamepad. For another game, remove the
            notes; the controls you chose stay.
          </div>
        </div>
        <v-btn
          size="small"
          variant="tonal"
          :disabled="builtin"
          data-testid="vc-drop-notes"
          @click="dropNotes"
          >Remove the notes for {{ profile.game }}</v-btn
        >
      </div>

      <div class="rr-panel vc-live" data-testid="vc-editor-live">
        <PadPicture :report="live" :kind="profile.kind" />
        <div class="rr-row-sub">
          What a game would get from this profile now. Move the stick or press a button to try it;
          nothing needs saving first.
        </div>
      </div>

      <h2 class="rr-section-title">Sticks</h2>
      <div class="rr-panel">
        <div
          v-for="name in STICK_NAMES"
          :key="name"
          class="vc-part"
          data-testid="vc-part"
          :data-part="name"
        >
          <div class="vc-part-head">
            <PartText
              :title="label(name)"
              :hint="profile.sticks[name].hint"
              :game-note="gameNote(profile.sticks[name].gameHint)"
              :source="sourceText(profile.sticks[name].source)"
              :listening="listening === name"
              :seconds-left="secondsLeft"
              :note="noteFor(name)"
            />
            <div class="vc-bar" :aria-label="`${label(name)}: ${pct(stickValue(name))}`" role="img">
              <div
                class="vc-bar-fill vc-bar-centred"
                :style="{
                  left: `${50 + Math.min(0, stickValue(name)) * 50}%`,
                  width: `${Math.abs(stickValue(name)) * 50}%`,
                }"
              />
            </div>
            <span class="rr-num vc-value" data-testid="vc-part-value">{{
              pct(stickValue(name))
            }}</span>
            <v-btn
              size="small"
              variant="tonal"
              :disabled="builtin || (listening !== undefined && listening !== name)"
              :loading="listening === name"
              data-testid="vc-pick"
              @click="pick(name)"
              >Press or move</v-btn
            >
            <v-btn
              size="small"
              variant="text"
              :disabled="builtin || !profile.sticks[name].source"
              data-testid="vc-clear"
              @click="clear(name)"
              >Clear</v-btn
            >
          </div>
          <div v-if="profile.sticks[name].source" class="vc-shape">
            <v-switch
              v-model="profile.sticks[name].invert"
              label="Invert"
              density="compact"
              hide-details
              color="primary"
              data-testid="vc-invert"
            />
            <v-slider
              v-model="profile.sticks[name].deadzone"
              label="Deadzone"
              :name="sliderName(name, 'deadzone')"
              :min="0"
              :max="0.5"
              :step="0.01"
              density="compact"
              hide-details
              thumb-label
              data-testid="vc-deadzone"
            />
            <v-slider
              v-model="profile.sticks[name].curve"
              label="Curve"
              :name="sliderName(name, 'curve')"
              :min="0.2"
              :max="3"
              :step="0.1"
              density="compact"
              hide-details
              thumb-label
              data-testid="vc-curve"
            />
            <v-slider
              v-model="profile.sticks[name].range"
              label="Full at"
              :name="sliderName(name, 'full at')"
              :min="0.05"
              :max="1"
              :step="0.05"
              density="compact"
              hide-details
              thumb-label
              data-testid="vc-range"
            />
          </div>
          <div
            v-if="name === 'lx' && profile.sticks.lx.source"
            class="vc-wheel"
            data-testid="vc-wheel"
          >
            <span class="rr-row-sub">Steering wheel:</span>
            <v-text-field
              v-model.number="wheel.rotation"
              type="number"
              label="Wheel turns (degrees, lock to lock)"
              density="compact"
              hide-details
              data-testid="vc-wheel-rotation"
            />
            <v-text-field
              v-model.number="wheel.lock"
              type="number"
              label="Full stick at (degrees)"
              density="compact"
              hide-details
              data-testid="vc-wheel-lock"
            />
            <v-btn size="small" variant="tonal" data-testid="vc-wheel-apply" @click="applyWheel"
              >Set the range</v-btn
            >
          </div>
        </div>
      </div>

      <h2 class="rr-section-title vc-section">Triggers</h2>
      <div class="rr-panel">
        <v-switch
          v-model="split"
          :disabled="builtin"
          label="One throttle axis on both triggers (forward is RT, back is LT)"
          density="compact"
          hide-details
          color="primary"
          class="vc-split-switch"
          data-testid="vc-split"
        />
        <div class="rr-row-sub vc-split-note" data-testid="vc-split-note">
          On: one axis presses RT ahead of the split and LT behind it, so it can never press both at
          once. Off: RT and LT each take a control of their own, an axis or a button. Turn it off
          for a game that reads both triggers held together.
        </div>
        <div v-if="profile.throttle" class="vc-part" data-testid="vc-part" data-part="throttle">
          <div class="vc-part-head">
            <PartText
              :title="label('throttle')"
              :hint="profile.throttle.hint"
              :game-note="gameNote(profile.throttle.gameHint)"
              :source="sourceText(profile.throttle.source)"
              :listening="listening === 'throttle'"
              :seconds-left="secondsLeft"
              :note="noteFor('throttle')"
            />
            <span class="rr-num vc-value" data-testid="vc-part-value"
              >LT {{ pct(live?.lt ?? 0) }} · RT {{ pct(live?.rt ?? 0) }}</span
            >
            <v-btn
              size="small"
              variant="tonal"
              :disabled="builtin || (listening !== undefined && listening !== 'throttle')"
              :loading="listening === 'throttle'"
              data-testid="vc-pick"
              @click="pick('throttle')"
              >Press or move</v-btn
            >
            <v-btn
              size="small"
              variant="text"
              :disabled="builtin || !profile.throttle.source"
              data-testid="vc-clear"
              @click="clear('throttle')"
              >Clear</v-btn
            >
          </div>
          <div v-if="profile.throttle.source" class="vc-shape">
            <v-switch
              v-model="profile.throttle.invert"
              label="Invert"
              density="compact"
              hide-details
              color="primary"
              data-testid="vc-invert"
            />
            <v-slider
              v-model="profile.throttle.split"
              label="Split at"
              :name="sliderName('throttle', 'split at')"
              :min="0.05"
              :max="0.95"
              :step="0.01"
              density="compact"
              hide-details
              thumb-label
              data-testid="vc-split-at"
            />
            <v-slider
              v-model="profile.throttle.deadzone"
              label="Deadzone"
              :name="sliderName('throttle', 'deadzone')"
              :min="0"
              :max="0.5"
              :step="0.01"
              density="compact"
              hide-details
              thumb-label
              data-testid="vc-deadzone"
            />
            <v-slider
              v-model="profile.throttle.curve"
              label="Curve"
              :name="sliderName('throttle', 'curve')"
              :min="0.2"
              :max="3"
              :step="0.1"
              density="compact"
              hide-details
              thumb-label
              data-testid="vc-curve"
            />
          </div>
        </div>
        <template v-else>
          <div
            v-for="name in ['lt', 'rt'] as const"
            :key="name"
            class="vc-part"
            data-testid="vc-part"
            :data-part="name"
          >
            <div class="vc-part-head">
              <PartText
                :title="label(name)"
                :hint="profile.triggers[name].hint"
                :game-note="gameNote(profile.triggers[name].gameHint)"
                :source="sourceText(profile.triggers[name].source)"
                :listening="listening === name"
                :seconds-left="secondsLeft"
                :note="noteFor(name)"
              />
              <div
                class="vc-bar"
                :aria-label="`${label(name)}: ${pct(live?.[name] ?? 0)}`"
                role="img"
              >
                <div class="vc-bar-fill" :style="{ width: `${(live?.[name] ?? 0) * 100}%` }" />
              </div>
              <span class="rr-num vc-value" data-testid="vc-part-value">{{
                pct(live?.[name] ?? 0)
              }}</span>
              <v-btn
                size="small"
                variant="tonal"
                :disabled="builtin || (listening !== undefined && listening !== name)"
                :loading="listening === name"
                data-testid="vc-pick"
                @click="pick(name)"
                >Press or move</v-btn
              >
              <v-btn
                size="small"
                variant="text"
                :disabled="builtin || !profile.triggers[name].source"
                data-testid="vc-clear"
                @click="clear(name)"
                >Clear</v-btn
              >
            </div>
            <div v-if="profile.triggers[name].source" class="vc-shape">
              <v-switch
                v-model="profile.triggers[name].invert"
                label="Invert (the pedal reads the other way)"
                density="compact"
                hide-details
                color="primary"
                data-testid="vc-invert"
              />
              <v-slider
                v-model="profile.triggers[name].deadzone"
                label="Deadzone"
                :name="sliderName(name, 'deadzone')"
                :min="0"
                :max="0.5"
                :step="0.01"
                density="compact"
                hide-details
                thumb-label
                data-testid="vc-deadzone"
              />
              <v-slider
                v-model="profile.triggers[name].curve"
                label="Curve"
                :name="sliderName(name, 'curve')"
                :min="0.2"
                :max="3"
                :step="0.1"
                density="compact"
                hide-details
                thumb-label
                data-testid="vc-curve"
              />
              <v-slider
                v-model="profile.triggers[name].range"
                label="Full at"
                :name="sliderName(name, 'full at')"
                :min="0.05"
                :max="1"
                :step="0.05"
                density="compact"
                hide-details
                thumb-label
                data-testid="vc-range"
              />
            </div>
          </div>
        </template>
      </div>

      <h2 class="rr-section-title vc-section">Buttons and d-pad</h2>
      <div class="rr-panel">
        <div
          v-for="name in BUTTON_NAMES"
          :key="name"
          class="vc-part vc-part-head"
          data-testid="vc-part"
          :data-part="name"
        >
          <span class="vc-led" :aria-label="pressed(name) ? 'Pressed' : 'Not pressed'" role="img">
            <v-icon :icon="pressed(name) ? 'mdi-circle' : 'mdi-circle-outline'" size="12" />
          </span>
          <PartText
            :title="label(name)"
            :hint="profile.buttons[name]?.hint"
            :game-note="gameNote(profile.buttons[name]?.gameHint)"
            :source="sourceText(profile.buttons[name]?.source)"
            :listening="listening === name"
            :seconds-left="secondsLeft"
            :note="noteFor(name)"
          />
          <v-btn
            v-if="profile.buttons[name]?.source?.when"
            size="small"
            variant="text"
            data-testid="vc-flip"
            @click="flipSide(name)"
            >Other side</v-btn
          >
          <v-btn
            size="small"
            variant="tonal"
            :disabled="builtin || (listening !== undefined && listening !== name)"
            :loading="listening === name"
            data-testid="vc-pick"
            @click="pick(name)"
            >Press or move</v-btn
          >
          <v-btn
            size="small"
            variant="text"
            :disabled="builtin || !profile.buttons[name]?.source"
            data-testid="vc-clear"
            @click="clear(name)"
            >Clear</v-btn
          >
        </div>
      </div>

      <SaveBar
        :dirty="dirty"
        :saving="saving"
        :blocked="blocked"
        :error="saveError"
        :saved="savedText"
        :back-to="PAGE"
        @save="save"
      />
    </template>
    <EmptyState
      v-else-if="missing"
      art="device"
      title="No such profile"
      data-testid="vc-editor-missing"
    >
      This profile is not there. Pick one on the Virtual controller page, or make a copy of a
      starting point.
      <template #action>
        <v-btn color="primary" @click="router.push(PAGE)">Open Virtual controller</v-btn>
      </template>
    </EmptyState>
    <PageSkeleton v-else-if="!error" label="Reading the profile…" />
  </div>
</template>

<style scoped>
.vc-note {
  padding: 12px 16px;
  margin-bottom: 12px;
}
.vc-head {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 12px;
  padding: 14px 16px;
  margin-bottom: 12px;
}
.vc-head-wide {
  grid-column: 1 / -1;
}
.vc-game,
.vc-live {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  margin-bottom: 12px;
}
.vc-live {
  margin-bottom: 20px;
}
.vc-part {
  padding: 8px 14px;
  border-bottom: 1px solid var(--rr-border);
}
.vc-part:last-child {
  border-bottom: none;
}
.vc-part-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.vc-shape {
  display: grid;
  grid-template-columns: auto 1fr 1fr 1fr;
  gap: 4px 16px;
  align-items: center;
  padding: 4px 0 0 4px;
}
.vc-wheel {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0 4px 4px;
}
.vc-bar {
  position: relative;
  width: 120px;
  height: 8px;
  border-radius: 4px;
  background: var(--rr-surface-2);
  border: 1px solid var(--rr-border);
  overflow: hidden;
}
.vc-bar-fill {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  background: var(--rr-accent);
}
.vc-value {
  width: 96px;
  text-align: right;
  font-size: var(--rr-text-sm);
}
.vc-led {
  display: inline-flex;
  width: 16px;
}
.vc-split-switch {
  padding: 6px 14px 0;
}
.vc-split-note {
  padding: 0 14px 8px;
  border-bottom: 1px solid var(--rr-border);
}
.vc-section {
  margin-top: 24px;
}
</style>
