<script setup lang="ts">
/**
 * The words of one part in the profile editor: its name on the controller, the plain hint
 * (which control of yours belongs here, for any game), the note for the profile's game
 * (kept apart, and said to be for that game), the control that drives it now, and what is
 * going on while it waits for a press.
 */
defineProps<{
  title: string;
  hint?: string;
  /** Already in words: "In Ace Combat 8: Lock on". */
  gameNote?: string;
  source: string;
  /** This part is waiting for the user to press or move a control. */
  listening: boolean;
  secondsLeft: number;
  /** How the last try to pick a control for this part ended, when it did not pick one. */
  note?: { text: string; bad: boolean };
}>();
</script>

<template>
  <div class="rr-row-main">
    <div class="rr-row-title">{{ title }}</div>
    <div v-if="hint" class="rr-row-sub" data-testid="vc-part-hint">{{ hint }}</div>
    <div v-if="gameNote" class="rr-row-sub vc-game-note" data-testid="vc-part-game-note">
      <v-icon icon="mdi-gamepad-variant-outline" size="13" /> {{ gameNote }}
    </div>
    <div class="rr-row-sub rr-mono" data-testid="vc-part-source">{{ source }}</div>
    <div v-if="listening" class="vc-listening" role="status" data-testid="vc-listening">
      <v-icon icon="mdi-gesture-tap" size="14" /> Press or move the control now.
      <span class="rr-num">{{ secondsLeft }}</span>
      {{ secondsLeft === 1 ? 'second' : 'seconds' }} left.
    </div>
    <div v-else-if="note && note.bad" class="rr-row-sub rr-bad" data-testid="vc-part-note">
      <v-icon icon="mdi-close-circle" size="13" /> {{ note.text }}
    </div>
    <div v-else-if="note" class="rr-row-sub" data-testid="vc-part-note">
      <v-icon icon="mdi-information-outline" size="13" /> {{ note.text }}
    </div>
  </div>
</template>

<style scoped>
.vc-game-note {
  font-style: italic;
}
.vc-listening {
  margin-top: 2px;
  font-size: var(--rr-text-sm);
  font-weight: 600;
  color: var(--rr-accent);
}
</style>
