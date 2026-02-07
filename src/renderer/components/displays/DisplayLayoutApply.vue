<script setup lang="ts">
import { ref } from 'vue';
import { useDisplayWrite } from '../../composables/useDisplayWrite';
import { useToast } from '../../composables/useToast';

defineProps<{
  configurationName: string;
}>();

const { applying, applyLayout } = useDisplayWrite();
const toast = useToast();
const resultMessage = ref('');

async function apply(name: string) {
  resultMessage.value = '';
  const result = await applyLayout(name);
  resultMessage.value = result.message;
  if (result.success) {
    toast.success(result.message);
  } else {
    toast.error(result.message);
  }
}
</script>

<template>
  <v-card variant="outlined">
    <v-card-text>
      <div class="d-flex justify-space-between align-center">
        <div>
          <div class="font-weight-medium">{{ configurationName }}</div>
          <div class="text-caption text-medium-emphasis">Apply this display layout</div>
        </div>
        <v-btn
          variant="tonal"
          color="primary"
          size="small"
          :loading="applying"
          @click="apply(configurationName)"
        >
          Apply
        </v-btn>
      </div>
      <v-alert
        v-if="resultMessage"
        :type="resultMessage.includes('success') ? 'success' : 'warning'"
        density="compact"
        class="mt-3"
      >
        {{ resultMessage }}
      </v-alert>
    </v-card-text>
  </v-card>
</template>
