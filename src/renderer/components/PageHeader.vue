<script setup lang="ts">
defineProps<{
  title: string;
}>();
</script>

<template>
  <div class="page-header mb-8">
    <div class="d-flex flex-wrap justify-space-between align-center ga-6">
      <h1 class="text-h4 font-weight-bold">{{ title }}</h1>
      <div v-if="$slots.actions" class="d-flex flex-wrap align-center gap-4">
        <slot name="actions" />
      </div>
    </div>
  </div>
</template>
