<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import ConfirmChanges from '../../../renderer/components/ConfirmChanges.vue';
import { errorText, useClient } from '../../../renderer/ipc';
import {
  iracingBindingsContract,
  type Action,
  type BindingSet,
  type ChangeRequest,
  type ChangeResult,
  type ChangeReview,
  type Pressed,
  type WantedBinding,
} from '../contract';
import { iracingKeyOf } from '../core/keys';
import { inWords } from '../core/names';

/**
 * Changes one binding of one set: press the button or the key, or clear it. What would
 * change is shown first (the binding now and after, what else the same input does, the
 * file), and nothing is written until the user presses Save there: a press only asks main
 * for the review (changePreview); `change` is called from the review's Save alone.
 */
const props = defineProps<{
  /** The action to change. The dialog is open while there is one. */
  action: Action | undefined;
  set: BindingSet;
}>();
const emit = defineEmits<{ close: []; saved: [result: ChangeResult] }>();

const api = useClient(iracingBindingsContract);
const listening = ref(false);
const checking = ref(false);
/** Why the last press was not taken, or why the change could not be worked out. */
const note = ref<string>();
const request = ref<ChangeRequest>();
const review = ref<ChangeReview>();
const saving = ref(false);
const saveError = ref<string>();
let off: (() => void) | undefined;
/** Main was asked to report controller presses and has not been told to stop yet. */
let reporting = false;

const takesButton = computed(() => props.action?.accepts.includes('button') ?? false);
const takesKey = computed(() => props.action?.accepts.includes('key') ?? false);
const what = computed(() =>
  takesButton.value && takesKey.value
    ? 'the button or the key'
    : takesButton.value
      ? 'the button'
      : 'the key'
);
const where = computed(() =>
  takesButton.value && takesKey.value
    ? 'A button on a controller, or a key on the keyboard.'
    : takesButton.value
      ? 'A button on a controller. iRacing does not take a key for this action.'
      : 'A key on the keyboard. iRacing does not take a button for this action.'
);

/**
 * Counts the listens and their ends. A listen that was cut short (Clear, Close, another
 * action) while main was still starting the controllers takes no key and no press after.
 */
let listens = 0;

async function stopListening(): Promise<void> {
  listens++;
  window.removeEventListener('keydown', onKey, true);
  off?.();
  off = undefined;
  listening.value = false;
  if (reporting) {
    reporting = false;
    await api.listenStop();
  }
}

/** Asks main what this binding would change. Nothing is written. */
async function choose(binding: WantedBinding | null): Promise<void> {
  const action = props.action;
  if (!action || checking.value) return;
  await stopListening();
  note.value = undefined;
  checking.value = true;
  const wanted: ChangeRequest = { set: props.set.id, action: action.id, binding };
  const result = await api.changePreview(wanted);
  checking.value = false;
  // Closed, or another action opened, while main was working it out.
  if (props.action !== action) return;
  if (!result.ok) {
    note.value = errorText(result.error);
    return;
  }
  // Save writes only into the file this was worked out from.
  request.value = { ...wanted, seen: result.value.seen };
  review.value = result.value;
}

function onPressed(pressed: Pressed): void {
  if (!listening.value) return;
  if (pressed.kind === 'axis') {
    note.value = `That was an axis on ${pressed.deviceName}. Bind an axis in iRacing: it calibrates the axis as it binds it.`;
    return;
  }
  if (pressed.kind !== 'button' || pressed.button === undefined) {
    note.value = `That was a hat switch on ${pressed.deviceName}. RigReady binds buttons and keys only. Bind a hat switch in iRacing.`;
    return;
  }
  if (pressed.button > 128) {
    note.value = 'iRacing bindings hold buttons 1 to 128 of a controller.';
    return;
  }
  void choose({ kind: 'button', device: pressed.device, button: pressed.button });
}

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    // Esc ends the listening, not the dialog; the next Esc closes it.
    event.preventDefault();
    event.stopImmediatePropagation();
    void stopListening();
    return;
  }
  if (!takesKey.value) return;
  // While it listens, a key is the answer: it must not click a button or open the palette.
  event.preventDefault();
  event.stopImmediatePropagation();
  if (event.repeat) return;
  const got = iracingKeyOf(event);
  if (got.kind === 'waiting') return;
  if (got.kind === 'refused') {
    note.value = got.why;
    return;
  }
  void choose({ kind: 'key', keyCode: got.keyCode, modifiers: got.modifiers });
}

