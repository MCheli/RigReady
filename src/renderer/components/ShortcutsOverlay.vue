<script setup lang="ts">
import { paletteOpen, shortcutsOpen } from '../shell/shell';
import { PALETTE_KEYS, SHORTCUTS } from '../shell/shortcuts';

/**
 * The keyboard shortcuts, shown by "?". The list is the table the key handler reads
 * (shell/shortcuts.ts), so every key shown here does what it says.
 */
function openPalette(): void {
  shortcutsOpen.value = false;
  paletteOpen.value = true;
}
</script>

<template>
  <v-dialog v-model="shortcutsOpen" class="rr-shell-dialog" max-width="520" transition="rr-dialog">
    <v-card class="rr-shortcuts" data-testid="shortcuts">
      <v-card-title>Keyboard shortcuts</v-card-title>
      <v-card-text>
        <div class="rr-section-title">Anywhere</div>
        <dl class="rr-keys">
          <div
            v-for="entry in SHORTCUTS"
            :key="entry.id"
            class="rr-keys-row"
            :data-shortcut="entry.id"
            data-testid="shortcut-row"
          >
            <dt>
              <template v-for="(key, at) in entry.keys" :key="key">
                <span v-if="at > 0" class="rr-keys-plus" aria-hidden="true">+</span>
                <kbd class="rr-kbd">{{ key }}</kbd>
              </template>
            </dt>
            <dd>{{ entry.label }}</dd>
          </div>
        </dl>
        <div class="rr-section-title rr-keys-gap">In the command palette</div>
        <dl class="rr-keys">
          <div v-for="entry in PALETTE_KEYS" :key="entry.label" class="rr-keys-row">
            <dt>
              <kbd v-for="key in entry.keys" :key="key" class="rr-kbd">{{ key }}</kbd>
            </dt>
            <dd>{{ entry.label }}</dd>
          </div>
        </dl>
        <p class="rr-keys-note">
          Everything else works with Tab, Enter, Space, the arrow keys and Escape, as in any Windows
          program.
        </p>
      </v-card-text>
      <v-card-actions>
        <v-btn variant="text" data-testid="shortcuts-palette" @click="openPalette">
          Open the command palette
        </v-btn>
        <v-spacer />
        <v-btn color="primary" data-testid="shortcuts-close" @click="shortcutsOpen = false">
          Close
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style>
.rr-keys {
  margin: 0;
  display: grid;
  gap: 2px;
}
.rr-keys-row {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 6px 0;
}
.rr-keys-row dt {
  flex: none;
  width: 132px;
  display: flex;
  align-items: center;
  gap: 5px;
}
.rr-keys-row dd {
  margin: 0;
  font-size: 14px;
  color: var(--rr-text);
}
.rr-keys-plus {
  color: var(--rr-muted);
  font-size: 12px;
}
.rr-keys-gap {
  margin-top: 16px;
}
.rr-keys-note {
  margin: 16px 0 0;
  font-size: 12.5px;
  color: var(--rr-muted);
}
</style>
