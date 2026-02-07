<script setup lang="ts">
import type { ProfileSummary } from '../../../shared/profileTypes';
import { SIMULATOR_DISPLAY_NAMES } from '../../../shared/types';

defineProps<{
  profile: ProfileSummary;
  selected?: boolean;
}>();

defineEmits<{
  select: [];
  edit: [];
  clone: [];
  delete: [];
  setActive: [];
}>();

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString();
}
</script>

<template>
  <v-card
    :class="{ 'border-primary': selected }"
    :variant="profile.isActive ? 'tonal' : 'outlined'"
    @click="$emit('select')"
    class="profile-card"
  >
    <v-card-text class="pa-4">
      <div class="d-flex justify-space-between align-start">
        <div class="flex-grow-1">
          <div class="d-flex align-center gap-2 mb-1">
            <span class="text-subtitle-1 font-weight-bold">{{ profile.name }}</span>
            <v-chip v-if="profile.isActive" color="primary" size="x-small" variant="flat">
              Active
            </v-chip>
          </div>
          <v-chip size="x-small" variant="tonal" class="mb-2">
            {{ SIMULATOR_DISPLAY_NAMES[profile.game] || profile.game }}
          </v-chip>
          <div class="text-caption text-medium-emphasis">
            {{ profile.checklistItemCount }} checks · Last used {{ formatDate(profile.lastUsed) }}
          </div>
        </div>
        <v-menu>
          <template #activator="{ props }">
            <v-btn v-bind="props" icon variant="text" size="small" @click.stop>
              <v-icon>mdi-dots-vertical</v-icon>
            </v-btn>
          </template>
          <v-list density="compact">
            <v-list-item @click="$emit('setActive')">
              <v-list-item-title>Set Active</v-list-item-title>
            </v-list-item>
            <v-list-item @click="$emit('edit')">
              <v-list-item-title>Edit</v-list-item-title>
            </v-list-item>
            <v-list-item @click="$emit('clone')">
              <v-list-item-title>Clone</v-list-item-title>
            </v-list-item>
            <v-divider />
            <v-list-item @click="$emit('delete')">
              <v-list-item-title class="text-error">Delete</v-list-item-title>
            </v-list-item>
          </v-list>
        </v-menu>
      </div>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.profile-card {
  cursor: pointer;
  transition: border-color 0.2s;
}
.profile-card:hover {
  border-color: rgb(var(--v-theme-primary));
}
</style>