async function listen(): Promise<void> {
  note.value = undefined;
  const mine = ++listens;
  if (takesButton.value) {
    off = api.on('pressed', onPressed);
    reporting = true;
    const started = await api.listenStart();
    // Cut short meanwhile: stopListening has run and told main to stop.
    if (mine !== listens) return;
    if (!started.ok) {
      reporting = false;
      off();
      off = undefined;
      note.value = errorText(started.error);
      // A key can still be bound without the controllers.
      if (!takesKey.value) return;
    }
  }
  window.addEventListener('keydown', onKey, true);
  listening.value = true;
}

function reset(): void {
  void stopListening();
  note.value = undefined;
  request.value = undefined;
  review.value = undefined;
  saveError.value = undefined;
  checking.value = false;
  saving.value = false;
}

watch(() => props.action, reset);

function close(): void {
  void stopListening();
  emit('close');
}

async function save(): Promise<void> {
  const wanted = request.value;
  if (!wanted || saving.value) return;
  saving.value = true;
  saveError.value = undefined;
  const result = await api.change(wanted);
  saving.value = false;
  if (!result.ok) {
    saveError.value = errorText(result.error);
    return;
  }
  emit('saved', result.value);
}

/** "A", "A and B", "A, B and C". */
const listed = (names: string[]): string =>
  names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

const clearing = computed(() => request.value?.binding === null);
const title = computed(() => {
  const r = review.value;
  if (!r) return '';
  return clearing.value
    ? `Clear the binding of ${r.action.name}?`
    : `Bind ${r.action.name} to ${r.after}?`;
});
/** The other actions the same input does while driving, and the ones in the camera editor. */
const alsoDriving = computed(() =>
  (review.value?.conflicts ?? []).filter((c) => !c.cameraEditor).map((c) => c.name)
);
const alsoCamera = computed(() =>
  (review.value?.conflicts ?? []).filter((c) => c.cameraEditor).map((c) => c.name)
);

onBeforeUnmount(() => void stopListening());
</script>

