<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { hotkeyFromPress, hotkeyShown, hotkeyText } from '../../../core/hotkeys';
import { errorText, useClient } from '../../../renderer/ipc';
import { oneClickContract, type HotkeyState } from '../contract';

/**
 * The optional system-wide hotkey, on the Settings page: a key combination that works
 * whatever program is in front, brings RigReady forward and runs Make ready. Off until one
 * is chosen. It is shown as active only when Windows has it registered for RigReady.
 */
const api = useClient(oneClickContract);
const state = ref<HotkeyState>();
const error = ref<string>();
/** The capture field is open: the next key combination becomes the hotkey. */
const choosing = ref(false);
/** Why the last combination pressed was not taken. */
const hint = ref<string>();
const busy = ref(false);
const field = ref<{ focus(): void }>();

const shown = computed(() => (state.value?.hotkey ? hotkeyShown(state.value.hotkey) : ''));

/** Closes the field without choosing; what was said about the last try goes with it. */
function cancel(): void {
  choosing.value = false;
  hint.value = undefined;
  error.value = undefined;
}

async function load(): Promise<void> {
  const result = await api.hotkey();
  if (result.ok) state.value = result.value;
  else error.value = errorText(result.error);
}

async function choose(): Promise<void> {
  choosing.value = true;
  hint.value = undefined;
  error.value = undefined;
  await nextTick();
  field.value?.focus();
}

async function set(hotkey: string | null): Promise<void> {
  busy.value = true;
  error.value = undefined;
  const result = await api.setHotkey({ hotkey });
  busy.value = false;
  if (!result.ok) {
    error.value = errorText(result.error);
    // What Windows has now is what is shown: a refused hotkey leaves the one before.
    await load();
    return;
  }
  state.value = result.value;
  choosing.value = false;
}

function onKey(event: KeyboardEvent): void {
  // Tab moves on as everywhere; everything else belongs to the hotkey being chosen.
  if (event.code === 'Tab') return;
  event.preventDefault();
  event.stopPropagation();
  if (event.code === 'Escape') {
    cancel();
    return;
  }
  const pressed = hotkeyFromPress(event);
  // Only Ctrl, Alt, Shift or Windows so far: the key is still to come.
  if (!pressed) return;
  if (!pressed.ok) {
    hint.value = pressed.error.message;
    return;
  }
  hint.value = undefined;
  void set(hotkeyText(pressed.value));
}

onMounted(load);
</script>

<template>
  <div
    class="hotkey"
    data-testid="hotkey-settings"
    :data-active="state?.active === true"
    :data-hotkey="state?.hotkey ?? ''"
  >
    <div class="rr-row hotkey-row">
      <div class="rr-row-main">
        <div class="rr-row-title">Make ready from anywhere</div>
        <div class="rr-row-sub">
          A key combination that works whatever program is in front: it brings RigReady forward and
          runs Make ready for the setup in use. Off until you choose one.
        </div>
        <div v-if="state" class="hotkey-state" data-testid="hotkey-state">
          <span v-if="!state.hotkey" class="rr-muted">Off</span>
          <span v-else-if="state.active" class="rr-ok">{{ shown }} is active</span>
          <span v-else class="rr-warn">{{ shown }} is not active. {{ state.problem }}</span>
        </div>
        <div v-else-if="!error" class="rr-row-sub">Reading the hotkey…</div>
        <v-text-field
          v-if="choosing"
          ref="field"
          class="hotkey-field"
          label="Press the key combination"
          placeholder="For example Ctrl + Alt + R"
          persistent-placeholder
          readonly
          hide-details
          density="compact"
          :loading="busy"
          data-testid="hotkey-capture"
          @keydown="onKey"
          @blur="cancel"
        />
        <div v-if="choosing" class="rr-row-sub" data-testid="hotkey-hint">
          {{ hint ?? 'Hold Ctrl, Alt or the Windows key and press a key. Esc cancels.' }}
        </div>
        <div v-if="error" class="rr-bad hotkey-error" data-testid="hotkey-error">{{ error }}</div>
      </div>
      <div v-if="state" class="hotkey-actions">
        <v-btn
          v-if="state.hotkey"
          size="small"
          variant="text"
          :loading="busy && !choosing"
          data-testid="hotkey-off"
          @click="set(null)"
        >
          Turn off
        </v-btn>
        <v-btn
          size="small"
          variant="tonal"
          color="primary"
          data-testid="hotkey-choose"
          @click="choose"
        >
          {{ state.hotkey ? 'Change' : 'Choose a hotkey' }}
        </v-btn>
      </div>
    </div>
  </div>
</template>

<style scoped>
.hotkey-row {
  align-items: flex-start;
  padding-top: 14px;
  padding-bottom: 14px;
}
.hotkey-state {
  margin-top: 8px;
  font-size: 13.5px;
}
.hotkey-field {
  margin-top: 10px;
  max-width: 320px;
}
.hotkey-error {
  margin-top: 6px;
  font-size: 13px;
}
.hotkey-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
}
</style>
