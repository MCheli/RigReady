<script setup lang="ts">
import { ref, watch } from 'vue';
import { SIMULATORS, SIMULATOR_DISPLAY_NAMES, type Simulator } from '../../../shared/types';
import type { Profile } from '../../../shared/profileTypes';

const props = defineProps<{
  modelValue: boolean;
  profile?: Profile | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  save: [data: { name: string; game: Simulator }];
}>();

const name = ref('');
const game = ref<Simulator>('dcs');

const gameOptions = SIMULATORS.map((s) => ({
  title: SIMULATOR_DISPLAY_NAMES[s],
  value: s,
}));

watch(
  () => props.profile,
  (p) => {
    if (p) {
      name.value = p.name;
      game.value = p.game;
    } else {
      name.value = '';
      game.value = 'dcs';
    }
  },
  { immediate: true }
);

function handleSave() {
  if (!name.value.trim()) return;
  emit('save', { name: name.value.trim(), game: game.value });
  emit('update:modelValue', false);
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="450"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title>{{ profile ? 'Edit Profile' : 'Create Profile' }}</v-card-title>
      <v-card-text>
        <v-text-field
          v-model="name"
          label="Profile Name"
          placeholder="e.g., DCS F/A-18C"
          class="mb-4"
          autofocus
        />
        <v-select
          v-model="game"
          :items="gameOptions"
          item-title="title"
          item-value="value"
          label="Game / Simulator"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="$emit('update:modelValue', false)">Cancel</v-btn>
        <v-btn color="primary" variant="flat" :disabled="!name.trim()" @click="handleSave">
          {{ profile ? 'Save' : 'Create' }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
