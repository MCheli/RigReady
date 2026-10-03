<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { Profile } from '../../../core/profile/schema';
import { errorText, useClient } from '../../../renderer/ipc';
import { onMachineChanged } from '../../../renderer/machine';
import { profilesContract, type ProfileOverview } from '../contract';

const api = useClient(profilesContract);
const router = useRouter();
const overview = ref<ProfileOverview>();
const error = ref<string>();
const message = ref<string>();
const deleting = ref<{ id: string; name: string }>();
const busy = ref<string>();

async function load(): Promise<void> {
  const result = await api.overview();
  if (result.ok) {
    overview.value = result.value;
    error.value = undefined;
  } else error.value = errorText(result.error);
}

function describe(entry: ProfileOverview['profiles'][number]): string {
  const p = entry.profile;
  const launch = p.steamAppId
    ? 'launches through Steam'
    : p.launch
      ? `launches ${p.launch.exe.split(/[\\/]/).pop()}`
      : 'nothing to launch';
  const checks = `${p.checks.length} ${p.checks.length === 1 ? 'check' : 'checks'}`;
  return [entry.gameName, checks, launch].filter(Boolean).join(' · ');
}

function used(iso: string | undefined): string {
  if (!iso) return 'Not used yet';
  return `Used ${new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
}

async function fly(profile: Profile): Promise<void> {
  const result = await api.use({ id: profile.id });
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  await router.push('/');
}

async function clone(profile: Profile): Promise<void> {
  busy.value = profile.id;
  const result = await api.clone({ id: profile.id });
  busy.value = undefined;
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  // Straight into the editor, to give the copy its own name.
  await router.push(`/configure/profiles/${result.value.id}`);
}

async function confirmDelete(): Promise<void> {
  const target = deleting.value;
  if (!target) return;
  deleting.value = undefined;
  const result = await api.remove({ id: target.id });
  if (!result.ok) error.value = errorText(result.error);
  else message.value = `Deleted "${target.name}". The Safety page can bring it back.`;
  await load();
}

async function openFile(id: string, mode: 'openFile' | 'showFile'): Promise<void> {
  const result = await api[mode]({ id });
  if (!result.ok) error.value = errorText(result.error);
  else message.value = mode === 'openFile' ? 'Opened in your editor.' : 'Opened in Explorer.';
}

let off: (() => void) | undefined;
onMounted(async () => {
  await load();
  off = onMachineChanged(() => void load());
});
onBeforeUnmount(() => off?.());
</script>

<template>
  <div class="rr-page" data-testid="profiles-page">
    <div class="d-flex align-start">
      <div>
        <h1 class="rr-page-title">Setups</h1>
        <p class="rr-page-sub">
          One per aircraft or car: what must be plugged in, running and arranged before you launch.
        </p>
      </div>
      <v-spacer />
      <v-btn
        color="primary"
        prepend-icon="mdi-camera-outline"
        to="/configure/profiles/capture"
        data-testid="new-profile"
      >
        New from this rig
      </v-btn>
    </div>

    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      class="mb-4"
      closable
      data-testid="profiles-error"
      >{{ error }}</v-alert
    >
    <v-alert
      v-if="message"
      type="success"
      variant="tonal"
      class="mb-4"
      closable
      data-testid="profiles-message"
    >
      {{ message }}
    </v-alert>

    <div
      v-if="overview && overview.profiles.length === 0 && overview.invalid.length === 0"
      class="rr-panel rr-empty"
      data-testid="profiles-empty"
    >
      <v-icon icon="mdi-clipboard-check-outline" size="40" class="mb-3" />
      <div>No setups yet. Get the rig working the way you want it, then capture it.</div>
      <v-btn class="mt-4" color="primary" to="/configure/profiles/capture">New from this rig</v-btn>
    </div>

    <div v-else-if="overview" class="rr-panel">
      <div
        v-for="entry in overview.profiles"
        :key="entry.profile.id"
        class="rr-row"
        data-testid="profile-row"
        :data-name="entry.profile.name"
      >
        <v-icon icon="mdi-clipboard-check-outline" class="rr-muted" />
        <div class="rr-row-main">
          <div class="rr-row-title">
            {{ entry.profile.name }}
            <span v-if="entry.profile.id === overview.lastProfileId" class="profiles-chip"
              >on the Fly screen</span
            >
          </div>
          <div class="rr-row-sub">{{ describe(entry) }} · {{ used(entry.lastUsed) }}</div>
        </div>
        <v-btn
          variant="text"
          prepend-icon="mdi-airplane-takeoff"
          data-testid="profile-fly"
          @click="fly(entry.profile)"
          >Fly</v-btn
        >
        <v-btn
          variant="text"
          :to="`/configure/profiles/${entry.profile.id}`"
          data-testid="profile-edit"
          >Edit</v-btn
        >
        <v-btn
          variant="text"
          :loading="busy === entry.profile.id"
          data-testid="profile-clone"
          @click="clone(entry.profile)"
        >
          Clone
        </v-btn>
        <v-menu>
          <template #activator="{ props: menu }">
            <v-btn
              v-bind="menu"
              icon="mdi-dots-vertical"
              variant="text"
              size="small"
              aria-label="More"
              data-testid="profile-more"
            />
          </template>
          <v-list density="compact">
            <v-list-item
              title="Open the YAML file"
              @click="openFile(entry.profile.id, 'openFile')"
            />
            <v-list-item title="Show in Explorer" @click="openFile(entry.profile.id, 'showFile')" />
            <v-list-item
              title="Delete…"
              class="text-error"
              data-testid="profile-delete"
              @click="deleting = { id: entry.profile.id, name: entry.profile.name }"
            />
          </v-list>
        </v-menu>
      </div>
      <div
        v-for="broken in overview.invalid"
        :key="broken.id"
        class="rr-row profiles-broken"
        data-testid="profile-invalid"
        :data-id="broken.id"
      >
        <v-icon icon="mdi-file-alert-outline" class="rr-bad" />
        <div class="rr-row-main">
          <div class="rr-row-title">{{ broken.file.split(/[\\/]/).pop() }}</div>
          <div class="rr-row-sub rr-bad">{{ broken.message }}</div>
          <pre
            v-if="broken.detail"
            class="profiles-detail rr-mono"
            data-testid="profile-invalid-detail"
            >{{ broken.detail }}</pre>
        </div>
        <v-btn
          variant="text"
          data-testid="profile-invalid-open"
          @click="openFile(broken.id, 'openFile')"
          >Open file</v-btn
        >
        <v-btn variant="text" @click="openFile(broken.id, 'showFile')">Show in Explorer</v-btn>
        <v-btn variant="text" color="error" @click="deleting = { id: broken.id, name: broken.id }"
          >Delete</v-btn
        >
      </div>
    </div>

    <v-dialog
      :model-value="deleting !== undefined"
      max-width="440"
      @update:model-value="deleting = undefined"
    >
      <v-card data-testid="profile-delete-dialog">
        <v-card-title>Delete "{{ deleting?.name }}"?</v-card-title>
        <v-card-text>
          The setup is removed from RigReady; a copy is kept and the Safety page can bring it back.
          Nothing on the rig or in any game changes, and monitor layouts and backups stay.
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="deleting = undefined">Cancel</v-btn>
          <v-btn color="error" data-testid="profile-delete-confirm" @click="confirmDelete"
            >Delete</v-btn
          >
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.profiles-chip {
  margin-left: 8px;
  font-size: 11px;
  color: var(--rr-accent);
  border: 1px solid color-mix(in srgb, var(--rr-accent) 50%, transparent);
  border-radius: 4px;
  padding: 0 5px;
  font-weight: 400;
}
.profiles-broken {
  align-items: flex-start;
}
.profiles-detail {
  margin: 6px 0 0;
  white-space: pre-wrap;
  color: var(--rr-muted);
}
</style>
