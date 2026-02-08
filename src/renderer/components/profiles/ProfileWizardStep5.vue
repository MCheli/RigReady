<script setup lang="ts">
import { ref, watch } from 'vue';
import type { TrackedConfiguration } from '../../../shared/profileTypes';

const props = defineProps<{
  trackedConfigs: TrackedConfiguration[];
}>();

const emit = defineEmits<{
  'update:trackedConfigs': [value: TrackedConfiguration[]];
}>();

const trackedPath = ref('');
const trackedName = ref('');
const localTracked = ref<TrackedConfiguration[]>([...props.trackedConfigs]);

watch(
  () => props.trackedConfigs,
  (val) => {
    localTracked.value = [...val];
  }
);

function addTrackedConfig() {
  if (!trackedPath.value.trim() || !trackedName.value.trim()) return;
  localTracked.value.push({
    name: trackedName.value.trim(),
    path: trackedPath.value.trim(),
  });
  emit('update:trackedConfigs', [...localTracked.value]);
  trackedName.value = '';
  trackedPath.value = '';
}

function removeTrackedConfig(index: number) {
  localTracked.value.splice(index, 1);
  emit('update:trackedConfigs', [...localTracked.value]);
}
</script>

<template>
  <div>
    <h3 class="text-h6 mb-4">Tracked Configurations</h3>

    <p class="text-body-2 text-medium-emphasis mb-4">
      Track config files that you want to snapshot and restore.
    </p>

    <v-list v-if="localTracked.length > 0" density="compact" class="mb-4">
      <v-list-item v-for="(tc, index) in localTracked" :key="index">
        <v-list-item-title>{{ tc.name }}</v-list-item-title>
        <v-list-item-subtitle>{{ tc.path }}</v-list-item-subtitle>
        <template #append>
          <v-btn icon variant="text" size="small" @click="removeTrackedConfig(index)">
            <v-icon>mdi-close</v-icon>
          </v-btn>
        </template>
      </v-list-item>
    </v-list>

    <v-row>
      <v-col cols="5">
        <v-text-field
          v-model="trackedName"
          label="Name"
          placeholder="DCS Input Config"
          density="compact"
        />
      </v-col>
      <v-col cols="5">
        <v-text-field
          v-model="trackedPath"
          label="Path"
          placeholder="C:\Users\..."
          density="compact"
        />
      </v-col>
      <v-col cols="2" class="d-flex align-center">
        <v-btn icon variant="tonal" size="small" @click="addTrackedConfig">
          <v-icon>mdi-plus</v-icon>
        </v-btn>
      </v-col>
    </v-row>
  </div>
</template>
