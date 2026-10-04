<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import ConfirmChanges from '../../../renderer/components/ConfirmChanges.vue';
import { errorText, useClient } from '../../../renderer/ipc';
import type { ChangePreview } from '../../../shared/changePreview';
import { profilesContract, type ShortcutStatus } from '../contract';

/**
 * The setup's desktop shortcut: one double-click that makes the rig ready and launches.
 * Shows whether it is on the desktop and still right, makes it, updates it and removes it.
 * Every change is shown first (ConfirmChanges) and reported only once main has read it back.
 */
const props = defineProps<{
  id: string;
  /** The setup's name as it was last saved: what the shortcut is named after. */
  setupName: string;
  /** Why the shortcut cannot be changed right now (unsaved changes it depends on). */
  blocked?: string | undefined;
}>();

const api = useClient(profilesContract);
const status = ref<ShortcutStatus>();
const error = ref<string>();
const done = ref<string>();
const asking = ref<'create' | 'remove'>();
const preview = ref<ChangePreview>();
const previewError = ref<string>();
const busy = ref(false);

const LOOK = {
  none: { tone: 'rr-muted', primary: 'Create desktop shortcut' },
  current: { tone: 'rr-ok', primary: undefined },
  outdated: { tone: 'rr-warn', primary: 'Update shortcut' },
  taken: { tone: 'rr-warn', primary: 'Replace it with the shortcut' },
} as const;

const look = computed(() => LOOK[status.value?.state ?? 'none']);
const removable = computed(
  () => status.value?.state === 'current' || status.value?.state === 'outdated'
);
const stateLine = computed(() => {
  const now = status.value;
  if (!now) return '';
  if (now.state === 'current') return `On the desktop: ${now.name}`;
  if (now.state === 'outdated') return `The shortcut on the desktop is out of date. ${now.detail}`;
  return now.detail;
});
const what = computed(() =>
  status.value?.launches === false
    ? 'makes the rig ready for this setup: monitors, helper apps, files'
    : 'makes the rig ready for this setup (monitors, helper apps, files) and launches the game'
);

const dialog = computed(() => {
  const name = status.value?.name ?? '';
  if (asking.value === 'remove') {
    return { title: 'Remove the desktop shortcut?', confirm: 'Remove shortcut' };
  }
  if (status.value?.state === 'outdated') {
    return { title: 'Update the desktop shortcut?', confirm: 'Update shortcut' };
  }
  if (status.value?.state === 'taken') {
    return { title: `Replace ${name} on the desktop?`, confirm: 'Replace it' };
  }
  return {
    title: `Put a shortcut for "${props.setupName}" on the desktop?`,
    confirm: 'Create shortcut',
  };
});

async function load(): Promise<void> {
  const result = await api.shortcut({ id: props.id });
  if (result.ok) status.value = result.value;
  else error.value = errorText(result.error);
}

async function ask(action: 'create' | 'remove'): Promise<void> {
  error.value = undefined;
  done.value = undefined;
  preview.value = undefined;
  previewError.value = undefined;
  asking.value = action;
  const result = await api.shortcutPreview({ id: props.id, action });
  if (asking.value !== action) return;
  if (result.ok) preview.value = result.value;
  else previewError.value = errorText(result.error);
}

async function apply(): Promise<void> {
  const action = asking.value;
  if (!action) return;
  busy.value = true;
  const result =
    action === 'create'
      ? await api.createShortcut({ id: props.id })
      : await api.removeShortcut({ id: props.id });
  busy.value = false;
  asking.value = undefined;
  if (!result.ok) {
    error.value = errorText(result.error);
    // Whatever is on the desktop now is what is shown.
    await load();
    return;
  }
  status.value = result.value;
  // A new or updated shortcut is said by the state line itself ("On the desktop: ...").
  if (action === 'remove') done.value = 'The shortcut was removed from the desktop.';
}

onMounted(load);
</script>

<template>
  <h2 class="rr-section-title">Desktop shortcut</h2>
  <div class="rr-panel shortcut" data-testid="edit-shortcut" :data-state="status?.state ?? ''">
    <div class="rr-row shortcut-row">
      <v-icon icon="mdi-cursor-default-click-outline" size="22" class="shortcut-icon" />
      <div class="rr-row-main">
        <div class="rr-row-title">Launch with one double-click</div>
        <div class="rr-row-sub">
          A shortcut on the desktop starts RigReady and {{ what }}. If something required is
          missing, RigReady stops and shows why.
        </div>
        <div v-if="status" class="shortcut-state">
          <span :class="look.tone" data-testid="shortcut-state">{{ stateLine }}</span>
        </div>
        <div v-else-if="!error" class="rr-row-sub">Looking at the desktop…</div>
        <div v-if="status" class="rr-row-sub rr-mono" data-testid="shortcut-file">
          {{ status.file }}
        </div>
        <div v-if="status && blocked" class="rr-row-sub" data-testid="shortcut-blocked">
          {{ blocked }}
        </div>
        <div v-if="done" class="rr-ok shortcut-done" data-testid="shortcut-done">{{ done }}</div>
      </div>
      <div v-if="status" class="shortcut-actions">
        <v-btn
          v-if="removable"
          size="small"
          variant="text"
          :disabled="blocked !== undefined"
          data-testid="shortcut-remove"
          @click="ask('remove')"
        >
          Remove shortcut
        </v-btn>
        <v-btn
          v-if="look.primary"
          size="small"
          color="primary"
          variant="tonal"
          prepend-icon="mdi-plus"
          :disabled="blocked !== undefined"
          data-testid="shortcut-create"
          @click="ask('create')"
        >
          {{ look.primary }}
        </v-btn>
      </div>
    </div>
    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      density="compact"
      class="shortcut-error"
      data-testid="shortcut-error"
    >
      {{ error }}
    </v-alert>
  </div>

  <ConfirmChanges
    :open="asking !== undefined"
    :title="dialog.title"
    :confirm-text="dialog.confirm"
    :preview="preview"
    :error="previewError"
    :busy="busy"
    testid="shortcut"
    @cancel="asking = undefined"
    @confirm="apply"
  >
    <template v-if="asking === 'remove'">
      The setup itself is not touched: only the shortcut goes.
    </template>
    <template v-else>
      Double-clicking it starts RigReady and {{ what }}. Nothing is launched while something
      required is missing.
    </template>
  </ConfirmChanges>
</template>

<style scoped>
.shortcut {
  margin-bottom: 24px;
}
.shortcut-row {
  align-items: flex-start;
  padding-top: 14px;
  padding-bottom: 14px;
}
.shortcut-icon {
  color: var(--rr-accent);
  margin-top: 1px;
}
.shortcut-state {
  margin-top: 8px;
  font-size: 13.5px;
}
.shortcut-done {
  margin-top: 6px;
  font-size: 13px;
}
.shortcut-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
}
.shortcut-error {
  margin: 0 16px 14px;
}
</style>
