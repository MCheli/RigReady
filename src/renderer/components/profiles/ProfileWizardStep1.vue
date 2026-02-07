<script setup lang="ts">
import { SIMULATORS, SIMULATOR_DISPLAY_NAMES, type Simulator } from '../../../shared/types';

defineProps<{
  name: string;
  game: Simulator;
}>();

defineEmits<{
  'update:name': [value: string];
  'update:game': [value: Simulator];
}>();

const gameOptions = SIMULATORS.map((s) => ({
  title: SIMULATOR_DISPLAY_NAMES[s],
  value: s,
}));
</script>

<template>
  <div>
    <h3 class="text-h6 mb-4">Name & Game</h3>
    <p class="text-body-2 text-medium-emphasis mb-6">
      Give your profile a name and select which game or simulator it's for.
    </p>
    <v-text-field
      :model-value="name"
      label="Profile Name"
      placeholder="e.g., DCS F/A-18C Online"
      class="mb-4"
      autofocus
      @update:model-value="$emit('update:name', $event)"
    />
    <v-select
      :model-value="game"
      :items="gameOptions"
      item-title="title"
      item-value="value"
      label="Game / Simulator"
      @update:model-value="$emit('update:game', $event)"
    />
  </div>
</template>