<template>
  <v-dialog
    :model-value="action !== undefined && !review"
    max-width="640"
    persistent
    @keydown.esc="close"
  >
    <v-card v-if="action" data-testid="iracing-edit">
      <v-card-title>Change a binding</v-card-title>
      <v-card-text>
        <div class="rr-row-title" data-testid="iracing-edit-action">{{ action.name }}</div>
        <div class="rr-row-sub" data-testid="iracing-edit-set">
          {{
            set.general ? 'In the bindings for all cars' : `In the custom controls of ${set.name}`
          }}
        </div>
        <div class="rr-row-sub mb-4" data-testid="iracing-edit-now">
          Now: {{ inWords(action.binding) }}
        </div>

        <div class="ibe-press rr-panel" :class="{ 'ibe-press-on': listening }">
          <template v-if="checking">
            <v-progress-circular indeterminate size="18" width="2" aria-label="Working" />
            <span data-testid="iracing-edit-checking">Working out what would change…</span>
          </template>
          <template v-else-if="listening">
            <v-progress-circular indeterminate size="18" width="2" aria-label="Listening" />
            <span data-testid="iracing-edit-listening">Press {{ what }} now… Esc stops.</span>
            <v-spacer />
            <v-btn
              size="small"
              variant="text"
              data-testid="iracing-edit-listen-stop"
              @click="stopListening"
            >
              Stop
            </v-btn>
          </template>
          <template v-else>
            <v-icon icon="mdi-gesture-tap-button" class="rr-muted" />
            <span>{{ where }}</span>
            <v-spacer />
            <v-btn size="small" variant="tonal" data-testid="iracing-edit-listen" @click="listen">
              Press {{ what }}
            </v-btn>
          </template>
        </div>
        <div v-if="note" class="ibe-note" role="status" data-testid="iracing-edit-note">
          <v-icon icon="mdi-information-outline" size="16" class="rr-muted" />
          <span>{{ note }}</span>
        </div>
        <p class="ibe-hint">
          An axis or a hat switch is bound in iRacing itself: Options, then Controls.
        </p>
      </v-card-text>
      <v-card-actions>
        <v-btn
          v-if="action.binding"
          variant="text"
          :disabled="checking"
          data-testid="iracing-edit-clear"
          @click="choose(null)"
        >
          Clear this binding
        </v-btn>
        <v-spacer />
        <v-btn variant="text" data-testid="iracing-edit-close" @click="close">Close</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <ConfirmChanges
    :open="review !== undefined"
    :title="title"
    confirm-text="Save in iRacing’s file"
    :preview="review?.preview"
    :busy="saving"
    :blocked="!!review?.blocked || !!review?.same"
    :max-width="640"
    testid="iracing-save"
    @cancel="close"
    @confirm="save"
  >
    <template v-if="review">
      <dl class="ibe-change">
        <dt>Now</dt>
        <dd data-testid="iracing-save-before">{{ review.before }}</dd>
        <dt>After saving</dt>
        <dd data-testid="iracing-save-after">{{ review.after }}</dd>
        <dt>For</dt>
        <dd data-testid="iracing-save-set">
          {{ review.set.general ? 'All cars' : `${review.set.name} only` }}
        </dd>
      </dl>
      <v-alert
        v-if="review.blocked"
        type="warning"
        variant="tonal"
        density="compact"
        class="mt-3"
        data-testid="iracing-save-blocked"
        >{{ review.blocked }}</v-alert
      >
      <div v-if="review.same" class="ibe-note mt-3" data-testid="iracing-save-same">
        <v-icon icon="mdi-information-outline" size="16" class="rr-muted" />
        <span>{{ review.action.name }} already has this. There is nothing to save.</span>
      </div>
      <template v-else>
        <v-alert
          v-if="alsoDriving.length"
          type="warning"
          variant="tonal"
          density="compact"
          class="mt-3"
          data-testid="iracing-save-conflict"
        >
          {{ review.after }} already does {{ listed(alsoDriving) }}. After saving, one press does
          {{ alsoDriving.length === 1 ? 'both' : 'all of them' }}. RigReady leaves the other
          {{ alsoDriving.length === 1 ? 'binding as it is' : 'bindings as they are' }}.
        </v-alert>
        <div v-if="alsoCamera.length" class="ibe-note mt-3" data-testid="iracing-save-camera">
          <v-icon icon="mdi-video-outline" size="16" class="rr-muted" />
          <span>
            In iRacing’s camera editor the same key is {{ listed(alsoCamera) }}. iRacing’s own
            default keys are shared like this.
          </span>
        </div>
      </template>
    </template>
    <template #after>
      <div class="ibe-note mt-3" data-testid="iracing-save-undo">
        <v-icon icon="mdi-information-outline" size="16" class="rr-muted" />
        <span>
          Nothing is written until you press Save in iRacing’s file. RigReady then changes this one
          binding and leaves the rest of the file as it was. If iRacing shows a wrong or missing
          binding afterwards, close iRacing and undo the change on the Safety page.
        </span>
      </div>
      <v-alert
        v-if="saveError"
        type="error"
        variant="tonal"
        density="compact"
        class="mt-3"
        data-testid="iracing-save-error"
        >{{ saveError }}</v-alert
      >
    </template>
  </ConfirmChanges>
</template>

<style scoped>
.ibe-press {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  margin-bottom: 12px;
  font-size: 13.5px;
  background: var(--rr-surface-2);
}
.ibe-press-on {
  border-color: var(--rr-accent);
}
.ibe-note {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 13px;
  line-height: 1.5;
}
.ibe-hint {
  margin: 12px 0 0;
  font-size: 12.5px;
  color: var(--rr-muted);
}
.ibe-change {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 16px;
  margin: 0;
  font-size: 13.5px;
}
.ibe-change dt {
  color: var(--rr-muted);
}
.ibe-change dd {
  margin: 0;
  font-weight: 600;
}
</style>
