<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { Profile } from '../../../core/profile/schema';
import { errorText, useClient } from '../../../renderer/ipc';
import { profilesContract } from '../contract';

const props = defineProps<{ id: string }>();
const api = useClient(profilesContract);
const router = useRouter();

const profile = ref<Profile>();
const launchExe = ref('');
const launchArgs = ref('');
const error = ref<string>();
const saving = ref(false);

const quote = (arg: string): string => (/\s/.test(arg) ? `"${arg}"` : arg);
const splitArgs = (line: string): string[] =>
  [...line.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2] ?? '');

onMounted(async () => {
  const result = await api.get({ id: props.id });
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  profile.value = result.value;
  launchExe.value = result.value.launch?.exe ?? '';
  launchArgs.value = (result.value.launch?.args ?? []).map(quote).join(' ');
});

function removeCheck(id: string): void {
  if (profile.value) profile.value.checks = profile.value.checks.filter((c) => c.id !== id);
}

async function save(): Promise<void> {
  if (!profile.value) return;
  saving.value = true;
  const exe = launchExe.value.trim();
  const { launch: previous, ...rest } = profile.value;
  const next: Profile = exe
    ? { ...rest, launch: { ...previous, exe, args: splitArgs(launchArgs.value) } }
    : rest;
  const result = await api.save(next);
  saving.value = false;
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  await router.push('/configure/profiles');
}
</script>

<template>
  <div class="rr-page" data-testid="profile-edit-page">
    <h1 class="rr-page-title">Edit setup</h1>
    <p class="rr-page-sub">
      Rename it, change what it launches, and decide which checks are required.
    </p>

    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>

    <template v-if="profile">
      <div class="rr-panel edit-basics">
        <v-text-field v-model="profile.name" label="Name" data-testid="edit-name" />
        <div class="edit-launch">
          <v-text-field
            v-model="launchExe"
            label="Program to launch (optional)"
            data-testid="edit-launch-exe"
          />
          <v-text-field v-model="launchArgs" label="Arguments (optional)" />
        </div>
      </div>

      <h2 class="rr-section-title">Checks</h2>
      <div class="rr-panel mb-6">
        <div
          v-for="check in profile.checks"
          :key="check.id"
          class="rr-row"
          data-testid="edit-check"
        >
          <div class="rr-row-main">
            <div class="rr-row-title">{{ check.title }}</div>
            <div class="rr-row-sub rr-mono">{{ check.type }}</div>
          </div>
          <v-btn-toggle
            v-model="check.required"
            mandatory
            density="compact"
            variant="outlined"
            divided
          >
            <v-btn :value="true" size="small">Required</v-btn>
            <v-btn :value="false" size="small">Optional</v-btn>
          </v-btn-toggle>
          <v-btn
            icon="mdi-delete-outline"
            variant="text"
            size="small"
            :aria-label="`Remove ${check.title}`"
            @click="removeCheck(check.id)"
          />
        </div>
        <div v-if="profile.checks.length === 0" class="rr-row rr-muted">No checks.</div>
      </div>

      <div class="d-flex ga-2">
        <v-spacer />
        <v-btn variant="text" to="/configure/profiles">Cancel</v-btn>
        <v-btn
          color="primary"
          :disabled="profile.name.trim().length === 0"
          :loading="saving"
          data-testid="edit-save"
          @click="save"
        >
          Save
        </v-btn>
      </div>
    </template>
  </div>
</template>

<style scoped>
.edit-basics {
  padding: 16px;
  display: grid;
  gap: 12px;
  margin-bottom: 24px;
}
.edit-launch {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 12px;
}
</style>
