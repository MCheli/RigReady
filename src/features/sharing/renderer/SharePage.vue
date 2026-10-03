<script setup lang="ts">
import { ref } from 'vue';
import ShareExport from './ShareExport.vue';
import ShareImport from './ShareImport.vue';

const mode = ref<'export' | 'import'>('export');
</script>

<template>
  <div class="rr-page" data-testid="share-page">
    <h1 class="rr-page-title">Share</h1>
    <p class="rr-page-sub">
      Give a setup to a friend or squadron as one .rigready file, or bring in one you were given.
      Personal details are reviewed before anything leaves this PC, and nothing that runs a program
      is ever shared or imported.
    </p>

    <div class="choices">
      <button
        class="rr-panel choice"
        :class="{ active: mode === 'export' }"
        data-testid="share-mode-export"
        @click="mode = 'export'"
      >
        <v-icon icon="mdi-export-variant" size="22" />
        <div>
          <div class="choice-title">Share a setup</div>
          <div class="rr-row-sub">Review what is in it, then save a .rigready file</div>
        </div>
      </button>
      <button
        class="rr-panel choice"
        :class="{ active: mode === 'import' }"
        data-testid="share-mode-import"
        @click="mode = 'import'"
      >
        <v-icon icon="mdi-import" size="22" />
        <div>
          <div class="choice-title">Import a shared setup</div>
          <div class="rr-row-sub">See how it fits this PC, then pick what to bring in</div>
        </div>
      </button>
    </div>

    <ShareExport v-if="mode === 'export'" />
    <ShareImport v-else />
  </div>
</template>

<style scoped>
.choices {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 24px;
}
.choice {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  text-align: left;
  color: var(--rr-text);
  cursor: pointer;
}
.choice.active {
  border-color: var(--rr-accent);
  background: var(--rr-surface-2);
}
.choice-title {
  font-weight: 600;
  font-size: 14px;
}
</style>

<style>
/* Shared by the backup and sharing screens (not scoped: child components use them). */
.rr-section-title.section-gap {
  margin-top: 24px;
}
[data-testid='backups-page'] .v-checkbox-btn,
[data-testid='restore-page'] .v-checkbox-btn,
[data-testid='share-page'] .v-checkbox-btn {
  flex: 0 0 auto;
}
</style>
