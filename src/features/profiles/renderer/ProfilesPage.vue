<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { Profile } from '../../../core/profile/schema';
import { errorText, useClient } from '../../../renderer/ipc';
import { profilesContract } from '../contract';

const api = useClient(profilesContract);
const profiles = ref<Profile[]>([]);
const loaded = ref(false);
const error = ref<string>();
const deleting = ref<Profile>();

async function load(): Promise<void> {
  const result = await api.list();
  if (result.ok) profiles.value = result.value;
  else error.value = errorText(result.error);
  loaded.value = true;
}

async function confirmDelete(): Promise<void> {
  const target = deleting.value;
  if (!target) return;
  const result = await api.remove({ id: target.id });
  deleting.value = undefined;
  if (!result.ok) error.value = errorText(result.error);
  await load();
}

onMounted(load);
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

    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>

    <div
      v-if="loaded && profiles.length === 0"
      class="rr-panel rr-empty"
      data-testid="profiles-empty"
    >
      No setups yet. Get the rig working the way you want it, then capture it.
    </div>

    <div v-else-if="loaded" class="rr-panel">
      <div v-for="profile in profiles" :key="profile.id" class="rr-row" data-testid="profile-row">
        <v-icon icon="mdi-clipboard-check-outline" class="rr-muted" />
        <div class="rr-row-main">
          <div class="rr-row-title">{{ profile.name }}</div>
          <div class="rr-row-sub">
            {{ profile.checks.length }} checks ·
            {{ profile.launch ? `launches ${profile.launch.exe}` : 'no launch program' }}
          </div>
        </div>
        <v-btn variant="text" :to="`/configure/profiles/${profile.id}`" data-testid="profile-edit"
          >Edit</v-btn
        >
        <v-btn variant="text" color="error" data-testid="profile-delete" @click="deleting = profile"
          >Delete</v-btn
        >
      </div>
    </div>

    <v-dialog
      :model-value="deleting !== undefined"
      max-width="440"
      @update:model-value="deleting = undefined"
    >
      <v-card>
        <v-card-title>Delete "{{ deleting?.name }}"?</v-card-title>
        <v-card-text
          >The setup is removed from RigReady. Nothing on the rig or in any game is
          changed.</v-card-text
        >
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
