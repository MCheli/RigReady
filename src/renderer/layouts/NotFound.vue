<script setup lang="ts">
import EmptyState from '../components/EmptyState.vue';
import { paletteOpen } from '../shell/shell';
</script>

<template>
  <div class="rr-page" data-testid="not-found">
    <EmptyState art="search" title="There is nothing at this address.">
      The link may be from an older version of RigReady. Every page is one search away.
      <template #action>
        <v-btn to="/" color="primary">Back to Fly</v-btn>
        <v-btn variant="tonal" prepend-icon="mdi-magnify" @click="paletteOpen = true">
          Find a page
        </v-btn>
      </template>
    </EmptyState>
  </div>
</template>
